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
  pendingMs: () => number;
  /** How loud what's playing now is (0–1). */
  level: () => number;
  close: () => void;
};

/** What a call asks of the app's audio. */
export type TalkAudio = {
  /**
   * Asks for the microphone, while the tap that started the call still counts; throws an error
   * to show when it's refused.
   */
  open(): Promise<TalkDevice>;
};

export type TalkDevice = {
  /** Starts capturing at `rate`: 40 ms chunks of mono 16-bit PCM, each with how loud it was (0–1). */
  listen(rate: number, heard: (pcm: Int16Array, level: number) => void): Promise<Microphone>;
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
};

/** The call going on, in one chat at a time: there's one microphone. */
export const useTalk = create<{ call: Call | null }>(() => ({ call: null }));
const { getState: get, setState: set } = useTalk;

const CHUNK_MS = 40;
/** Audio the gateway hasn't taken yet: past this, what the microphone hears is dropped. */
const MAX_UNSENT_MS = 3000;
/** The agent counts as speaking this long after it last made a sound, between words. */
const SPEAKING_HOLD_MS = 600;
/** While the agent works and the voice is quiet, a soft cue this often: the call isn't stuck. */
const CUE_EVERY_MS = 2200;

let mic: Microphone | null = null;
let speaker: Speaker | null = null;
let heardLevel = 0;
let unsentMs = 0;
let spokeAt = 0;
/** What the gateway sent before it said which call it was. */
let early: TalkEvent[] = [];
let stopListening: (() => void) | null = null;
let stopLeaving: (() => void) | null = null;

const isCurrent = (id: string) => get().call?.id === id;

class Cancelled extends Error {}

/** Starts a call in the chat (its session, or a new one); a call going on ends first. */
export async function startCall(
  chatId: string,
  provider: ProviderKind,
  sessionId: string | null,
  audio: TalkAudio,
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
  stopListening ??= listen("agent:talkEvent", (event: unknown) => onTalkEvent(event as TalkEvent));
  stopLeaving ??= host().onLeave(endCall);
  const opening = audio.open();
  let device: TalkDevice | null = null;
  let talkId: string | null = null;
  // Kept here until the call is still this one: hanging up meanwhile can't reach it.
  let opened: Microphone | null = null;
  try {
    device = await opening;
    if (!isCurrent(call.id)) throw new Cancelled();
    const started = await agentApi.talkStart(provider, sessionId);
    talkId = started.talkId;
    if (!isCurrent(call.id)) throw new Cancelled();
    setChatSession(chatId, provider, started.sessionId);
    const id = talkId;
    opened = await device.listen(started.inputRate, (pcm, level) => send(provider, id, pcm, level));
    const now = get().call;
    if (now?.id !== call.id) throw new Cancelled();
    mic = opened;
    mic.mute(now.muted);
    speaker = device.speak(started.outputRate);
    set({ call: { ...now, talkId } });
    for (const event of early.splice(0)) onTalkEvent(event);
  } catch (error) {
    if (talkId) void agentApi.talkEnd(provider, talkId).catch(() => {});
    opened?.stop();
    device?.release();
    if (!isCurrent(call.id)) return;
    hangUp();
    if (!(error instanceof Cancelled))
      host().notice({
        tone: "error",
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

function hangUp(): void {
  const chatId = get().call?.chatId;
  if (chatId) endSpoken(chatId);
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

function send(provider: ProviderKind, talkId: string, pcm: Int16Array, level: number): void {
  heardLevel = level;
  if (unsentMs + CHUNK_MS > MAX_UNSENT_MS) return;
  unsentMs += CHUNK_MS;
  void agentApi
    .talkAudio(provider, talkId, pcmToBase64(pcm))
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
  // The voice is there once it says anything: its "ready" can come before the call is known.
  if (!call.liveAt && event.type !== "closed") set({ call: { ...call, liveAt: Date.now() } });
  switch (event.type) {
    case "ready":
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
        () => void agentApi.talkPlayed(provider, talkId, event.name).catch(() => {}),
        speaker?.pendingMs() ?? 0,
      );
      return;
    }
    case "transcript":
      hearSpoken(call.chatId, event.role, event.text, event.final);
      return;
    case "closed":
      hangUp();
      if (event.error) host().notice({ tone: "error", title: "The call ended", body: event.error });
  }
}

/** How loud the call is now (0–1), and whether that's the agent speaking. */
export function callLevel(): { level: number; speaking: boolean } {
  const played = speaker?.level() ?? 0;
  if (played > 0.01) spokeAt = performance.now();
  if (performance.now() - spokeAt < SPEAKING_HOLD_MS) return { level: played, speaking: true };
  return { level: get().call?.muted ? 0 : heardLevel, speaking: false };
}

/** While the agent works on a live call and its voice is quiet, a soft cue now and then. */
export function useWorkingCue(working: boolean, live: boolean): void {
  useEffect(() => {
    if (!working || !live) return;
    const timer = setInterval(() => {
      if (performance.now() - spokeAt >= SPEAKING_HOLD_MS) speaker?.cue();
    }, CUE_EVERY_MS);
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

/** How long the call has been live: "3:07". */
export function callTime(since: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
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
