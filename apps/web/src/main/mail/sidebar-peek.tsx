import { useEffect, useRef, useState, type ReactNode } from "react";

export function useSidebarPeek() {
  const [open, setOpen] = useState(false);
  const timer = useRef(0);
  const hover = (inside: boolean) => {
    window.clearTimeout(timer.current);
    if (inside) {
      timer.current = window.setTimeout(() => setOpen(true), open ? 0 : 120);
      return;
    }
    const close = () => {
      if (document.querySelector('[role="menu"], [role="dialog"]')) {
        timer.current = window.setTimeout(close, 300);
        return;
      }
      setOpen(false);
    };
    timer.current = window.setTimeout(close, 200);
  };
  const close = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => {
    const done = () => setOpen(false);
    window.addEventListener("drop", done);
    window.addEventListener("dragend", done);
    return () => {
      window.removeEventListener("drop", done);
      window.removeEventListener("dragend", done);
    };
  }, []);
  return { open, hover, close };
}

export function SidebarPeekCard({
  width,
  onHover,
  children,
}: {
  width: number;
  onHover: (inside: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{ width: `calc(${width}px - 2 * var(--peek-gap))` }}
      className="absolute bottom-(--peek-gap) left-(--peek-gap) top-[calc(var(--workspace-topbar-height)+var(--peek-gap))] z-40 overflow-hidden rounded-[calc(var(--radius-xl)-var(--peek-gap))] border border-(--panel-edge) bg-canvas text-sidebar-foreground shadow-[0_18px_48px_-12px_rgb(0_0_0/30%)] transition-opacity duration-150 ease-out [--peek-gap:0.25rem] starting:opacity-0 dark:shadow-[0_18px_48px_-12px_rgb(0_0_0/70%)]"
    >
      <div aria-hidden className="absolute inset-0 bg-sidebar-surface" />
      <div
        style={{ width }}
        className="absolute bottom-[calc(-1*(var(--peek-gap)+1px))] left-[calc(-1*(var(--peek-gap)+1px))] top-[calc(-1*(var(--peek-gap)+1px))] flex flex-col"
      >
        {children}
      </div>
    </div>
  );
}
