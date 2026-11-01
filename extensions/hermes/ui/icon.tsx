import hermesIconUrl from "./hermes-agent-icon.png";

/**
 * The Hermes Agent mark (the Nous mascot), as T3 Code's HermesIcon draws it.
 * Black-on-white art in a rounded tile, so it doesn't follow currentColor.
 */
export function HermesIcon({ className }: { className?: string }) {
  return <img src={hermesIconUrl} alt="" aria-hidden draggable={false} className={className} />;
}
