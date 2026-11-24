import { VARYS_MARK } from "../shared/mark";

export function VarysIcon({ className }: { className?: string }) {
  return (
    <svg viewBox={VARYS_MARK.viewBox} className={className} aria-hidden>
      <path fill="currentColor" d={VARYS_MARK.path} />
    </svg>
  );
}
