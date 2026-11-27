import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Host, Notice } from "../host.ts";
import type { TalkEvent } from "./api.ts";
import type { Microphone, Speaker, TalkAudio, TalkDevice } from "./talk.ts";

type Talk = typeof import("./talk.ts");

function fakeCore() {
  const listeners = new Map<string, Set<(params: unknown) => void>>();
  const answers: Record<string, (params: any) => unknown> = {
    "agent:talkStart": () => ({
      talkId: "t1",
      sessionId: "s1",
      inputRate: 16000,
      outputRate: 24000,
    }),
  };
  const invoke = vi.fn(async (channel: string, params?: unknown) =>
    channel in answers ? answers[channel](params) : { ok: true },
  );
  return {
    answers,
    calls: (channel: string) =>
      invoke.mock.calls.filter(([c]) => c === channel).map(([, params]) => params as any),
    emit: (event: TalkEvent) =>
      listeners.get("agent:talkEvent")?.forEach((listener) => listener(event)),
    bridge: {
      platform: "test",
      features: {},
      invoke,
      on: (channel: string, listener: (params: unknown) => void) => {
        const set = listeners.get(channel) ?? new Set();
        set.add(listener);
        listeners.set(channel, set);
        return () => set.delete(listener);
      },
    },
  };
}

/** The app's audio, recording what the call does with it. */
function fakeAudio() {
  let heard: ((pcm: Int16Array, level: number) => void) | null = null;
  const mic: Microphone = { stop: vi.fn(), mute: vi.fn() };
  const speaker: Speaker = {
    play: vi.fn(),
    clear: vi.fn(),
    cue: vi.fn(),
    pendingMs: () => 250,
    level: () => 0,
    close: vi.fn(),
  };
  const device: TalkDevice = {
    listen: vi.fn(async (_rate, onHeard) => {
      heard = onHeard;
      return mic;
    }),
    speak: vi.fn(() => speaker),
    release: vi.fn(),
  };
  let open: () => Promise<TalkDevice> = async () => device;
  const audio: TalkAudio = { open: () => open() };
  return {
    audio,
    device,
    mic,
    speaker,
    hear: (level = 0.5, pcm = new Int16Array(640)) => heard?.(pcm, level),
    failOpen: (message: string) => (open = async () => Promise.reject(new Error(message))),
    holdOpen: () => {
      let resolve!: (d: TalkDevice) => void;
      open = () => new Promise((r) => (resolve = r));
      return () => resolve(device);
    },
  };
}

let core: ReturnType<typeof fakeCore>;
let audio: ReturnType<typeof fakeAudio>;
let notices: Notice[];
let leaving: Set<() => void>;
let talk: Talk;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  core = fakeCore();
  audio = fakeAudio();
  notices = [];
  leaving = new Set();
  (globalThis as { desktopBridge?: unknown }).desktopBridge = core.bridge;
  const host: Host = {
    storage: { get: () => null, set: () => {} },
    focused: () => true,
    onFocusChange: () => () => {},
    onLeave: (listener) => {
      leaving.add(listener);
      return () => leaving.delete(listener);
    },
    notice: (notice) => {
      notices.push(notice);
      return () => {};
    },
    agentMark: () => undefined,
  };
  (await import("../host.ts")).setHost(host);
  talk = await import("./talk.ts");
});

afterEach(() => {
  vi.useRealTimers();
});

const settle = () => vi.advanceTimersByTimeAsync(0);
const call = () => talk.useTalk.getState().call;

async function connected() {
  void talk.startCall("chat-1", "oc", "s0", audio.audio);
  await settle();
  return call()!;
}

