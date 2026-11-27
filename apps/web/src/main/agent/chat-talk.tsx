import { useEffect, useRef, useState } from "react";
import { AudioLinesIcon, MicIcon, MicOffIcon, XIcon } from "lucide-react";

import { COMPOSER_SURFACE } from "../mail/composer-kit";
import { openClawAgentId } from "@otter/client/agents/agent-providers";
import { useChats } from "@otter/client/agents/chat-store";
import {
  callCaption,
  callLevels,
  callStatus,
  endCall,
  muteCall,
  startCall,
  type Call,
} from "@otter/client/agents/talk";
import { browserTalkAudio } from "./talk-audio";
import { AgentAvatar } from "./agent-providers";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { Button, IconButton } from "@otter/ui/components/button";
import { Spinner } from "@otter/ui/components/spinner";
import { cn } from "@otter/ui/lib/utils";
import type { ProviderKind } from "@otter/client/agents/api";

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

/**
 * The call, in the composer's place while it runs, and no bigger than a line: a pill with the
 * agent's face breathing with the audio and what's being said (else the call's state), then the
 * microphone and hanging up as round buttons of their own.
 */
export function TalkBar({ call, name, compact }: { call: Call; name: string; compact: boolean }) {
  const [speaking, setSpeaking] = useState(false);
  const [since] = useState(Date.now);
  const working = useChats((s) => Boolean(s.runs[call.chatId]));
  const convo = useChats((s) => s.conversations.find((c) => c.id === call.chatId));
  const connecting = call.liveAt === null;
  const caption = convo ? callCaption(convo.turns, since) : null;
  const saying = caption && !caption.done ? caption : null;
  const muteLabel = call.muted ? "Unmute" : "Mute";
  return (
    <section aria-label={`Call with ${name}`} className="flex w-full items-center gap-2">
      <div
        className={cn(
          "flex h-12 min-w-0 flex-1 items-center gap-2 px-1.5",
          COMPOSER_SURFACE,
          "rounded-full",
        )}
      >
        <VoiceOrb
          provider={call.provider}
          agent={openClawAgentId(convo?.sessionId ?? null)}
          busy={connecting || (working && !speaking)}
          onSpeaking={setSpeaking}
        />
        <span
          aria-live="polite"
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            saying?.speaker === "agent" ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {saying?.text ?? callStatus(call, { name, speaking, working })}
        </span>
      </div>
      <HintTooltip label={muteLabel}>
        <Button
          variant="ghost"
          aria-label={muteLabel}
          aria-pressed={call.muted}
          disabled={connecting}
          className={cn(
            "size-12 shrink-0 rounded-full px-0",
            COMPOSER_SURFACE,
            "rounded-full",
            call.muted ? "text-destructive-foreground" : "text-foreground",
          )}
          onClick={() => muteCall(!call.muted)}
        >
          {call.muted ? <MicOffIcon className="size-5" /> : <MicIcon className="size-5" />}
        </Button>
      </HintTooltip>
      <HintTooltip label="End call">
        <Button
          variant="destructive"
          aria-label="End call"
          className={cn("shrink-0 rounded-full px-0", compact ? "size-11" : "size-12")}
          onClick={endCall}
        >
          <XIcon className="size-5" />
        </Button>
      </HintTooltip>
    </section>
  );
}

/**
 * The agent's face, with a halo that swells as it speaks and a ring that widens as you do: both
 * at once when you talk over each other. Drawn straight from the audio levels, outside React's
 * render.
 */
function VoiceOrb({
  provider,
  agent,
  busy,
  onSpeaking,
}: {
  provider: ProviderKind;
  agent: string | null;
  busy: boolean;
  onSpeaking: (speaking: boolean) => void;
}) {
  const halo = useRef<HTMLSpanElement>(null);
  const ring = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let agentLevel = 0;
    let yours = 0;
    let speaking = false;
    const draw = () => {
      const levels = callLevels();
      if (levels.speaking !== speaking) onSpeaking((speaking = levels.speaking));
      if (!still) {
        // Eased, so the halo breathes with speech instead of flickering with each sample.
        agentLevel += (levels.agent - agentLevel) * 0.3;
        yours += (levels.you - yours) * 0.3;
        if (halo.current) {
          halo.current.style.transform = `scale(${1 + agentLevel * 0.6})`;
          halo.current.style.opacity = String(0.25 + agentLevel * 0.5);
        }
        if (ring.current) {
          ring.current.style.transform = `scale(${1 + yours * 0.45})`;
          ring.current.style.opacity = String(yours * 1.5);
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [onSpeaking]);

  return (
    <div aria-hidden className="relative flex size-9 shrink-0 items-center justify-center">
      <span ref={halo} className="absolute inset-0 rounded-full bg-primary/40 opacity-25" />
      <span
        ref={ring}
        className="absolute inset-0 rounded-full border border-foreground/50 opacity-0"
      />
      <span className="relative flex size-8 items-center justify-center overflow-hidden rounded-full bg-accent-surface">
        <AgentAvatar id={provider} agent={agent} className="size-5" />
      </span>
      {busy ? <Spinner aria-hidden className="absolute -inset-1 size-11 opacity-50" /> : null}
    </div>
  );
}
