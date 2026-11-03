import hermesIconUrl from "./hermes-agent-icon.png";

export function HermesIcon({ className }: { className?: string }) {
  return <img src={hermesIconUrl} alt="" aria-hidden draggable={false} className={className} />;
}
