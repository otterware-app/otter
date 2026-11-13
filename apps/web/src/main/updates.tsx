import { useEffect, useRef, useState } from "react";
import type { UpdateState, UpdateChannel } from "@otter/contracts";
import { openLink } from "./browser/store";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  ExternalLinkIcon,
  RotateCwIcon,
} from "lucide-react";

import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { releaseCompareUrl, useReleaseChanges } from "./release-changes";
import { Btn, cn } from "./mail/ui";
import { toast } from "./mail/toast";
import { RowSelect, SettingsRow, SettingsSection, timeAgo } from "./settings/settings-ui";
import { searchableSetting } from "./settings/settings-search";

const restart = () => (window.desktopBridge.platform === "web" ? "Reload" : "Restart");

export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    let alive = true;
    void window.desktopBridge.updates.getState().then((next) => {
      if (alive) setState(next);
    });
    const off = window.desktopBridge.updates.onState(setState);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

export function UpdateNotifier() {
  const state = useUpdateState();
  const manualCheck = useRef(false);

  useEffect(
    () =>
      window.desktopBridge.on("updates:checkRequested", () => {
        manualCheck.current = true;
        void window.desktopBridge.updates.check();
      }),
    [],
  );

  useEffect(() => {
    if (!state || !manualCheck.current) return;
    if (state.status === "up-to-date") {
      manualCheck.current = false;
      toast.success("Otter is up to date", { description: `Version ${state.currentVersion}` });
    } else if (state.status === "disabled" || state.status === "error") {
      manualCheck.current = false;
      toast.error("Couldn't check for updates", { description: state.message ?? undefined });
    } else if (state.status === "downloading" || state.status === "downloaded") {
      manualCheck.current = false;
      toast.info(`Otter ${state.availableVersion} is on its way`, {
        description: "It's downloading; the sidebar offers a restart when it's ready.",
      });
    }
  }, [state]);

  return null;
}

export function updateNow(): void {
  const updates = window.desktopBridge.updates;
  console.log("[Updates:updateNow]");
  const id = toast.loading("Checking for updates…");
  const fail = (title: string, s: UpdateState) => {
    off();
    const url = s.manualDownloadUrl;
    toast.update(id, "error", title, {
      description: s.message ?? undefined,
      timeout: 0,
      action: url
        ? { label: "Download", onClick: () => void window.desktopBridge.openExternal(url) }
        : { label: "Try again", onClick: updateNow },
    });
  };
  const step = (s: UpdateState) => {
    if (s.manualDownloadUrl) return fail(`Otter ${s.availableVersion} can't install itself`, s);
    switch (s.status) {
      case "available":
        void updates.download();
        return;
      case "downloading":
        toast.update(id, "loading", `Downloading Otter ${s.availableVersion}`, {
          description: `${s.downloadPercent ?? 0}% · restarts when it's done`,
          timeout: 0,
        });
        return;
      case "downloaded":
        off();
        toast.update(id, "loading", `${restart()}ing into Otter ${s.availableVersion}…`, {
          timeout: 0,
        });
        void updates.install();
        return;
      case "up-to-date":
        off();
        toast.update(id, "success", "Otter is up to date", {
          description: `Version ${s.currentVersion}`,
        });
        return;
      case "error":
        return fail("Couldn't update Otter", s);
      case "disabled":
        return fail("Updates are unavailable", s);
    }
  };
  const off = updates.onState(step);
  void updates.getState().then((s) => {
    if (s.status === "downloaded" || s.status === "downloading" || s.status === "available")
      step(s);
    else if (s.status === "error" && s.availableVersion && !s.manualDownloadUrl)
      void updates.download();
    else void updates.check();
  });
}

