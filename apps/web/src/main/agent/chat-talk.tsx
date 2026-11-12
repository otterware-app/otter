import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { AudioLinesIcon, MicIcon, MicOffIcon } from "lucide-react";

import { mailApi, type ProviderKind, type TalkEvent } from "../mail/api";
import { COMPOSER_SURFACE } from "../mail/composer-kit";
import { toast } from "../mail/toast";
import { HintTooltip, IconBtn, cn } from "../mail/ui";
import { hearSpoken, setChatSession } from "./chat-store";
import {
  base64ToPcm,
  openMicrophone,
  openSpeaker,
  pcmToBase64,
  type Microphone,
  type Speaker,
} from "./talk-audio";

export type Call = {
  id: string;
  chatId: string;
  provider: ProviderKind;
  talkId: string | null;
  /** When the agent's voice came on. */
  liveAt: number | null;
  muted: boolean;
};

/** The call going on, in one chat at a time: there's one microphone. */
export const useTalk = create<{ call: Call | null }>(() => ({ call: null }));
const { getState: get, setState: set } = useTalk;

const CHUNK_MS = 40;
/** Audio the gateway hasn't taken yet: past this, what the microphone hears is dropped. */
const MAX_UNSENT_MS = 3000;
/** The agent counts as speaking this long after it last made a sound, between words. */
const SPEAKING_HOLD_MS = 600;

let mic: Microphone | null = null;
let speaker: Speaker | null = null;
let heardLevel = 0;
let unsentMs = 0;
let spokeAt = 0;
/** What the gateway sent before it said which call it was. */
let early: TalkEvent[] = [];
let stopListening: (() => void) | null = null;

const isCurrent = (id: string) => get().call?.id === id;

class Cancelled extends Error {}

export async function startCall(
  chatId: string,
  provider: ProviderKind,
  sessionId: string | null,
): Promise<void> {
  endCall();
  const call: Call = {
    id: crypto.randomUUID(),
    chatId,
    provider,
    talkId: null,
    liveAt: null,
    muted: false,
  };
  set({ call });
  stopListening ??= window.desktopBridge.on("agent:talkEvent", (event: unknown) =>
    onTalkEvent(event as TalkEvent),
  );
  // Made while the click still counts, so they may listen and play.
  const input = new AudioContext();
  const output = new AudioContext();
  let stream: MediaStream | null = null;
  let talkId: string | null = null;
  // Kept here until the call is still this one: hanging up meanwhile can't reach them.
  let opened: Microphone | null = null;
  try {
    stream = await navigator.mediaDevices
      .getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      .catch((error: unknown) => {
        throw new Error(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Otter isn't allowed to use the microphone."
            : "Couldn't open the microphone.",
        );
      });
    if (!isCurrent(call.id)) throw new Cancelled();
    const started = await mailApi.agentTalkStart(provider, sessionId);
    talkId = started.talkId;
    if (!isCurrent(call.id)) throw new Cancelled();
    setChatSession(chatId, provider, started.sessionId);
    const id = talkId;
    opened = await openMicrophone(input, stream, started.inputRate, (pcm, level) =>
      send(provider, id, pcm, level),
    );
    const now = get().call;
    if (now?.id !== call.id) throw new Cancelled();
    mic = opened;
    mic.mute(now.muted);
    speaker = openSpeaker(output, started.outputRate);
    set({ call: { ...now, talkId } });
    for (const event of early.splice(0)) onTalkEvent(event);
  } catch (error) {
    if (talkId) void mailApi.agentTalkEnd(provider, talkId).catch(() => {});
    if (opened) opened.stop();
    else {
      for (const track of stream?.getTracks() ?? []) track.stop();
      void input.close();
    }
    void output.close();
    if (!isCurrent(call.id)) return;
    hangUp();
    if (!(error instanceof Cancelled))
      toast.error("Couldn't start the call", {
        description: error instanceof Error ? error.message : String(error),
      });
  }
}

/** Hangs up; what the agent was asked to do goes on, and its answer still comes to the chat. */
export function endCall(): void {
  const call = get().call;
  if (!call) return;
  if (call.talkId) void mailApi.agentTalkEnd(call.provider, call.talkId).catch(() => {});
  hangUp();
}

function hangUp(): void {
  mic?.stop();
  speaker?.close();
  mic = null;
  speaker = null;
  heardLevel = 0;
  unsentMs = 0;
  early = [];
  set({ call: null });
}

export function muteCall(muted: boolean): void {
  const call = get().call;
  if (!call) return;
  mic?.mute(muted);
  set({ call: { ...call, muted } });
}

window.addEventListener("pagehide", endCall);

function send(provider: ProviderKind, talkId: string, pcm: Int16Array, level: number): void {
  heardLevel = level;
  if (unsentMs + CHUNK_MS > MAX_UNSENT_MS) return;
  unsentMs += CHUNK_MS;
  void mailApi
    .agentTalkAudio(provider, talkId, pcmToBase64(pcm))
    .catch(() => {})
    .finally(() => (unsentMs -= CHUNK_MS));
}

