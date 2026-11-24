import { cn } from "@otter/ui/lib/utils";

import { OPENAI_MARK } from "../shared/mark";

export function OpenAIIcon({ className }: { className?: string }) {
  return (
    <svg
      preserveAspectRatio="xMidYMid"
      viewBox={OPENAI_MARK.viewBox}
      className={cn("fill-black dark:fill-white", className)}
      aria-hidden
    >
      <path d={OPENAI_MARK.path} />
    </svg>
  );
}
