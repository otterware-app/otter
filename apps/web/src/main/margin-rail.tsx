import { Fragment } from "react";
import { CircleUserRoundIcon, SearchIcon } from "lucide-react";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { cn } from "@otter/ui/lib/utils";
import { useAppModes } from "./mail/app-sidebar";
import type { AppMode } from "./mail/spaces";
import type { MailAccount } from "./mail/types";
import type { SettingsPane } from "./mail/api";
import { PanelControlSlot } from "./mail/top-bar";
import { MODE_JUMP_COMMANDS } from "./keybindings/commands";
import { ShortcutText } from "./keybindings/store";
import { useOtterAccount } from "./otter-account";
import { OtterAvatar } from "./settings/otter-account-pane";
import { features } from "./features";
import { PLACE } from "./place-menu";

/** The Margin layout's mode switcher: a slim rail down the window's left edge, you at its foot. */
export function MarginRail({
  mode,
  accounts,
  settingsOpen,
  onMode,
  onOpenSettings,
}: {
  /** Where you are; none in Settings. */
  mode: AppMode | null;
  accounts: MailAccount[];
  settingsOpen: boolean;
  onMode: (mode: AppMode) => void;
  onOpenSettings: (pane: SettingsPane) => void;
}) {
  const { modes } = useAppModes(accounts);
  const user = useOtterAccount()?.user ?? null;
  return (
    <nav
      aria-label="Modes"
      data-tour="modes"
      className="fixed inset-y-0 left-0 z-30 flex w-16 flex-col items-center gap-1.5 border-r border-border bg-sidebar-surface pt-(--workspace-topbar-height) pb-4 web:pt-4"
    >
      <span
        aria-hidden
        className="mb-4 hidden size-7 items-center justify-center rounded-sm bg-foreground pb-0.5 font-reading text-xl leading-none text-canvas web:flex"
      >
        o
      </span>
      {modes.map(({ mode: id, label, Icon, dot }, i) => {
        const selected = id === mode;
        return (
          <HintTooltip
            key={id}
            label={label}
            hint={
              i < MODE_JUMP_COMMANDS.length ? (
                <ShortcutText command={MODE_JUMP_COMMANDS[i]} />
              ) : undefined
            }
            side="right"
          >
            <button
              type="button"
              aria-label={label}
              aria-current={selected ? "page" : undefined}
              onClick={() => onMode(id)}
              {...PLACE}
              className={cn(
                "relative flex size-10 cursor-pointer items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-focus-ring [&_svg]:size-4.5",
                selected
                  ? "bg-accent-surface text-foreground"
                  : "text-placeholder hover:bg-foreground/[0.05] hover:text-foreground",
              )}
            >
              <Icon selected={selected} />
              {dot && !selected ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-2 right-2 size-1.5 rounded-full",
                    dot === "attention" ? "bg-warning" : "bg-foreground",
                  )}
                />
              ) : null}
            </button>
          </HintTooltip>
        );
      })}
      <span className="flex-1" />
      <HintTooltip label={user ? user.email : "Settings"} side="right">
        <button
          type="button"
          aria-label="Account and settings"
          aria-current={settingsOpen ? "page" : undefined}
          onClick={() => onOpenSettings(user ? "otter" : "general")}
          {...PLACE}
          className={cn(
            "flex size-9 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
            settingsOpen ? "ring-2 ring-foreground" : "text-placeholder hover:text-foreground",
          )}
        >
          {user ? <OtterAvatar user={user} /> : <CircleUserRoundIcon className="size-5" />}
        </button>
      </HintTooltip>
    </nav>
  );
}

/**
 * The Margin layout's top bar, right of the rail: where you are, and the field that opens the
 * command palette. The pinned sidebar and panel toggles sit in it, at its ends.
 */
export function MarginTopBar({
  where,
  status,
  showPanelToggle,
  onFind,
}: {
  where: string[];
  status: string | null;
  showPanelToggle: boolean;
  onFind: () => void;
}) {
  return (
    <div
      data-toolbar=""
      className="drag-region grid h-(--workspace-topbar-height) shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,27.5rem)_minmax(0,1fr)] items-center gap-6 pe-4"
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 text-body",
          features.historyButtons
            ? "ps-[calc(var(--workspace-titlebar-content-left)+var(--workspace-history-controls-width)-3.5rem)]"
            : "ps-[calc(var(--workspace-titlebar-content-left)-3.5rem)]",
        )}
      >
        {where.map((part, i) => (
          <Fragment key={part}>
            {i > 0 ? <span className="text-placeholder">/</span> : null}
            <span
              className={cn(
                "truncate",
                i === where.length - 1
                  ? "font-medium text-foreground"
                  : "shrink-0 text-muted-foreground",
              )}
            >
              {part}
            </span>
          </Fragment>
        ))}
      </div>
      <button
        type="button"
        onClick={onFind}
        className="no-drag flex h-8 min-w-0 cursor-pointer items-center gap-2.5 rounded-sm border border-border px-3 text-body text-placeholder outline-none hover:border-foreground-40 focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <SearchIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">Find anything, or ask the agent</span>
        <ShortcutText command="commandPalette.toggle" className="shrink-0 font-mono text-2xs" />
      </button>
      <div className="flex min-w-0 items-center justify-end gap-3">
        {status ? (
          <span className="truncate font-mono text-3xs tracking-wider text-placeholder uppercase">
            {status}
          </span>
        ) : null}
        {showPanelToggle ? <PanelControlSlot /> : null}
      </div>
    </div>
  );
}
