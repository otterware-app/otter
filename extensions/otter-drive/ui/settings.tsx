import { searchableSetting, useOpenWorkspace } from "@otter/web/extension-kit";
import { toast } from "@otter/ui/components/toast";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, IconButton } from "@otter/ui/components/button";
import { Switch } from "@otter/ui/components/switch";

import { SHARED, driveApi, driveLabel, type DriveFolder } from "./api";
import { DriveMark, SharedMark } from "./drive-mark";
import { AgentsSection, DrivePage, NewDriveDialog } from "./drive-settings";
import { errorText, useDriveSignIn, useDriveStatus, useDrives } from "./hooks";
import { SettingsRow, SettingsSection } from "@otter/ui/components/settings";

const KIND_TEXT: Record<DriveFolder["kind"], string> = {
  personal: "Your drive",
  shared: "Shared drive",
  folder: "Shared with you",
};

export function OtterDriveSettingsPane() {
  const status = useDriveStatus();
  const connected = status.data?.connected === true;
  const drives = useDrives(connected);
  const { code, url, pending, run, signIn, cancel } = useDriveSignIn();
  const openWorkspace = useOpenWorkspace();
  const qc = useQueryClient();
  const hidden = new Set(status.data?.hidden ?? []);
  const [page, setPage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const open = page ? drives.data?.find((d) => d.id === page) : undefined;

  const setShown = async (id: string, shown: boolean) => {
    try {
      await driveApi.setDriveHidden(id, !shown);
      await qc.invalidateQueries({ queryKey: ["otter-drive"] });
    } catch (error) {
      toast.error(errorText(error));
    }
  };
  const driveRow = (
    id: string,
    mark: ReactNode,
    title: string,
    detail: string,
    onOpen?: () => void,
  ) => (
    <SettingsRow
      key={id}
      title={
        <span className="flex items-center gap-2.5">
          {mark}
          {title}
        </span>
      }
      description={detail}
      control={
        <div className="flex items-center gap-2">
          <Switch
            checked={!hidden.has(id)}
            onCheckedChange={(checked: boolean) => void setShown(id, Boolean(checked))}
            aria-label={`${hidden.has(id) ? "Turn on" : "Turn off"} ${title}`}
          />
          {onOpen ? (
            <IconButton label={`${title} settings`} onClick={onOpen}>
              <ChevronRightIcon />
            </IconButton>
          ) : null}
        </div>
      }
    />
  );

  if (connected && open) return <DrivePage drive={open} back={() => setPage(null)} />;

  return (
    <>
      <SettingsSection {...searchableSetting("otter-drive")}>
        <SettingsRow
          title="Otter Drive"
          description={
            status.isError
              ? "Could not read the connection. Try again."
              : !status.data
                ? "Loading…"
                : connected
                  ? "Signed in on this device. Your documents are in Drive, beside Mail and Calendar."
                  : "Your drives' documents in a Drive workspace, and attachments saved from mail."
          }
          control={
            connected ? (
              <Button size="sm" onClick={() => openWorkspace("drive")}>
                Open Drive
              </Button>
            ) : undefined
          }
        />
        <SettingsRow
          title={connected ? "Connection" : "Sign in to Otter Drive"}
          description={
            code ? (
              <span>
                Confirm the code <span className="font-mono font-medium">{code}</span> in your
                browser.
              </span>
            ) : (
              "Sign in in your browser. Your sign-in stays on this device."
            )
          }
          control={
            <div className="flex gap-2">
              {code ? (
                <>
                  {url ? (
                    <Button size="sm" onClick={() => void window.desktopBridge.openExternal(url)}>
                      Open sign-in page
                    </Button>
                  ) : null}
                  <Button size="sm" onClick={cancel}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant={connected ? "outline" : "primary"}
                  disabled={pending || !status.data}
                  onClick={() => void signIn()}
                >
                  {pending ? "Signing in…" : connected ? "Sign in again" : "Sign in"}
                </Button>
              )}
              {connected && !code ? (
                <Button size="sm" disabled={pending} onClick={() => void run(driveApi.disconnect)}>
                  Sign out
                </Button>
              ) : null}
            </div>
          }
        />
      </SettingsSection>
      {connected ? (
        <SettingsSection
          title="Drives"
          description="What Otter can reach on this device. A drive that's off isn't shown in Drive, can't be saved to, and isn't offered to agents."
        >
          {drives.isError ? (
            <SettingsRow
              title="Couldn't load your drives"
              description={errorText(drives.error)}
              control={
                <Button size="sm" onClick={() => void drives.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : !drives.data ? (
            <SettingsRow title="Loading…" />
          ) : (
            <>
              {drives.data.map((d) =>
                driveRow(
                  d.id,
                  <DriveMark folder={d} />,
                  driveLabel(d),
                  KIND_TEXT[d.kind],
                  // A folder shared with you is shared from its own menu, not here.
                  d.kind === "folder" ? undefined : () => setPage(d.id),
                ),
              )}
              {driveRow(
                SHARED,
                <SharedMark />,
                "Shared with me",
                "Documents people shared with you on their own",
              )}
              <SettingsRow
                title="New shared drive"
                description="A drive for a team: its members open everything in it."
                control={
                  <Button size="sm" onClick={() => setCreating(true)}>
                    Create…
                  </Button>
                }
              />
            </>
          )}
        </SettingsSection>
      ) : null}
      {connected ? <AgentsSection /> : null}
      {creating ? (
        <NewDriveDialog
          close={() => setCreating(false)}
          made={(id) => {
            setCreating(false);
            setPage(id);
          }}
        />
      ) : null}
    </>
  );
}
