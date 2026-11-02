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
  openLink,
  toast,
  type MessageTarget,
} from "@otter-mail/web/extension-kit";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { driveApi } from "./api";

export function useDriveStatus() {
  return useQuery({ queryKey: ["otter-drive", "status"], queryFn: driveApi.status });
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const EMAIL = "__email__";

type Request = { kind: "browse" } | { kind: "save"; email: MessageTarget };
const listeners = new Set<(request: Request) => void>();
export function browseOtterDrive(): void {
  for (const listener of listeners) listener({ kind: "browse" });
}
export function saveToOtterDrive(email: MessageTarget): void {
  for (const listener of listeners) listener({ kind: "save", email });
}

/** Mounted once so the message action and ⌘K work from anywhere. */
export function OtterDriveDialogs() {
  const [request, setRequest] = useState<Request | null>(null);
  useEffect(() => {
    listeners.add(setRequest);
    return () => void listeners.delete(setRequest);
  }, []);
  if (!request) return null;
  const close = () => setRequest(null);
  return request.kind === "browse" ? (
    <DriveBrowser onClose={close} />
  ) : (
    <SaveToDrive email={request.email} onClose={close} />
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

  const save = async () => {
    setPending(true);
    try {
      const saved = await driveApi.publish({
        accountId: email.accountId,
        messageId: email.messageId,
        ...(picked === EMAIL ? {} : { attachmentId: picked }),
        title: shownTitle.trim(),
      });
      onClose();
      toast.success(`Saved “${saved.title}” to Otter Drive`, {
        action: { label: "Open", onClick: () => openLink(saved.url) },
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
      description="Publishes it as a new artifact. Everyone in your Otter Drive organization can see it."
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      confirmLabel={pending ? "Saving…" : "Save"}
      confirmDisabled={!connected || pending || !shownTitle.trim() || !message.data}
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

function DriveBrowser({ onClose }: { onClose: () => void }) {
  const status = useDriveStatus();
  const connected = status.data?.connected === true;
  const artifacts = useQuery({
    queryKey: ["otter-drive", "artifacts", status.data?.organizationId],
    queryFn: driveApi.artifacts,
    enabled: connected,
    retry: false,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Otter Drive"
      description="Your organization's artifacts, most recently updated first."
      size="large"
    >
      {status.data && !connected ? (
        <ConnectDrive onClose={onClose} />
      ) : artifacts.isError ? (
        <p className="text-sm text-destructive">{errorText(artifacts.error)}</p>
      ) : !artifacts.data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : artifacts.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ul className="-mx-2 flex max-h-[60vh] flex-col overflow-y-auto">
          {artifacts.data.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
                onClick={() => openLink(a.url)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{a.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {a.description || a.slug} ·{" "}
                    {new Date(a.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </span>
                <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
