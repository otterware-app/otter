import {
  Btn,
  Dialog,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  mailApi,
  toast,
  useOpenWorkspace,
  type MessageTarget,
} from "@otter-mail/web/extension-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { DriveActionDialogs } from "./actions";
import { setDriveConnected, setDriveOpener } from "./search";
import { ShareDialogHost } from "./share";
import { driveApi, driveLabel } from "./api";
import { DriveMark } from "./drive-mark";
import { errorText, useDriveStatus, useFolders } from "./hooks";

const EMAIL = "__email__";

const listeners = new Set<(email: MessageTarget) => void>();
export function saveToOtterDrive(email: MessageTarget): void {
  for (const listener of listeners) listener(email);
}

/** Mounted once so the message action works from the list and the reader. */
export function OtterDriveDialogs() {
  const [email, setEmail] = useState<MessageTarget | null>(null);
  const openWorkspace = useOpenWorkspace();
  const qc = useQueryClient();
  useEffect(() => {
    // What it opens may be new here (a link just accepted): the lists catch up first.
    setDriveOpener(
      (location, item) =>
        void Promise.all(
          ["folders", "artifacts", "drives"].map((key) =>
            qc.invalidateQueries({ queryKey: ["otter-drive", key] }),
          ),
        ).then(() => openWorkspace("drive", { location, item })),
    );
    return () => setDriveOpener(null);
  }, [openWorkspace, qc]);
  // ⌘K's Drive results go when the sign-in or the drives that are on change.
  const status = useDriveStatus().data;
  const reach = status ? `${status.connected}:${status.hidden.join(",")}` : null;
  useEffect(() => {
    qc.removeQueries({ queryKey: ["palette-search", "otter-drive"] });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- runs when what Drive can reach changes.
  }, [qc, reach]);
  const connected = status?.connected === true;
  useEffect(() => setDriveConnected(connected), [connected]);
  useEffect(() => {
    listeners.add(setEmail);
    return () => void listeners.delete(setEmail);
  }, []);
  return (
    <>
      <DriveActionDialogs />
      <ShareDialogHost />
      {email ? <SaveToDrive email={email} onClose={() => setEmail(null)} /> : null}
    </>
  );
}

function ConnectDrive({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-between gap-3">
      <p>Sign in to Otter Drive to get started.</p>
      <Btn
        size="sm"
        onClick={() => {
          onClose();
          void navigate({
            to: "/settings/$pane/$item",
            params: { pane: "accounts", item: "otter-drive" },
          });
        }}
      >
        Open settings
      </Btn>
    </div>
  );
}

function SaveToDrive({ email, onClose }: { email: MessageTarget; onClose: () => void }) {
  const status = useDriveStatus();
  const message = useQuery({
    queryKey: ["otter-drive", "message", email.accountId, email.messageId],
    queryFn: () => mailApi.getMessage(email.accountId, email.messageId),
  });
  const files = (message.data?.attachments ?? []).filter((a) => !a.contentId);
  const [choice, setChoice] = useState<string | null>(null);
  const picked = choice ?? files[0]?.id ?? EMAIL;
  const pickedName =
    picked === EMAIL ? email.subject : files.find((f) => f.id === picked)?.filename;
  const [title, setTitle] = useState<string | null>(null);
  const shownTitle = title ?? (pickedName || "Email");
  const [pending, setPending] = useState(false);
  const connected = status.data?.connected === true;
  // Drives you can add to: on here, and not just a viewer's.
  const drives = (useFolders(connected).data ?? []).filter(
    (f) => f.parentId === null && f.kind !== "folder" && f.role !== "viewer",
  );
  const [driveChoice, setDriveChoice] = useState<string | null>(null);
  const driveId = driveChoice ?? drives.find((d) => d.kind === "personal")?.id ?? drives[0]?.id;
  const openWorkspace = useOpenWorkspace();
  const qc = useQueryClient();

  const save = async () => {
    setPending(true);
    try {
      const saved = await driveApi.publish({
        accountId: email.accountId,
        messageId: email.messageId,
        ...(picked === EMAIL ? {} : { attachmentId: picked }),
        folderId: driveId!,
        title: shownTitle.trim(),
      });
      onClose();
      void qc.invalidateQueries({ queryKey: ["otter-drive", "artifacts"] });
      toast.success(`Saved “${saved.title}” to Otter Drive`, {
        action: {
          label: "Open",
          onClick: () => openWorkspace("drive", { location: saved.folderId, item: saved.id }),
        },
      });
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      title="Save to Otter Drive"
      description="Saves it as a new document in the drive you choose. Everyone with access to that drive can see it."
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      confirmLabel={pending ? "Saving…" : "Save"}
      confirmDisabled={!connected || pending || !shownTitle.trim() || !message.data || !driveId}
      onConfirm={save}
    >
      {status.data && !connected ? (
        <ConnectDrive onClose={onClose} />
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="What to save" orientation="vertical">
            <Select
              value={picked}
              onValueChange={(next) => {
                setChoice(next);
                setTitle(null);
              }}
            >
              <SelectTrigger aria-label="What to save">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {files.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.filename}
                  </SelectItem>
                ))}
                <SelectItem value={EMAIL}>The email itself</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {drives.length > 1 ? (
            <Field label="Drive" orientation="vertical">
              <Select value={driveId} onValueChange={setDriveChoice}>
                <SelectTrigger aria-label="Drive">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {drives.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      <span className="flex items-center gap-2">
                        <DriveMark folder={d} className="size-4 text-[8px]" />
                        {driveLabel(d)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field label="Title" orientation="vertical">
            <Input
              value={shownTitle}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              disabled={pending}
            />
          </Field>
        </div>
      )}
    </Dialog>
  );
}
