import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  Dialog,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  openLink,
  toast,
} from "@otter-mail/web/extension-kit";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FolderInputIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  LinkIcon,
  PencilIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useState, type ComponentType } from "react";

import { driveApi, driveLabel, type DriveArtifact, type DriveFolder } from "./api";
import { errorText, useDriveStatus, useFolders, useRefresh } from "./hooks";
import { share } from "./share";

type Icon = ComponentType<{ className?: string }>;
export type Action =
  | { id: string; label: string; Icon: Icon; run: () => void; red?: boolean }
  | { id: string; label: string; Icon: Icon; items: Action[] }
  | { id: string; separator: true };

const separator = (id: string): Action => ({ id, separator: true });

export function ActionItems({
  actions,
  menu,
}: {
  actions: Action[];
  menu: "context" | "dropdown";
}) {
  const Item = menu === "context" ? ContextMenuItem : DropdownMenuItem;
  const Separator = menu === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
  const shown = actions.filter(
    (a, i) =>
      !("separator" in a) || (i > 0 && i < actions.length - 1 && !("separator" in actions[i + 1]!)),
  );
  return (
    <>
      {shown.map((a) => {
        if ("separator" in a) return <Separator key={a.id} />;
        if ("items" in a) {
          const children = <ActionItems actions={a.items} menu={menu} />;
          return menu === "context" ? (
            <ContextMenuSub key={a.id} label={a.label} icon={<a.Icon />}>
              {children}
            </ContextMenuSub>
          ) : (
            <DropdownMenuSub key={a.id} label={a.label}>
              {children}
            </DropdownMenuSub>
          );
        }
        return (
          <Item
            key={a.id}
            icon={<a.Icon />}
            color={a.red ? "red" : undefined}
            onSelect={() => a.run()}
          >
            {a.label}
          </Item>
        );
      })}
    </>
  );
}

export function useRun() {
  const refresh = useRefresh();
  return async (action: () => Promise<unknown>, done?: string) => {
    try {
      await action();
      await refresh();
      if (done) toast.success(done);
      return true;
    } catch (error) {
      toast.error(errorText(error));
      return false;
    }
  };
}

const copy = (text: string, done: string) =>
  void navigator.clipboard.writeText(text).then(
    () => toast.success(done),
    () => toast.error("Couldn't copy it."),
  );

