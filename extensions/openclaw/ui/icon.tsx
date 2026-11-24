import { LOBSTER } from "../shared/mark";

export function OpenClawIcon({ className }: { className?: string }) {
  const [from, to] = LOBSTER.gradient;
  return (
    <svg viewBox={LOBSTER.viewBox} fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="openclaw-lobster" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      {LOBSTER.filled.map((d) => (
        <path key={d} d={d} fill="url(#openclaw-lobster)" />
      ))}
      {LOBSTER.antennae.map((d) => (
        <path key={d} d={d} stroke={from} strokeWidth="3" strokeLinecap="round" />
      ))}
      {LOBSTER.eyes.map((eye) => (
        <circle key={`${eye.cx}-${eye.r}`} {...eye} />
      ))}
    </svg>
  );
}
