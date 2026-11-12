import captureUrl from "./talk-capture.worklet.ts?worker&url";

export type Microphone = { stop: () => void; mute: (muted: boolean) => void };

/** The microphone at `rate`, in 40 ms chunks of 16-bit PCM, each with how loud it was (0–1). */
export async function openMicrophone(
  context: AudioContext,
  stream: MediaStream,
  rate: number,
  heard: (pcm: Int16Array, level: number) => void,
): Promise<Microphone> {
  await context.audioWorklet.addModule(captureUrl);
  const source = context.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(context, "talk-capture", {
    processorOptions: { rate },
  });
  const onChunk = (event: MessageEvent<{ pcm: Int16Array; level: number }>) =>
    heard(event.data.pcm, event.data.level);
  capture.port.addEventListener("message", onChunk);
  capture.port.start();
  source.connect(capture);
  // Only what reaches the output is processed; the capture writes silence there.
  capture.connect(context.destination);
  await context.resume();
  return {
    stop: () => {
      source.disconnect();
      capture.port.removeEventListener("message", onChunk);
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
    // A muted track sends silence, which the call still needs to hear.
    mute: (muted) => {
      for (const track of stream.getAudioTracks()) track.enabled = !muted;
    },
  };
}

/** Played a moment late after a pause, so audio arriving unevenly doesn't break up. */
const LEAD_S = 0.1;

export type Speaker = ReturnType<typeof openSpeaker>;

/** Plays 16-bit PCM at `rate` as it comes, one piece after another. */
export function openSpeaker(context: AudioContext, rate: number) {
  let queuedUntil = 0;
  const playing = new Set<AudioBufferSourceNode>();
  const levels: { from: number; to: number; level: number }[] = [];
  void context.resume();
  return {
    play(pcm: Int16Array) {
      const buffer = context.createBuffer(1, pcm.length, rate);
      const samples = buffer.getChannelData(0);
      let squares = 0;
      for (let i = 0; i < pcm.length; i++) {
        samples[i] = pcm[i] / 0x8000;
        squares += samples[i] * samples[i];
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const from = Math.max(context.currentTime + LEAD_S, queuedUntil);
      queuedUntil = from + buffer.duration;
      source.start(from);
      playing.add(source);
      source.addEventListener("ended", () => playing.delete(source));
      levels.push({ from, to: queuedUntil, level: Math.sqrt(squares / Math.max(1, pcm.length)) });
    },
    clear() {
      for (const source of playing) source.stop();
      playing.clear();
      levels.length = 0;
      queuedUntil = 0;
    },
    /** Two soft notes, rising: the agent is working, the call isn't stuck. */
    cue() {
      const at = context.currentTime + 0.02;
      for (const [hz, from, length] of [
        [587.33, 0, 0.09],
        [783.99, 0.13, 0.12],
      ]) {
        const tone = context.createOscillator();
        const gain = context.createGain();
        tone.frequency.value = hz;
        gain.gain.setValueAtTime(0, at + from);
        gain.gain.linearRampToValueAtTime(0.05, at + from + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + from + length);
        tone.connect(gain).connect(context.destination);
        tone.start(at + from);
        tone.stop(at + from + length + 0.02);
      }
    },
    /** Until what's queued has played. */
    pendingMs: () => Math.max(0, (queuedUntil - context.currentTime) * 1000),
    /** How loud what's playing now is (0–1). */
    level() {
      const now = context.currentTime;
      while (levels.length > 0 && levels[0].to < now) levels.shift();
      return levels[0] && levels[0].from <= now ? levels[0].level : 0;
    },
    close() {
      this.clear();
      void context.close();
    },
  };
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