export function folderPath(list: DriveFolder[], folder: DriveFolder): string {
  const byId = new Map(list.map((f) => [f.id, f]));
  const names: string[] = [];
  let current: DriveFolder | undefined = folder;
  for (let i = 0; current && i < 50; i++) {
    names.unshift(current.parentId ? current.name : driveLabel(current));
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join(" › ");
}

function useFolderList() {
  const status = useDriveStatus();
  return useFolders(status.data?.connected === true).data ?? [];
}

export function useDocumentActions(
  a: DriveArtifact,
  options: {
    folderId: string | undefined;
    version?: number | null;
    onGone?: () => void;
  },
): Action[] {
  const run = useRun();
  const qc = useQueryClient();
  const list = useFolderList();
  const { folderId, version, onGone } = options;
  const canEdit = a.role !== "viewer" && a.role !== null;
  const owner = a.role === "owner";
  // Drive moves a document only for its owner, into folders they own.
  const destinations = owner ? list.filter((f) => f.role === "owner" && f.id !== a.folderId) : [];
  return [
    {
      id: "share",
      label: "Share…",
      Icon: UserPlusIcon,
      run: () =>
        share({
          type: "artifact",
          id: a.id,
          name: a.title,
          url: a.url,
          ...(folderId ? { folderId } : {}),
        }),
    },
    {
      id: "open",
      label: "Open in Otter Drive",
      Icon: ExternalLinkIcon,
      run: () => openLink(a.url),
    },
    { id: "link", label: "Copy link", Icon: LinkIcon, run: () => copy(a.url, "Link copied") },
    {
      id: "prompt",
      label: "Copy prompt for an agent",
      Icon: SparklesIcon,
      run: () =>
        copy(
          `Edit my Otter Drive document at ${a.url}. Read the current version first and publish a new immutable version with the Otter Drive CLI.`,
          "Prompt copied: paste it into your agent",
        ),
    },
    {
      id: "download",
      label: "Download",
      Icon: DownloadIcon,
      run: () =>
        void driveApi.download(a.id, folderId, version ?? undefined).then(
          (saved) => saved && toast.success("Downloaded"),
          (error: unknown) => toast.error(errorText(error)),
        ),
    },
    separator("edit"),
    ...(canEdit && !a.archived
      ? [
          {
            id: "version",
            label: "Upload new version…",
            Icon: UploadIcon,
            run: () =>
              void run(async () => {
                const done = await driveApi.uploadVersion(a.id, folderId);
                if (!done) return;
                await qc.resetQueries({ queryKey: ["otter-drive", "preview", a.id] });
                toast.success(`Uploaded version ${done.current?.number ?? ""}`);
              }),
          },
        ]
      : []),
    ...(destinations.length
      ? [
          {
            id: "move",
            label: "Move to",
            Icon: FolderInputIcon,
            items: destinations
              .map((f) => ({ f, path: folderPath(list, f) }))
              .sort((x, y) => x.path.localeCompare(y.path))
              .map(({ f, path }) => ({
                id: f.id,
                label: path,
                Icon: FolderOpenIcon,
                run: () =>
                  void run(() => driveApi.move(a.id, folderId, f.id), `Moved to ${path}`).then(
                    (ok) => ok && onGone?.(),
                  ),
              })),
          },
        ]
      : []),
    separator("archive"),
    ...(canEdit
      ? [
          {
            id: "archive",
            label: a.archived ? "Restore" : "Archive",
            Icon: a.archived ? ArchiveRestoreIcon : ArchiveIcon,
            run: () =>
              void run(
                () => driveApi.setArchived(a.id, folderId, !a.archived),
                a.archived ? "Restored" : "Archived",
              ).then((ok) => ok && !a.archived && onGone?.()),
          },
        ]
      : []),
    ...(a.archived && owner
      ? [
          {
            id: "delete",
            label: "Delete permanently…",
            Icon: Trash2Icon,
            red: true,
            run: () => openDialog({ type: "deleteDocument", artifact: a, folderId, onGone }),
          },
        ]
      : []),
  ];
}

export function useFolderActions(
  folder: DriveFolder,
  options: { onOpen?: () => void } = {},
): Action[] {
  const writable = folder.role !== "viewer";
  const own = folder.role === "owner" && folder.kind === "folder";
  return [
    ...(options.onOpen
      ? [{ id: "open", label: "Open", Icon: FolderOpenIcon, run: options.onOpen }]
      : []),
    ...(writable
      ? [
          {
            id: "new",
            label: "New folder…",
            Icon: FolderPlusIcon,
            run: () => openDialog({ type: "newFolder", parent: folder }),
          },
        ]
      : []),
    // My Drive is yours alone: its folders and documents are shared instead.
    ...(folder.kind !== "personal"
      ? [
          {
            id: "share",
            label: folder.kind === "shared" ? "Manage members…" : "Share…",
            Icon: folder.kind === "shared" ? UsersIcon : UserPlusIcon,
            run: () =>
              share({
                type: "folder",
                id: folder.id,
                name: folder.name,
              }),
          },
        ]
      : []),
    separator("change"),
    ...(writable && folder.kind === "folder"
      ? [
          {
            id: "rename",
            label: "Rename…",
            Icon: PencilIcon,
            run: () => openDialog({ type: "renameFolder", folder }),
          },
        ]
      : []),
    ...(own
      ? [
          {
            id: "move",
            label: "Move to…",
            Icon: FolderInputIcon,
            run: () => openDialog({ type: "moveFolder", folder }),
          },
          separator("delete"),
          {
            id: "delete",
            label: "Delete…",
            Icon: Trash2Icon,
            red: true,
            run: () => openDialog({ type: "deleteFolder", folder }),
          },
        ]
      : []),
  ];
}

type Request =
  | { type: "newFolder"; parent: DriveFolder; onCreated?: (id: string) => void }
  | { type: "renameFolder"; folder: DriveFolder }
  | { type: "moveFolder"; folder: DriveFolder }
  | { type: "deleteFolder"; folder: DriveFolder }
  | {
      type: "deleteDocument";
      artifact: DriveArtifact;
      folderId: string | undefined;
      onGone?: () => void;
    };

const listeners = new Set<(request: Request) => void>();
export function openDialog(request: Request): void {
  for (const listener of listeners) listener(request);
}

export function DriveActionDialogs() {
  const [request, setRequest] = useState<Request | null>(null);
  useEffect(() => {
    listeners.add(setRequest);
    return () => void listeners.delete(setRequest);
  }, []);
  if (!request) return null;
  const close = () => setRequest(null);
  const Body = DIALOGS[request.type] as ComponentType<{ request: Request; close: () => void }>;
  return (
    <Fragment key={JSON.stringify([request.type, "folder" in request && request.folder.id])}>
      <Body request={request} close={close} />
    </Fragment>
  );
}

function usePending(close: () => void) {
  const run = useRun();
  const [pending, setPending] = useState(false);
  return {
    pending,
    submit: async (action: () => Promise<unknown>, done?: string) => {
      setPending(true);
      const ok = await run(action, done);
      setPending(false);
      if (ok) close();
      return ok;
    },
  };
}

function NameDialog({
  title,
  initial,
  confirm,
  close,
  save,
}: {
  title: string;
  initial: string;
  confirm: string;
  close: () => void;
  save: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(initial);
  const [pending, setPending] = useState(false);
  const ok = name.trim() !== "" && name.trim() !== initial.trim();
  const submit = async () => {
    if (!ok || pending) return;
    setPending(true);
    await save(name.trim());
    setPending(false);
  };
  return (
    <Dialog
      open
      title={title}
      onOpenChange={(open) => !open && !pending && close()}
      confirmLabel={pending ? `${confirm}…` : confirm}
      confirmDisabled={!ok || pending}
      onConfirm={submit}
    >
      <Field label="Name" orientation="vertical">
        <Input
          autoFocus
          value={name}
          maxLength={80}
          disabled={pending}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
      </Field>
    </Dialog>
  );
}

function NewFolderDialog({
  request,
  close,
}: {
  request: Extract<Request, { type: "newFolder" }>;
  close: () => void;
}) {
  const { submit } = usePending(close);
  return (
    <NameDialog
      title={`New folder in ${request.parent.parentId ? request.parent.name : driveLabel(request.parent)}`}
      initial=""
      confirm="Create"
      close={close}
      save={(name) =>
        submit(async () => {
          const made = await driveApi.createFolder(request.parent.id, name);
          request.onCreated?.(made.id);
        }, `Created “${name}”`)
      }
    />
  );
}

function RenameFolderDialog({
  request,
  close,
}: {
  request: Extract<Request, { type: "renameFolder" }>;
  close: () => void;
}) {
  const { submit } = usePending(close);
  return (
    <NameDialog
      title="Rename folder"
      initial={request.folder.name}
      confirm="Rename"
      close={close}
      save={(name) => submit(() => driveApi.updateFolder(request.folder.id, { name }))}
    />
  );
}

function MoveFolderDialog({
  request,
  close,
}: {
  request: Extract<Request, { type: "moveFolder" }>;
  close: () => void;
}) {
  const { pending, submit } = usePending(close);
  const list = useFolderList();
  const { folder } = request;
  const inside = (f: DriveFolder): boolean => {
    for (let c: DriveFolder | undefined = f, i = 0; c && i < 50; i++) {
      if (c.id === folder.id) return true;
      c = c.parentId ? list.find((x) => x.id === c!.parentId) : undefined;
    }
    return false;
  };
  const top = (f: DriveFolder) => {
    let c = f;
    for (let i = 0; c.parentId && i < 50; i++) {
      const up = list.find((x) => x.id === c.parentId);
      if (!up) break;
      c = up;
    }
    return c.id;
  };
  const drive = top(folder);
  const options = list
    .filter((f) => f.role === "owner" && f.id !== folder.parentId && !inside(f) && top(f) === drive)
    .map((f) => ({ id: f.id, path: folderPath(list, f) }))
    .sort((x, y) => x.path.localeCompare(y.path));
  const [to, setTo] = useState<string | undefined>(undefined);
  const picked = options.find((o) => o.id === to);
  return (
    <Dialog
      open
      title={`Move “${folder.name}”`}
      description="Everything inside moves with it."
      onOpenChange={(open) => !open && !pending && close()}
      confirmLabel={pending ? "Moving…" : "Move"}
      confirmDisabled={!picked || pending}
      onConfirm={() =>
        void submit(
          () => driveApi.updateFolder(folder.id, { parentId: picked!.id }),
          `Moved to ${picked!.path}`,
        )
      }
    >
      <Field label="Into" orientation="vertical">
        <Select value={to} onValueChange={setTo}>
          <SelectTrigger aria-label="Into">
            <SelectValue placeholder="Choose a folder" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.path}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </Dialog>
  );
}

function DeleteFolderDialog({
  request,
  close,
}: {
  request: Extract<Request, { type: "deleteFolder" }>;
  close: () => void;
}) {
  const { pending, submit } = usePending(close);
  return (
    <Dialog
      open
      title={`Delete “${request.folder.name}”?`}
      description="Only an empty folder can be deleted: move or archive what's in it first."
      onOpenChange={(open) => !open && !pending && close()}
      confirmLabel={pending ? "Deleting…" : "Delete"}
      confirmVariant="destructive"
      confirmDisabled={pending}
      onConfirm={() =>
        void submit(() => driveApi.deleteFolder(request.folder.id), "Folder deleted")
      }
    />
  );
}

function DeleteDocumentDialog({
  request,
  close,
}: {
  request: Extract<Request, { type: "deleteDocument" }>;
  close: () => void;
}) {
  const { pending, submit } = usePending(close);
  const { artifact: a } = request;
  return (
    <Dialog
      open
      title={`Delete “${a.title}” permanently?`}
      description="Every version is deleted, and its links stop working. This can't be undone."
      onOpenChange={(open) => !open && !pending && close()}
      confirmLabel={pending ? "Deleting…" : "Delete permanently"}
      confirmVariant="destructive"
      confirmDisabled={pending}
      onConfirm={() =>
        void submit(
          () => driveApi.deletePermanently(a.id, request.folderId),
          `Deleted “${a.title}”`,
        ).then((ok) => ok && request.onGone?.())
      }
    />
  );
}

const DIALOGS = {
  newFolder: NewFolderDialog,
  renameFolder: RenameFolderDialog,
  moveFolder: MoveFolderDialog,
  deleteFolder: DeleteFolderDialog,
  deleteDocument: DeleteDocumentDialog,
};
