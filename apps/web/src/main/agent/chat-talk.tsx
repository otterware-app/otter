import { useEffect, useRef, useState } from "react";
import { AudioLinesIcon, MicIcon, MicOffIcon } from "lucide-react";

import { COMPOSER_SURFACE } from "../mail/composer-kit";
import { useChats } from "@otter/client/agents/chat-store";
import {
  callLevel,
  callStatus,
  callTime,
  endCall,
  muteCall,
  startCall,
  useWorkingCue,
  type Call,
} from "@otter/client/agents/talk";
import { browserTalkAudio } from "./talk-audio";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { Button, IconButton } from "@otter/ui/components/button";
import { cn } from "@otter/ui/lib/utils";
import type { ProviderKind } from "@otter/client/agents/api";

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
      <IconButton
        label={label}
        size={compact ? "icon-sm" : "icon"}
        className="rounded-pill"
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => void startCall(chatId, provider, sessionId, browserTalkAudio)}
      >
        <AudioLinesIcon className="size-4.5" />
      </IconButton>
    </HintTooltip>
  );
}

function CallTime({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{callTime(since, now)}</>;
}

/** In the composer's place while you're on a call in its chat. */
export function TalkBar({ call, name, compact }: { call: Call; name: string; compact: boolean }) {
  const [speaking, setSpeaking] = useState(false);
  const working = useChats((s) => Boolean(s.runs[call.chatId]));
  const live = call.liveAt !== null;
  useWorkingCue(working, live);
  const status = callStatus(call, { name, speaking, working });
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
        <IconButton
          label={call.muted ? "Unmute" : "Mute"}
          active={call.muted}
          size={compact ? "icon-sm" : "icon"}
          className="shrink-0 rounded-pill"
          onClick={() => muteCall(!call.muted)}
        >
          {call.muted ? <MicOffIcon className="size-4" /> : <MicIcon className="size-4" />}
        </IconButton>
      </HintTooltip>
      <Button
        variant="destructive"
        size={compact ? "sm" : "default"}
        onClick={endCall}
        className="rounded-pill bg-destructive/90 px-3.5 text-sm font-medium shadow-xs shadow-destructive/24 inset-shadow-2xs inset-shadow-white/16 hover:bg-destructive active:shadow-none margin:inset-shadow-none margin:shadow-none"
      >
        End
      </Button>
    </div>
  );
}
