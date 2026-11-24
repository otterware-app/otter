import { base64ToPcm, pcmToBase64, type TalkAudio } from "@otter/client/agents/talk";
import { requireOptionalNativeModule } from "expo";

type TalkEvents = {
  capture: { id: string; pcm: string; level: number; played: number };
  interrupted: { id: string };
};

type TalkModule = {
  addListener<Event extends keyof TalkEvents>(
    event: Event,
    listener: (payload: TalkEvents[Event]) => void,
  ): { remove(): void };
  requestPermission(): Promise<boolean>;
  start(id: string, inputRate: number, outputRate: number): Promise<void>;
  stop(id: string): Promise<void>;
  mute(id: string, muted: boolean): Promise<void>;
  play(id: string, pcm: string): Promise<void>;
  clear(id: string): Promise<void>;
  cue(id: string): Promise<void>;
  pendingMs(id: string): Promise<number>;
};

function nativeTalkAudio(native: TalkModule): TalkAudio {
  return {
    staysActiveInBackground: true,
    async open(interrupted) {
      if (!(await native.requestPermission())) {
        throw new Error(
          "Otter Agents isn't allowed to use the microphone. Allow it in Settings › Otter Agents.",
        );
      }
      const id = crypto.randomUUID();
      let playingLevel = 0;
      let unsubscribe: (() => void) | undefined;
      const release = () => {
        if (!unsubscribe) return;
        unsubscribe();
        unsubscribe = undefined;
        void native.stop(id).catch(() => {});
      };
      return {
        async listen(rate, heard, outputRate) {
          const capture = native.addListener("capture", (event) => {
            if (event.id !== id) return;
            playingLevel = event.played;
            heard(base64ToPcm(event.pcm), event.level);
          });
          const interruption = native.addListener("interrupted", (event) => {
            if (event.id === id) interrupted();
          });
          unsubscribe = () => {
            capture.remove();
            interruption.remove();
          };
          await native.start(id, rate, outputRate);
          return { stop: release, mute: (muted) => void native.mute(id, muted).catch(() => {}) };
        },
        speak: () => ({
          play: (pcm) => void native.play(id, pcmToBase64(pcm)).catch(() => {}),
          clear: () => void native.clear(id).catch(() => {}),
          cue: () => void native.cue(id).catch(() => {}),
          pendingMs: () => native.pendingMs(id),
          level: () => playingLevel,
          close: release,
        }),
        release,
      };
    },
  };
}

const native = requireOptionalNativeModule<TalkModule>("OtterTalk");
export const phoneTalkAudio = native ? nativeTalkAudio(native) : null;
