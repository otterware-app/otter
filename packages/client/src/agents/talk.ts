import type { ChatTurn } from "@otter/contracts/chats";
import { useEffect } from "react";
import { create } from "zustand";
import { listen } from "../bridge.ts";
import { host } from "../host.ts";
import { agentApi, type ProviderKind, type TalkEvent } from "./api.ts";
import { endSpoken, hearSpoken, setChatSession } from "./chat-store.ts";

/** The microphone, capturing for a call. */
export type Microphone = { stop: () => void; mute: (muted: boolean) => void };

/** What the call plays: the agent's voice, as it comes. */
export type Speaker = {
  /** Plays 16-bit PCM at the call's output rate, after what's queued. */
  play: (pcm: Int16Array) => void;
  /** Stops what's playing and drops what's queued (the agent was interrupted). */
  clear: () => void;
  /** A soft cue: the agent is working, the call isn't stuck. */
  cue: () => void;
  /** Until what's queued has played. */
  pendingMs: () => number | Promise<number>;
  /** How loud what's playing now is (0–1). */
  level: () => number;
  close: () => void;
};

/** What a call asks of the app's audio. */
export type TalkAudio = {
  /** The host can keep a running audio session when the app moves to the background. */
  staysActiveInBackground?: boolean;
  /**
   * Asks for the microphone while the tap that started the call still counts. Throws if permission
   * is refused. `interrupted` ends the call when the system takes the audio device back.
   */
  open(interrupted: () => void): Promise<TalkDevice>;
};

export type TalkDevice = {
  /** Captures 40 ms of mono 16-bit PCM at `rate`, with its level (0–1). A duplex device also needs the output rate. */
  listen(
    rate: number,
    heard: (pcm: Int16Array, level: number) => void,
    outputRate: number,
  ): Promise<Microphone>;
  speak(rate: number): Speaker;
  /** Lets go of what `open` took, when the call ends before `listen` and `speak` have it. */
  release(): void;
};

export type Call = {
  id: string;
  chatId: string;
  provider: ProviderKind;
  talkId: string | null;
  /** When the agent's voice came on. */
  liveAt: number | null;
  muted: boolean;
  /** The agent's voice is heard; off, the call goes on in silence. */
  sound: boolean;
};

/** The call going on, in one chat at a time: there's one microphone. */
export const useTalk = create<{ call: Call | null }>(() => ({ call: null }));
const { getState: get, setState: set } = useTalk;

const CHUNK_MS = 40;
/** Audio the gateway hasn't taken yet: past this, what the microphone hears is dropped. */
const MAX_UNSENT_MS = 3000;
/** The agent counts as speaking this long after it last made a sound, between words. */
const SPEAKING_HOLD_MS = 600;
/** While the agent works and the voice has been quiet this long, a soft cue: the call isn't stuck. */
const CUE_AFTER_MS = 6000;

let mic: Microphone | null = null;
let speaker: Speaker | null = null;
let heardLevel = 0;
let unsentMs = 0;
let spokeAt = -Infinity;
/** What the gateway sent before it said which call it was. */
let early: TalkEvent[] = [];
let stopListening: (() => void) | null = null;
let stopLeaving: (() => void) | null = null;
let onEnd: ((error: string | null, liveFor: number) => void) | undefined;
/**
 * How far the agent's voice has got through its words: each sound queued reaches the words heard
 * when it came, at the time it will have played.
 */
let outputRate = 0;
let playsUntil = 0;
let agentChars = 0;
let utteranceChars = 0;
let playedChars = 0;
let reaches: { at: number; chars: number }[] = [];
/** Past this long with nothing playing, everything the voice has said has been heard. */
const SAID_AFTER_MS = 400;

const isCurrent = (id: string) => get().call?.id === id;

class Cancelled extends Error {}