function onTalkEvent(event: TalkEvent): void {
  const call = get().call;
  if (!call) return;
  if (!call.talkId) {
    if (early.length < 500) early.push(event);
    return;
  }
  if (event.talkId !== call.talkId) return;
  switch (event.type) {
    case "ready":
      if (!call.liveAt) set({ call: { ...call, liveAt: Date.now() } });
      return;
    case "audio":
      speaker?.play(base64ToPcm(event.audio));
      return;
    case "clear":
      speaker?.clear();
      return;
    case "mark": {
      const { provider, talkId } = call;
      setTimeout(
        () => void mailApi.agentTalkPlayed(provider, talkId, event.name).catch(() => {}),
        speaker?.pendingMs() ?? 0,
      );
      return;
    }
    case "transcript":
      hearSpoken(call.chatId, event.role, event.text, event.final);
      return;
    case "closed":
      hangUp();
      if (event.error) toast.error("The call ended", { description: event.error });
  }
}

/** How loud the call is now (0–1), and whether that's the agent speaking. */
function callLevel(): { level: number; speaking: boolean } {
  const played = speaker?.level() ?? 0;
  if (played > 0.01) spokeAt = performance.now();
  if (performance.now() - spokeAt < SPEAKING_HOLD_MS) return { level: played, speaking: true };
  return { level: get().call?.muted ? 0 : heardLevel, speaking: false };
}

const BARS = [0.45, 0.75, 1, 0.75, 0.45];

/** Bars that follow the voice: yours while you talk, the agent's while it does. */
function CallMeter({ onSpeaking }: { onSpeaking: (speaking: boolean) => void }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    let frame = 0;
    let shown = 0;
    let speaking = false;
    const tick = () => {
      const now = callLevel();
      shown = shown * 0.6 + Math.min(1, now.level * 8) * 0.4;
      bars.current.forEach((bar, i) => {
        if (bar) bar.style.transform = `scaleY(${0.18 + 0.82 * shown * BARS[i]})`;
      });
      if (now.speaking !== speaking) onSpeaking((speaking = now.speaking));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [onSpeaking]);
  return (
    <span className="flex h-4 items-center gap-[3px]" aria-hidden>
      {BARS.map((_, i) => (
        <span
          // oxlint-disable-next-line react/no-array-index-key -- The bars are fixed.
          key={i}
          ref={(bar) => {
            bars.current[i] = bar;
          }}
          className="h-full w-[3px] rounded-full bg-current"
        />
      ))}
    </span>
  );
}

export function TalkButton({
  chatId,
  provider,
  sessionId,
  name,
  compact,
}: {
  chatId: string;
  provider: ProviderKind;
  sessionId: string | null;
  name: string;
  compact: boolean;
}) {
  const label = `Talk with ${name}`;
  return (
    <HintTooltip label={label}>
      <IconBtn
        label={label}
        className={cn("rounded-full", compact ? "size-7" : "size-8")}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => void startCall(chatId, provider, sessionId)}
      >
        <AudioLinesIcon className="size-4.5" />
      </IconBtn>
    </HintTooltip>
  );
}

function CallTime({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return <>{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}</>;
}

/** In the composer's place while you're on a call in its chat. */
export function TalkBar({ call, name, compact }: { call: Call; name: string; compact: boolean }) {
  const [speaking, setSpeaking] = useState(false);
  const status = !call.liveAt
    ? "Connecting…"
    : speaking
      ? `${name} is speaking`
      : call.muted
        ? "Muted"
        : "Listening";
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3",
        COMPOSER_SURFACE,
        compact ? "rounded-lg px-2.5 py-2" : "px-3 py-3",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full transition-colors",
          compact ? "size-8" : "size-10",
          speaking ? "bg-primary text-primary-foreground" : "bg-accent-surface text-foreground",
          !call.liveAt && "animate-pulse",
        )}
      >
        <CallMeter onSpeaking={setSpeaking} />
      </span>
      <div className="min-w-0 flex-1" aria-live="polite">
        <div className="truncate text-sm font-medium text-foreground">{status}</div>
        {call.liveAt && !compact ? (
          <div className="text-xs text-muted-foreground tabular-nums">
            <CallTime since={call.liveAt} />
          </div>
        ) : null}
      </div>
      <HintTooltip label={call.muted ? "Unmute" : "Mute"}>
        <IconBtn
          label={call.muted ? "Unmute" : "Mute"}
          active={call.muted}
          className={cn("shrink-0 rounded-full", compact ? "size-7" : "size-8")}
          onClick={() => muteCall(!call.muted)}
        >
          {call.muted ? <MicOffIcon className="size-4" /> : <MicIcon className="size-4" />}
        </IconBtn>
      </HintTooltip>
      <button
        type="button"
        onClick={endCall}
        className={cn(
          "flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-destructive/90 px-3.5 text-sm font-medium text-white shadow-xs shadow-destructive/24 inset-shadow-2xs inset-shadow-white/16 transition-colors hover:bg-destructive active:shadow-none",
          compact ? "h-7" : "h-8",
        )}
      >
        End
      </button>
    </div>
  );
}
