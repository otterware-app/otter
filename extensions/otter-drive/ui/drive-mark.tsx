import { cn } from "@otter-mail/web/extension-kit";
import { UsersIcon } from "lucide-react";

import type { DriveFolder } from "./api";
import { DRIVE } from "./glyph";

const COLORS = ["#ff9500", "#34c759", "#00c7be", "#007aff", "#5856d6", "#af52de", "#ff2d55"];

/** Drive's colors for a drive, by its id (Otter Drive's `folderColor`). */
function colorOf(id: string): string {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length]!;
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/);
  return (
    words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : words[0]!.slice(0, 2)
  ).toUpperCase();
}

/**
 * A drive's mark, as Otter Drive draws it: My Drive is Drive's own symbol, a
 * shared drive its initials on its color (Mail's account picture).
 */
export function DriveMark({
  folder,
  className,
}: {
  folder: Pick<DriveFolder, "id" | "name" | "kind">;
  className?: string;
}) {
  if (folder.kind === "personal")
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-foreground text-background",
          className,
        )}
      >
        <svg viewBox="0 0 1024 1024" className="size-[62%]" aria-hidden>
          <path fill="currentColor" fillRule="evenodd" d={DRIVE} />
        </svg>
      </span>
    );
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-md text-[9px] leading-none font-bold text-white select-none",
        className,
      )}
      style={{ background: colorOf(folder.id) }}
    >
      {initialsOf(folder.name)}
    </span>
  );
}

/** Shared with me's mark. */
export function SharedMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
        className,
      )}
    >
      <UsersIcon className="size-3.5" />
    </span>
  );
}