describe("a call", () => {
  it("starts in the chat's session, listening at the call's rate and speaking at its own", async () => {
    const started = await connected();
    expect(core.calls("agent:talkStart")).toEqual([{ provider: "oc", sessionId: "s0" }]);
    expect(started).toMatchObject({ chatId: "chat-1", talkId: "t1", liveAt: null, muted: false });
    expect(audio.device.listen).toHaveBeenCalledWith(16000, expect.any(Function), 24000);
    expect(audio.device.speak).toHaveBeenCalledWith(24000);
    expect(audio.mic.mute).toHaveBeenCalledWith(false);
  });

  it("is live once the voice says anything, and plays it", async () => {
    await connected();
    core.emit({ talkId: "t1", type: "audio", audio: btoa("\x01\x00\x02\x00") });
    expect(call()?.liveAt).not.toBeNull();
    expect(audio.speaker.play).toHaveBeenCalledWith(new Int16Array([1, 2]));
    core.emit({ talkId: "t1", type: "clear" });
    expect(audio.speaker.clear).toHaveBeenCalled();
  });

  it("plays silence in the voice's place with the sound off", async () => {
    await connected();
    talk.soundCall(false);
    core.emit({ talkId: "t1", type: "audio", audio: btoa("\x01\x00\x02\x00") });
    expect(audio.speaker.play).toHaveBeenCalledWith(new Int16Array(2));
  });

  it("keeps what came before the call was known, and plays it once it is", async () => {
    const release = audio.holdOpen();
    void talk.startCall("chat-1", "oc", null, audio.audio);
    core.emit({ talkId: "t1", type: "audio", audio: btoa("\x01\x00") });
    expect(audio.speaker.play).not.toHaveBeenCalled();
    release();
    await settle();
    expect(audio.speaker.play).toHaveBeenCalledTimes(1);
  });

  it("ignores another call's events", async () => {
    await connected();
    core.emit({ talkId: "other", type: "audio", audio: btoa("\x01\x00") });
    expect(audio.speaker.play).not.toHaveBeenCalled();
    expect(call()?.liveAt).toBeNull();
  });

  it("says a mark was heard once what's queued before it has played", async () => {
    await connected();
    core.emit({ talkId: "t1", type: "mark", name: "m1" });
    expect(core.calls("agent:talkPlayed")).toEqual([]);
    await vi.advanceTimersByTimeAsync(250);
    expect(core.calls("agent:talkPlayed")).toEqual([{ provider: "oc", talkId: "t1", mark: "m1" }]);
  });

  it("gets playback timing from the native queue and drops a mark for a call that ended", async () => {
    let queued!: (ms: number) => void;
    vi.spyOn(audio.speaker, "pendingMs").mockReturnValue(
      new Promise((resolve) => (queued = resolve)),
    );
    await connected();
    core.emit({ talkId: "t1", type: "mark", name: "m1" });
    await vi.advanceTimersByTimeAsync(500);
    expect(core.calls("agent:talkPlayed")).toEqual([]);
    queued(250);
    await vi.advanceTimersByTimeAsync(249);
    expect(core.calls("agent:talkPlayed")).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    const played = [{ provider: "oc", talkId: "t1", mark: "m1" }];
    expect(core.calls("agent:talkPlayed")).toEqual(played);
    core.emit({ talkId: "t1", type: "mark", name: "m2" });
    await settle();
    talk.endCall();
    await vi.advanceTimersByTimeAsync(250);
    expect(core.calls("agent:talkPlayed")).toEqual(played);
  });

  it("sends what the microphone hears, dropping it when the gateway falls behind", async () => {
    await connected();
    const never = new Promise(() => {});
    core.answers["agent:talkAudio"] = () => never;
    for (let i = 0; i < 80; i++) audio.hear();
    expect(core.calls("agent:talkAudio")).toHaveLength(75);
  });

  it("mutes the microphone", async () => {
    await connected();
    talk.muteCall(true);
    expect(audio.mic.mute).toHaveBeenLastCalledWith(true);
    expect(call()?.muted).toBe(true);
    audio.hear(0.5, new Int16Array([123]));
    expect(core.calls("agent:talkAudio").at(-1)?.audio).toBe(btoa("\x00\x00"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(talk.callLevels()).toEqual({ you: 0, agent: 0, speaking: false });
    talk.muteCall(false);
    expect(talk.callLevels()).toEqual({ you: 1, agent: 0, speaking: false });
  });

  it("hangs up: the gateway hears it, and the microphone and speaker close", async () => {
    await connected();
    talk.endCall();
    expect(core.calls("agent:talkEnd")).toEqual([{ provider: "oc", talkId: "t1" }]);
    expect(audio.mic.stop).toHaveBeenCalled();
    expect(audio.speaker.close).toHaveBeenCalled();
    expect(call()).toBeNull();
  });

  it("ends when the gateway closes it, saying why", async () => {
    await connected();
    core.emit({ talkId: "t1", type: "closed", error: "Gateway went away" });
    expect(call()).toBeNull();
    expect(core.calls("agent:talkEnd")).toEqual([]);
    expect(notices).toEqual([
      { tone: "error", title: "The call ended", body: "Gateway went away" },
    ]);
  });

  it("lets the phone screen show the failure from a call it owns", async () => {
    const ended = vi.fn();
    await talk.startCall("chat-1", "oc", "s0", audio.audio, ended);
    core.emit({ talkId: "t1", type: "closed", error: "Gateway went away" });
    expect(ended).toHaveBeenCalledExactlyOnceWith("Gateway went away", expect.any(Number));
    expect(notices).toEqual([]);
  });

  it("ends as the app goes", async () => {
    await connected();
    for (const listener of leaving) listener();
    expect(call()).toBeNull();
  });

  it("keeps running on a host with background audio and ends if iOS takes the audio session", async () => {
    let interrupted!: () => void;
    await talk.startCall("chat-1", "oc", null, {
      staysActiveInBackground: true,
      open: (stop) => {
        interrupted = stop;
        return audio.audio.open(stop);
      },
    });
    for (const listener of leaving) listener();
    expect(call()?.talkId).toBe("t1");
    interrupted();
    expect(call()).toBeNull();
  });

  it("says why it couldn't start, and lets go of what it took", async () => {
    audio.failOpen("Otter isn't allowed to use the microphone.");
    void talk.startCall("chat-1", "oc", null, audio.audio);
    await settle();
    expect(call()).toBeNull();
    expect(notices).toEqual([
      {
        tone: "error",
        title: "Couldn't start the call",
        body: "Otter isn't allowed to use the microphone.",
      },
    ]);
    core.answers["agent:talkStart"] = () => Promise.reject(new Error("No talk here"));
    void talk.startCall("chat-1", "oc", null, fakeAudio().audio);
    await settle();
    expect(notices.at(-1)?.body).toBe("No talk here");
  });

  it("starting over hangs up quietly, freeing what the first one opened", async () => {
    const first = fakeAudio();
    const release = first.holdOpen();
    void talk.startCall("chat-1", "oc", null, first.audio);
    void talk.startCall("chat-2", "oc", null, audio.audio);
    release();
    await settle();
    expect(first.device.release).toHaveBeenCalled();
    expect(first.device.listen).not.toHaveBeenCalled();
    expect(call()?.chatId).toBe("chat-2");
    expect(notices).toEqual([]);
  });
});

describe("what the call bar says", () => {
  const base = {
    id: "c",
    chatId: "x",
    provider: "oc",
    talkId: "t",
    liveAt: 1,
    muted: false,
    sound: true,
  };

  it("puts connecting, then the agent speaking, working, muted, listening", () => {
    const say = (over: object, state: { speaking?: boolean; working?: boolean } = {}) =>
      talk.callStatus(
        { ...base, ...over },
        { name: "Ops", speaking: false, working: false, ...state },
      );
    expect(say({ liveAt: null }, { speaking: true })).toBe("Connecting…");
    expect(say({ muted: true }, { speaking: true, working: true })).toBe("Ops is speaking");
    expect(say({ muted: true }, { working: true })).toBe("Ops is working…");
    expect(say({ muted: true })).toBe("Muted");
    expect(say({})).toBe("Listening");
  });

  it("says how long a call lasted", () => {
    expect(talk.callLasted(80_400)).toBe("1 min 20 s");
    expect(talk.callLasted(200)).toBe("1 s");
  });
});