/** Starts a call in the chat (its session, or a new one); a call going on ends first. */
export async function startCall(
  chatId: string,
  provider: ProviderKind,
  sessionId: string | null,
  audio: TalkAudio,
  /** The call ended, after being live this long (ms). */
  ended?: (error: string | null, liveFor: number) => void,
): Promise<void> {
  endCall();
  const call: Call = {
    id: crypto.randomUUID(),
    chatId,
    provider,
    talkId: null,
    liveAt: null,
    muted: false,
    sound: true,
  };
  onEnd = ended;
  set({ call });
  stopListening ??= listen("agent:talkEvent", (event: unknown) => onTalkEvent(event as TalkEvent));
  stopLeaving = host().onLeave(() => {
    if (!audio.staysActiveInBackground || !get().call?.talkId) endCall();
  });
  let device: TalkDevice | null = null;
  let talkId: string | null = null;
  // Kept here until the call is still this one: hanging up meanwhile can't reach it.
  let opened: Microphone | null = null;
  try {
    device = await audio.open(() => {
      if (isCurrent(call.id)) endCall();
    });
    if (!isCurrent(call.id)) throw new Cancelled();
    const started = await agentApi.talkStart(provider, sessionId);
    talkId = started.talkId;
    if (!isCurrent(call.id)) throw new Cancelled();
    setChatSession(chatId, provider, started.sessionId);
    opened = await device.listen(
      started.inputRate,
      (pcm, level) => send(call, started.talkId, pcm, level),
      started.outputRate,
    );
    const now = get().call;
    if (now?.id !== call.id) throw new Cancelled();
    mic = opened;
    mic.mute(now.muted);
    speaker = device.speak(started.outputRate);
    outputRate = started.outputRate;
    set({ call: { ...now, talkId } });
    for (const event of early.splice(0)) {
      if (!isCurrent(call.id)) break;
      onTalkEvent(event);
    }
  } catch (error) {
    if (talkId) void agentApi.talkEnd(provider, talkId).catch(() => {});
    opened?.stop();
    device?.release();
    if (!isCurrent(call.id)) return;
    hangUp({
      title: "Couldn't start the call",
      body: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Hangs up; what the agent was asked to do goes on, and its answer still comes to the chat. */
export function endCall(): void {
  const call = get().call;
  if (!call) return;
  if (call.talkId) void agentApi.talkEnd(call.provider, call.talkId).catch(() => {});
  hangUp();
}

function hangUp(error?: { title: string; body: string }): void {
  const call = get().call;
  if (call) endSpoken(call.chatId);
  const liveFor = call?.liveAt ? Date.now() - call.liveAt : 0;
  stopLeaving?.();
  stopLeaving = null;
  mic?.stop();
  speaker?.close();
  mic = null;
  speaker = null;
  heardLevel = 0;
  unsentMs = 0;
  spokeAt = -Infinity;
  early = [];
  outputRate = playsUntil = agentChars = utteranceChars = playedChars = 0;
  reaches = [];
  const ended = onEnd;
  onEnd = undefined;
  set({ call: null });
  if (ended) ended(error?.body ?? null, liveFor);
  else if (error) host().notice({ tone: "error", ...error });
}

export function muteCall(muted: boolean): void {
  const call = get().call;
  if (!call) return;
  mic?.mute(muted);
  set({ call: { ...call, muted } });
}

/** Turns the agent's voice off or on: off, it plays silence, so the call keeps its timing. */
export function soundCall(sound: boolean): void {
  const call = get().call;
  if (!call) return;
  set({ call: { ...call, sound } });
}

function send(call: Call, talkId: string, pcm: Int16Array, level: number): void {
  const current = get().call;
  if (current?.id !== call.id) return;
  heardLevel = level;
  if (unsentMs + CHUNK_MS > MAX_UNSENT_MS) return;
  unsentMs += CHUNK_MS;
  void agentApi
    .talkAudio(call.provider, talkId, pcmToBase64(current.muted ? new Int16Array(pcm.length) : pcm))
    .catch(() => {})
    .finally(() => {
      if (isCurrent(call.id)) unsentMs -= CHUNK_MS;
    });
}

async function markPlayed(call: Call, talkId: string, name: string): Promise<void> {
  const pending = await speaker?.pendingMs();
  if (!isCurrent(call.id)) return;
  setTimeout(() => {
    if (isCurrent(call.id)) void agentApi.talkPlayed(call.provider, talkId, name).catch(() => {});
  }, pending ?? 0);
}

function onTalkEvent(event: TalkEvent): void {
  const call = get().call;
  if (!call) return;
  if (!call.talkId) {
    if (early.length < 500) early.push(event);
    return;
  }
  if (event.talkId !== call.talkId) return;
  // The voice is there once it says anything: its "ready" can come before the call is known.
  if (!call.liveAt && event.type !== "closed") set({ call: { ...call, liveAt: Date.now() } });
  switch (event.type) {
    case "ready":
      return;
    case "audio":
      const pcm = base64ToPcm(event.audio);
      speaker?.play(call.sound ? pcm : new Int16Array(pcm.length));
      if (outputRate) {
        playsUntil = Math.max(performance.now(), playsUntil) + (pcm.length / outputRate) * 1000;
        reaches.push({ at: playsUntil, chars: agentChars });
      }
      return;
    case "clear":
      speaker?.clear();
      reaches = [];
      playedChars = agentChars;
      playsUntil = performance.now();
      return;
    case "mark":
      void markPlayed(call, call.talkId, event.name).catch(() => {});
      return;
    case "transcript":
      hearSpoken(call.chatId, event.role, event.text, event.final);
      if (event.role === "assistant") {
        const more = event.final ? event.text.trim().length - utteranceChars : event.text.length;
        agentChars += Math.max(0, more);
        utteranceChars = event.final ? 0 : utteranceChars + event.text.length;
      }
      return;
    case "closed":
      hangUp(event.error ? { title: "The call ended", body: event.error } : undefined);
  }
}

/** How loud each side of the call is now (0–1), and whether the agent is speaking. */
export function callLevels(): { you: number; agent: number; speaking: boolean } {
  const played = speaker?.level() ?? 0;
  if (played > 0.01) spokeAt = performance.now();
  return {
    you: get().call?.muted ? 0 : Math.min(1, heardLevel * 8),
    agent: Math.min(1, played * 8),
    speaking: performance.now() - spokeAt < SPEAKING_HOLD_MS,
  };
}

/** How many of the agent's last words in the call its voice hasn't said yet: the end of what it's saying. */
export function callUnsaid(): number {
  const now = performance.now();
  while (reaches.length > 0 && reaches[0].at <= now)
    playedChars = Math.max(playedChars, reaches.shift()!.chars);
  if (reaches.length === 0 && now - playsUntil > SAID_AFTER_MS) playedChars = agentChars;
  return Math.max(0, agentChars - playedChars);
}

/** While the agent works on a live call and its voice has long been quiet, a soft cue now and then. */
export function useWorkingCue(working: boolean, live: boolean): void {
  useEffect(() => {
    if (!working || !live) return;
    let cuedAt = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      if (now - Math.max(spokeAt, cuedAt) < CUE_AFTER_MS) return;
      cuedAt = now;
      speaker?.cue();
    }, 500);
    return () => clearInterval(timer);
  }, [working, live]);
}

/** What the call bar says. */
export function callStatus(
  call: Call,
  { name, speaking, working }: { name: string; speaking: boolean; working: boolean },
): string {
  if (!call.liveAt) return "Connecting…";
  if (speaking) return `${name} is speaking`;
  if (working) return `${name} is working…`;
  return call.muted ? "Muted" : "Listening";
}

/** What's being said in the call, as its caption shows it: the last thing said since `since`. */
export function callCaption(
  turns: readonly ChatTurn[],
  since: number,
): { id: string; speaker: "you" | "agent"; text: string; done: boolean } | null {
  const said = turns.findLast((turn) => turn.spoken && (turn.startedAt ?? 0) >= since);
  if (!said) return null;
  const text = (
    said.role === "user"
      ? said.text
      : (said.items?.map((item) => (item.kind === "text" ? item.text : "")).join("") ?? "")
  )
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return {
    id: said.id,
    speaker: said.role === "user" ? "you" : "agent",
    text,
    done: said.finishedAt !== undefined,
  };
}

/** How long a call lasted, as the card after it says: "1m 20s". */
export function callLasted(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToPcm(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length & ~1);
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}
