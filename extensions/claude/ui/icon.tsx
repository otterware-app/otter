import { CLAUDE_MARK } from "../shared/mark";

export function ClaudeIcon({ className }: { className?: string }) {
  return (
    <svg
      preserveAspectRatio="xMidYMid"
      viewBox={CLAUDE_MARK.viewBox}
      fill={CLAUDE_MARK.color}
      className={className}
      aria-hidden
    >
      <path d={CLAUDE_MARK.path} />
    </svg>
  );
}
