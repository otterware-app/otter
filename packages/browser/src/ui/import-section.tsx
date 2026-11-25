import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { ipc } from "@otter/client/bridge";
import { Button } from "@otter/ui/components/button";
import { Checkbox } from "@otter/ui/components/checkbox";
import { Dialog } from "@otter/ui/components/dialog";
import { SettingsRow, SettingsSection, SettingsSelect } from "@otter/ui/components/settings";
import { Text } from "@otter/ui/components/text";
import { toast } from "@otter/ui/components/toast";
import { uiHost } from "./host";

type ImportSource = { id: string; name: string; extensions: { id: string; name: string }[] };
type ImportResult = { cookies: number; extensions: number; failed: string[] };

export function ImportSection() {
  const sources = useQuery({
    queryKey: ["browser-import-sources"],
    queryFn: () => ipc<ImportSource[]>("browser:importSources"),
  });
  const [open, setOpen] = useState(false);
  if (!sources.data?.length) return null;

  return (
    <SettingsSection title="Import">
      <SettingsRow
        {...uiHost().settingProps("browser-import")}
        title="Import from another browser"
        description={`Your sign-ins and extensions from ${sources.data.map((s) => s.name).join(", ")}.`}
        control={
          <Button size="sm" onClick={() => setOpen(true)}>
            Import…
          </Button>
        }
      />
      {open ? (
        <ImportDialog
          sources={sources.data}
          onClose={() => {
            setOpen(false);
            void sources.refetch();
          }}
        />
      ) : null}
    </SettingsSection>
  );
}

function ImportDialog({ sources, onClose }: { sources: ImportSource[]; onClose: () => void }) {
  const [sourceId, setSourceId] = useState(sources[0]!.id);
  const source = sources.find((s) => s.id === sourceId) ?? sources[0]!;
  const [cookies, setCookies] = useState(true);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const extensions = source.extensions.filter((e) => !skipped.has(e.id));

  const toggle = (id: string, on: boolean) =>
    setSkipped((current) => {
      const next = new Set(current);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Import from another browser"
      confirmLabel="Import"
      confirmDisabled={!cookies && extensions.length === 0}
      onConfirm={async () => {
        try {
          const result = await ipc<ImportResult>("browser:import", {
            source: source.id,
            cookies,
            extensions: extensions.map((e) => e.id),
          });
          onClose();
          toast.success(summary(source.name, result));
        } catch (error) {
          toast.error(`Couldn't import from ${source.name}: ${error}`);
        }
      }}
    >
      <div className="flex flex-col gap-3">
        {sources.length > 1 ? (
          <SettingsSelect
            value={source.id}
            onValueChange={setSourceId}
            options={sources.map((s) => ({ value: s.id, label: s.name }))}
            ariaLabel="Browser"
            className="self-start"
          />
        ) : null}
        <label className="flex cursor-pointer items-start gap-2">
          <Checkbox className="mt-0.5" checked={cookies} onCheckedChange={setCookies} />
          <span className="flex flex-col">
            <Text>Sign-ins</Text>
            <Text variant="small" color="secondary">
              The sites you're signed in to, with their cookies. {uiHost().systemName} may ask to
              let Otter read {source.name}'s Safe Storage key.
            </Text>
          </span>
        </label>
        {source.extensions.length > 0 ? (
          <Text variant="small-strong" color="secondary" className="pt-1">
            Extensions
          </Text>
        ) : null}
        {source.extensions.map((extension) => (
          <label key={extension.id} className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={!skipped.has(extension.id)}
              onCheckedChange={(on) => toggle(extension.id, on)}
            />
            <Text truncate>{extension.name}</Text>
          </label>
        ))}
      </div>
    </Dialog>
  );
}

function summary(browser: string, { cookies, extensions, failed }: ImportResult): string {
  const parts = [
    cookies > 0 ? `${cookies} cookies` : null,
    extensions > 0 ? `${extensions} extension${extensions === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const imported = parts.length ? `Imported ${parts.join(" and ")} from ${browser}` : "Nothing new";
  return failed.length ? `${imported}. Couldn't add ${failed.join(", ")}.` : `${imported}.`;
}