export function UpdateButton() {
  const state = useUpdateState();
  const version = state?.availableVersion;
  if (!state || !version) return null;
  const { status } = state;
  if (status !== "downloading" && status !== "downloaded" && status !== "error") return null;

  const updates = window.desktopBridge.updates;
  const manualUrl = state.manualDownloadUrl;
  const percent = Math.min(100, Math.max(0, Math.floor(state.downloadPercent ?? 0)));
  const step: { label: string; title: string; note?: string; act: (() => void) | null } = manualUrl
    ? {
        label: "Download update",
        title: "Couldn't install the update",
        note: "Download it from GitHub and install it by hand.",
        act: () => void window.desktopBridge.openExternal(manualUrl),
      }
    : status === "downloaded"
      ? {
          label: `${restart()} to update`,
          title: "Update ready",
          act: () => void updates.install(),
        }
      : status === "error"
        ? {
            label: "Couldn't update",
            title: "Couldn't update",
            note: "It will try again later. Click to try now.",
            act: () => void updates.download(),
          }
        : { label: "Downloading", title: "Downloading update", act: null };

  return (
    <Popover
      onOpenChange={(open, details) => {
        // A click runs the step, or keeps open what hovering opened.
        if (details.reason === "trigger-press" && (step.act || !open)) details.cancel();
      }}
    >
      <PopoverTrigger
        openOnHover
        delay={200}
        closeDelay={150}
        aria-label={status === "error" && !manualUrl ? "Retry the update" : undefined}
        onClick={step.act ?? undefined}
        className="relative ml-1 flex h-8 min-w-0 flex-1 cursor-pointer items-center rounded-full bg-sidebar-control-surface pl-3 text-xs text-sidebar-foreground outline-none transition-[opacity,translate] duration-300 ease-out before:absolute before:inset-0 before:rounded-full before:transition-colors hover:before:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-focus-ring starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none"
      >
        <span
          className={cn(
            "relative min-w-0 flex-1 truncate text-left",
            status === "error" && !manualUrl && "text-destructive",
          )}
        >
          {step.label}
          {status === "downloading" ? (
            <span className="text-muted-foreground tabular-nums"> {percent}%</span>
          ) : null}
        </span>
        <span className="relative grid size-8 shrink-0 place-items-center">
          <UpdateGlyph status={manualUrl ? "manual" : status} percent={percent} />
        </span>
      </PopoverTrigger>
      <PopoverPopup
        side="top"
        align="start"
        sideOffset={8}
        collisionAvoidance={{ fallbackAxisSide: "none" }}
        width="md"
        padding="none"
      >
        <UpdateNotes from={state.currentVersion} to={version} title={step.title} note={step.note} />
      </PopoverPopup>
    </Popover>
  );
}

const RING = 2 * Math.PI * 13;

function UpdateGlyph({
  status,
  percent,
}: {
  status: "downloading" | "downloaded" | "error" | "manual";
  percent: number;
}) {
  if (status === "downloaded") {
    return (
      <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground transition-[scale,opacity] duration-300 ease-out starting:scale-50 starting:opacity-0 motion-reduce:transition-none">
        <ArrowUpIcon className="size-3" strokeWidth={2.75} />
      </span>
    );
  }
  if (status === "error") return <RotateCwIcon className="size-3.5 text-destructive" />;
  if (status === "manual") return <ArrowUpRightIcon className="size-3.5" />;
  return (
    <>
      <svg aria-hidden className="absolute inset-0 size-full -rotate-90" viewBox="0 0 32 32">
        <circle
          cx="16"
          cy="16"
          r="13"
          fill="none"
          strokeWidth="1.5"
          className="stroke-current/15"
        />
        <circle
          cx="16"
          cy="16"
          r="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={RING}
          strokeDashoffset={RING * (1 - percent / 100)}
          className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
        />
      </svg>
      <ArrowDownIcon className="size-3.5" />
    </>
  );
}

/** Titles read "Area: change"; changes to one area sit under its name. */
function byArea(titles: string[]): [string, string[]][] {
  const areas = new Map<string, string[]>([["", []]]);
  for (const title of titles) {
    const match = /^([^:]{1,40}): (.+)$/.exec(title);
    const [area, change] = match ? [match[1]!, match[2]!] : ["", title];
    areas.set(area, [...(areas.get(area) ?? []), change[0]!.toUpperCase() + change.slice(1)]);
  }
  return [...areas].filter(([, changes]) => changes.length > 0);
}

