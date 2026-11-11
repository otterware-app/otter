import { useEffect, useState } from "react";
import { ArrowUpRightIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import {
  decodeThirdPartyLicenses,
  filterThirdPartyLicenses,
  THIRD_PARTY_LICENSES_PATH,
  thirdPartyLicenseKey,
  type ThirdPartyLicenseEntry,
} from "@otter/shared/third-party-licenses";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { openLink } from "../browser/store";
import { Btn, cn } from "../mail/ui";

type Loaded = ReadonlyArray<ThirdPartyLicenseEntry> | "failed" | null;

async function loadLicenses(): Promise<ReadonlyArray<ThirdPartyLicenseEntry>> {
  const response = await fetch(THIRD_PARTY_LICENSES_PATH);
  if (!response.ok) throw new Error(`The license list answered ${String(response.status)}.`);
  return decodeThirdPartyLicenses(await response.json());
}

export function OpenSourceLicensesButton() {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <>
      <Btn size="sm" onClick={() => setOpen(true)}>
        View licenses
      </Btn>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="xl" className="flex h-[min(44rem,85vh)] flex-col gap-0 p-0">
          {open ? (
            <OpenSourceLicenses key={attempt} onRetry={() => setAttempt((n) => n + 1)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function OpenSourceLicenses({ onRetry }: { onRetry: () => void }) {
  const [entries, setEntries] = useState<Loaded>(null);
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    loadLicenses().then(
      (loaded) => current && setEntries(loaded),
      (error: unknown) => {
        console.error("The open-source licenses didn't load:", error);
        if (current) setEntries("failed");
      },
    );
    return () => {
      current = false;
    };
  }, []);

  const shown = Array.isArray(entries) ? filterThirdPartyLicenses(entries, query) : [];

  return (
    <>
      <DialogHeader className="gap-3 border-b px-5 py-4">
        <div>
          <DialogTitle>Open-source licenses</DialogTitle>
          <DialogDescription>
            Otter is built on other people's work. Their licenses, as they ship them.
          </DialogDescription>
        </div>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              Array.isArray(entries) ? `Search ${String(entries.length)} licenses` : "Search"
            }
            aria-label="Search licenses"
            className="h-8 w-full rounded-md border bg-transparent ps-8 pe-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
          />
        </div>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {entries === null ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Loading…</p>
        ) : entries === "failed" ? (
          <div className="flex flex-col items-start gap-3 px-5 py-6">
            <p className="text-sm text-muted-foreground">The licenses didn't load.</p>
            <Btn size="sm" onClick={onRetry}>
              Try again
            </Btn>
          </div>
        ) : shown.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No license matches that.</p>
        ) : (
          shown.map((entry) => {
            const key = thirdPartyLicenseKey(entry);
            return (
              <LicenseRow
                key={key}
                entry={entry}
                open={openKey === key}
                onToggle={() => setOpenKey(openKey === key ? null : key)}
              />
            );
          })
        )}
      </div>
    </>
  );
}

function LicenseRow({
  entry,
  open,
  onToggle,
}: {
  entry: ThirdPartyLicenseEntry;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 px-2.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-sm outline-none hover:bg-accent-surface focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="truncate font-medium">{entry.name}</span>
          {entry.version ? (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {entry.version}
            </span>
          ) : null}
          <span className="ms-auto shrink-0 truncate ps-3 text-xs text-muted-foreground">
            {entry.license}
          </span>
        </button>
      </div>
      {open ? (
        <div className="px-12 pt-1 pb-4">
          {entry.sourceUrl ? (
            <button
              type="button"
              onClick={() => openLink(entry.sourceUrl!)}
              className="mb-2 cursor-pointer text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:underline"
            >
              {entry.sourceUrl.replace(/^https?:\/\//, "")}
              <ArrowUpRightIcon className="ms-0.5 inline size-3 align-[-2px]" />
            </button>
          ) : null}
          <pre className="font-mono text-xs/5 break-words whitespace-pre-wrap text-foreground/80">
            {entry.noticeText}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