function UpdateNotes({
  from,
  to,
  title,
  note,
}: {
  from: string;
  to: string;
  title: string;
  note?: string;
}) {
  const changes = useReleaseChanges(from, to);
  return (
    <div className="flex max-h-[min(32rem,var(--available-height))] flex-col">
      <div className="shrink-0 px-4 pt-3.5">
        <PopoverTitle className="font-medium leading-5">{title}</PopoverTitle>
        <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
          {to}
          {changes?.landedAt ? ` · ${timeAgo(changes.landedAt)}` : ""}
        </p>
        {note ? <p className="mt-2 text-xs leading-5 text-popover-foreground/90">{note}</p> : null}
      </div>
      {changes?.titles.length ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3.5 pb-4 [mask-image:linear-gradient(to_bottom,black_calc(100%-1.25rem),transparent)] [scrollbar-width:thin]">
          <h3 className="text-xs font-semibold">What's changed since your version</h3>
          {byArea(changes.titles).map(([area, items]) => (
            <section key={area} className="mt-2.5">
              {area ? <h4 className="text-xs text-muted-foreground">{area}</h4> : null}
              <ul className="mt-1 space-y-1 text-xs leading-5 text-popover-foreground/90">
                {items.map((item) => (
                  <li
                    key={item}
                    className="relative pl-3.5 before:absolute before:top-2 before:left-0.5 before:size-1 before:rounded-full before:bg-current before:opacity-50"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => openLink(releaseCompareUrl(from, to))}
        className={cn(
          "flex shrink-0 cursor-pointer items-center gap-1 self-start px-4 pb-3.5 text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline",
          changes?.titles.length ? "pt-1" : "pt-3",
        )}
      >
        {changes?.more ? "Earlier changes on GitHub" : "View on GitHub"}
        <ExternalLinkIcon className="size-3" />
      </button>
    </div>
  );
}

function statusLine(state: UpdateState): string {
  switch (state.status) {
    case "disabled":
      return state.message ?? "Updates are unavailable in this build.";
    case "checking":
      return "Checking for updates…";
    case "available":
      return `Version ${state.availableVersion} is available.`;
    case "downloading":
      return `Downloading version ${state.availableVersion}… ${state.downloadPercent ?? 0}%`;
    case "downloaded":
      return `Version ${state.availableVersion} is ready. ${restart()} to install it.`;
    case "up-to-date":
      return "You're on the latest version.";
    case "error":
      return state.message ?? "The last update check failed.";
    default:
      return "Updates download on their own.";
  }
}

export function UpdatesSection() {
  const state = useUpdateState();
  const [changingChannel, setChangingChannel] = useState(false);
  if (!state) return null;

  const updates = window.desktopBridge.updates;
  async function changeChannel(channel: string) {
    setChangingChannel(true);
    try {
      await updates.setChannel(channel as UpdateChannel);
    } catch (error) {
      toast.error("Couldn't change update channel", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setChangingChannel(false);
    }
  }
  const manualUrl = state.manualDownloadUrl;
  const control = manualUrl ? (
    <Btn
      variant="primary"
      size="sm"
      onClick={() => void window.desktopBridge.openExternal(manualUrl)}
    >
      Download {state.availableVersion}
    </Btn>
  ) : state.status === "available" ? (
    <Btn variant="primary" size="sm" onClick={() => void updates.download()}>
      Download
    </Btn>
  ) : state.status === "downloaded" ? (
    <Btn variant="primary" size="sm" onClick={() => void updates.install()}>
      {restart()} to Update
    </Btn>
  ) : state.status === "disabled" ? null : (
    <Btn
      size="sm"
      disabled={changingChannel || state.status === "checking" || state.status === "downloading"}
      onClick={() => void updates.check()}
    >
      Check for Updates
    </Btn>
  );

  return (
    <SettingsSection {...searchableSetting("updates")}>
      <SettingsRow
        title={`Otter ${state.currentVersion}`}
        description={statusLine(state)}
        control={control}
      />
      {state.status !== "disabled" ? (
        <SettingsRow
          title="Update channel"
          description={
            state.channel === "nightly"
              ? "Early builds with the latest changes."
              : "Tested releases for everyday use."
          }
          control={
            <RowSelect
              ariaLabel="Update channel"
              value={state.channel}
              options={[
                { value: "stable", label: "Stable" },
                { value: "nightly", label: "Nightly" },
              ]}
              disabled={
                changingChannel ||
                ["checking", "available", "downloading", "downloaded"].includes(state.status)
              }
              onValueChange={(channel) => void changeChannel(channel)}
            />
          }
        />
      ) : null}
    </SettingsSection>
  );
}
