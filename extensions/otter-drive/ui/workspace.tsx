import {
  Btn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HintTooltip,
  IconBtn,
  Input,
  SidebarAction,
  SidebarBody,
  SidebarSwitcher,
  cn,
  toast,
  type WorkspaceMainProps,
  type WorkspaceProps,
} from "@otter/web/extension-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ArrowUpDownIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ClockIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileTypeIcon,
  FileVideoCameraIcon,
  FolderIcon,
  FolderPlusIcon,
  GlobeIcon,
  MoreHorizontalIcon,
  PackageIcon,
  SearchIcon,
  UploadIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import {
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type DragEvent,
  type ReactNode,
} from "react";

import {
  ActionItems,
  openDialog,
  useDocumentActions,
  useFolderActions,
  type Action,
} from "./actions";
import { SHARED, driveApi, driveLabel, type DriveArtifact, type DriveFolder } from "./api";
import { DocumentView, Empty, TitleBar, previewQuery, when } from "./document";
import { DriveMark, SharedMark } from "./drive-mark";
import { errorText, useDriveSignIn, useDriveStatus, useFolders, useSaved } from "./hooks";
import { OtterDriveIcon } from "./icon";

export const MINE = "mine";

type Kind = "documents" | "spreadsheets" | "pages" | "pdfs" | "images" | "videos" | "other";

const KINDS: Record<
  Kind,
  { label: string; one: string; Icon: ComponentType<{ className?: string }> }
> = {
  documents: { label: "Documents", one: "Document", Icon: FileTextIcon },
  spreadsheets: { label: "Spreadsheets", one: "Spreadsheet", Icon: FileSpreadsheetIcon },
  pages: { label: "Web pages", one: "Web page", Icon: GlobeIcon },
  pdfs: { label: "PDFs", one: "PDF", Icon: FileTypeIcon },
  images: { label: "Images", one: "Image", Icon: FileImageIcon },
  videos: { label: "Videos", one: "Video", Icon: FileVideoCameraIcon },
  other: { label: "Other files", one: "File", Icon: PackageIcon },
};

const KIND_BY_EXTENSION: Record<string, Kind> = {
  md: "documents",
  markdown: "documents",
  txt: "documents",
  csv: "spreadsheets",
  tsv: "spreadsheets",
  xlsx: "spreadsheets",
  html: "pages",
  htm: "pages",
  pdf: "pdfs",
  png: "images",
  jpg: "images",
  jpeg: "images",
  gif: "images",
  webp: "images",
  svg: "images",
  mp4: "videos",
  m4v: "videos",
  webm: "videos",
  mov: "videos",
  ogv: "videos",
};

const kindOf = (a: DriveArtifact): Kind =>
  KIND_BY_EXTENSION[a.current?.entryPath.split(".").pop()?.toLowerCase() ?? ""] ?? "other";

type Sort = "updated" | "az" | "za";
const SORTS: Record<Sort, string> = {
  updated: "Last updated",
  az: "Name, A to Z",
  za: "Name, Z to A",
};

type Filters = {
  kind: Kind | null;
  recent: boolean;
  archived: boolean;
  query: string;
  sort: Sort;
};

let filters: Filters = { kind: null, recent: false, archived: false, query: "", sort: "updated" };
const listeners = new Set<() => void>();

function setFilters(patch: Partial<Filters>) {
  filters = { ...filters, ...patch };
  for (const listener of listeners) listener();
}

function useFilters(): Filters {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => filters,
  );
}

const WEEK = 7 * 86_400_000;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const byName = (a: string, b: string) => collator.compare(a, b);

type Place = {
  folder: DriveFolder | null;
  trail: DriveFolder[];
  drive: DriveFolder | null;
  drives: DriveFolder[];
  sharedWithMe: boolean;
  writable: boolean;
  subfolders: DriveFolder[];
  documents: DriveArtifact[];
  loading: boolean;
  error: unknown;
};

function topOf(list: DriveFolder[], folder: DriveFolder): DriveFolder {
  const byId = new Map(list.map((f) => [f.id, f]));
  let current = folder;
  for (let i = 0; current.parentId && byId.has(current.parentId) && i < 50; i++)
    current = byId.get(current.parentId)!;
  return current;
}

function usePlace(location: string): Place {
  const status = useDriveStatus();
  const connected = status.data?.connected === true;
  const sharedOn = !(status.data?.hidden ?? []).includes(SHARED);
  const folders = useFolders(connected);
  const list = folders.data ?? [];
  const f = useFilters();

  const sharedWithMe = location === SHARED && sharedOn;
  const folder = sharedWithMe
    ? null
    : (list.find((x) => x.id === location) ??
      list.find((x) => x.kind === "personal") ??
      list.find((x) => x.parentId === null) ??
      null);
  const drive = folder ? topOf(list, folder) : null;
  const drives = list.filter((x) => x.parentId === null && x.kind !== "folder");

  const documentsKey = ["otter-drive", "artifacts", sharedWithMe ? SHARED : folder?.id, f.archived];
  useSaved(
    documentsKey,
    connected && (sharedWithMe || folder !== null) && !f.archived,
    sharedWithMe ? "shared" : "artifacts",
    folder?.id,
  );
  const documents = useQuery({
    queryKey: documentsKey,
    queryFn: () => (sharedWithMe ? driveApi.shared() : driveApi.artifacts(folder!.id, f.archived)),
    enabled: connected && (sharedWithMe || folder !== null),
    retry: false,
    staleTime: 60_000,
  });

  const words = f.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  // "This week" from when the list was fetched.
  const now = documents.dataUpdatedAt;
  const shown = (documents.data ?? [])
    .filter(
      (a) =>
        (f.archived || !a.archived) &&
        (!f.recent || now - Date.parse(a.updatedAt) <= WEEK) &&
        (!f.kind || kindOf(a) === f.kind) &&
        matches(`${a.title} ${a.slug} ${a.description}`),
    )
    .sort((a, b) =>
      f.sort === "updated"
        ? b.updatedAt.localeCompare(a.updatedAt)
        : byName(a.title, b.title) * (f.sort === "za" ? -1 : 1),
    );
  const subfolders =
    f.archived || f.recent || f.kind
      ? []
      : list
          .filter((x) =>
            sharedWithMe
              ? x.kind === "folder" && topOf(list, x).id === x.id
              : x.parentId === folder?.id,
          )
          .filter((x) => matches(x.name))
          .sort((a, b) => byName(a.name, b.name) * (f.sort === "za" ? -1 : 1));

  const trail: DriveFolder[] = [];
  for (let c = folder, i = 0; c && i < 50; i++) {
    trail.unshift(c);
    c = c.parentId ? (list.find((x) => x.id === c!.parentId) ?? null) : null;
  }

  return {
    folder,
    trail,
    drive,
    drives,
    sharedWithMe,
    writable: folder !== null && folder.role !== "viewer",
    subfolders,
    documents: shown,
    loading: folders.isPending || (documents.isPending && documents.fetchStatus !== "idle"),
    error: (folders.data ? null : folders.error) ?? (documents.data ? null : documents.error),
  };
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () =>
      resolve(String(reader.result).replace(/^data:[^,]*,/, "")),
    );
    reader.addEventListener("error", () => reject(new Error(`Couldn't read ${file.name}.`)));
    reader.readAsDataURL(file);
  });
}

function useUpload(folderId: string | undefined, go: WorkspaceProps["go"]) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const finish = async (run: (folderId: string) => Promise<DriveArtifact[]>) => {
    if (!folderId) return;
    setBusy(true);
    try {
      const done = await run(folderId);
      if (!done.length) return;
      await qc.invalidateQueries({ queryKey: ["otter-drive", "artifacts"] });
      toast.success(
        done.length === 1 ? `Uploaded “${done[0]!.title}”` : `Uploaded ${done.length} documents`,
      );
      if (done.length === 1) go({ item: done[0]!.id });
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return {
    busy,
    pick: () => void finish(driveApi.uploadPicked),
    files: (files: File[]) =>
      void finish(async (id) => {
        const done: DriveArtifact[] = [];
        for (const file of files) {
          if (file.size > 100 * 1024 * 1024) throw new Error(`${file.name} is over 100 MB.`);
          done.push(
            await driveApi.uploadBytes(id, {
              name: file.name,
              type: file.type,
              base64: await readBase64(file),
            }),
          );
        }
        return done;
      }),
  };
}

const chip = (on: boolean) =>
  cn(
    "flex h-6.5 shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring [&_svg]:size-3.5",
    on
      ? "border-transparent bg-sidebar-row-selected text-sidebar-foreground"
      : "border-sidebar-border text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
  );

export function DriveSidebar({ location, item, go }: WorkspaceProps) {
  const status = useDriveStatus();
  const connected = status.data?.connected === true;
  const place = usePlace(location);
  const f = useFilters();
  const upload = useUpload(place.folder?.id, go);
  const [searching, setSearching] = useState(f.query !== "");
  const searchRef = useRef<HTMLInputElement>(null);
  const sharedOn = !(status.data?.hidden ?? []).includes(SHARED);
  const inFolder = place.folder !== null && place.drive?.id !== place.folder.id;
  const closeSearch = () => {
    setFilters({ query: "" });
    setSearching(false);
  };

  if (!connected) return <div className="flex min-h-0 min-w-0 flex-1 flex-col" />;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col pt-(--sidebar-content-inset)">
        <SidebarAction
          icon={<SearchIcon />}
          label="Search"
          onClick={() => {
            setSearching(true);
            requestAnimationFrame(() => searchRef.current?.focus());
          }}
        />
        {place.writable ? (
          <SidebarAction
            icon={<UploadIcon />}
            label={upload.busy ? "Uploading…" : "Upload"}
            onClick={upload.pick}
          />
        ) : null}
        {place.writable && place.folder ? (
          <SidebarAction
            icon={<FolderPlusIcon />}
            label="New folder"
            onClick={() =>
              openDialog({
                type: "newFolder",
                parent: place.folder!,
                onCreated: (id) => go({ location: id }),
              })
            }
          />
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col gap-2.5 px-(--sidebar-content-inset) pt-3">
        <SidebarSwitcher
          selectedId={place.sharedWithMe ? SHARED : (place.drive?.id ?? null)}
          onSelect={(id) => go({ location: id })}
          items={[
            ...place.drives.map((d) => ({
              id: d.id,
              label: driveLabel(d),
              icon: <DriveMark folder={d} />,
            })),
            ...(sharedOn ? [{ id: SHARED, label: "Shared with me", icon: <SharedMark /> }] : []),
          ]}
        />
        {searching ? (
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-sidebar-muted-foreground" />
            <Input
              ref={searchRef}
              value={f.query}
              placeholder="Search documents"
              aria-label="Search documents"
              className="h-7 pr-7 pl-8 text-[13px]"
              onChange={(e) => setFilters({ query: e.target.value })}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.preventDefault();
                closeSearch();
              }}
            />
            <button
              type="button"
              aria-label="Close search"
              className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-sidebar-muted-foreground hover:text-sidebar-foreground"
              onClick={closeSearch}
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        ) : null}
        <div className="scroll-fade-x -mx-(--sidebar-content-inset) flex gap-1.5 overflow-x-auto px-(--sidebar-content-inset) [scrollbar-width:none]">
          <DropdownMenu>
            <DropdownMenuTrigger className={chip(f.kind !== null)}>
              {f.kind ? KINDS[f.kind].label : "Type"}
              <ChevronDownIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              <DropdownMenuItem onSelect={() => setFilters({ kind: null })}>
                <Tick on={f.kind === null} />
                Any type
              </DropdownMenuItem>
              {(Object.keys(KINDS) as Kind[]).map((k) => {
                const { label, Icon } = KINDS[k];
                return (
                  <DropdownMenuItem key={k} onSelect={() => setFilters({ kind: k })}>
                    <Tick on={f.kind === k} />
                    <Icon className="size-4 text-muted-foreground" />
                    {label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            aria-pressed={f.recent}
            className={chip(f.recent)}
            onClick={() => setFilters({ recent: !f.recent })}
          >
            <ClockIcon />
            Updated this week
          </button>
          {place.sharedWithMe ? null : (
            <button
              type="button"
              aria-pressed={f.archived}
              className={chip(f.archived)}
              onClick={() => setFilters({ archived: !f.archived })}
            >
              <ArchiveIcon />
              Archived
            </button>
          )}
        </div>
      </div>
      <SidebarBody>
        {inFolder && place.folder?.parentId ? (
          <button
            type="button"
            onClick={() => go({ location: place.folder!.parentId! })}
            className="mb-1 flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-[13px] text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          >
            <ChevronLeftIcon className="size-4 shrink-0" />
            <span className="truncate">{place.folder.name}</span>
          </button>
        ) : null}
        <DocumentList place={place} item={item} go={go} />
      </SidebarBody>
    </div>
  );
}

function Tick({ on }: { on: boolean }) {
  return <span className="flex w-4">{on ? <CheckIcon className="size-4" /> : null}</span>;
}

function DocumentList({
  place,
  item,
  go,
}: {
  place: Place;
  item: string | null;
  go: WorkspaceProps["go"];
}) {
  const f = useFilters();
  if (place.error)
    return (
      <p className="px-2 py-4 text-[13px] text-sidebar-muted-foreground">
        {errorText(place.error)}
      </p>
    );
  if (place.loading)
    return (
      <div className="flex flex-col">
        {["a", "b", "c", "d", "e", "f"].map((k) => (
          <div key={k} className="flex items-center gap-2.5 px-2 py-1.5">
            <div className="size-8 animate-pulse rounded-md bg-sidebar-row-hover" />
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="h-3 w-3/4 animate-pulse rounded bg-sidebar-row-hover" />
              <div className="h-2.5 w-1/2 animate-pulse rounded bg-sidebar-row-hover" />
            </div>
          </div>
        ))}
      </div>
    );
  if (place.subfolders.length === 0 && place.documents.length === 0)
    return (
      <p className="px-2 py-4 text-[13px] text-sidebar-muted-foreground">
        {f.query || f.kind || f.recent
          ? "No documents match."
          : f.archived
            ? "Nothing archived."
            : place.sharedWithMe
              ? "Nothing's been shared with you yet."
              : "No documents yet."}
      </p>
    );
  return (
    <div className="flex flex-col">
      {place.subfolders.map((folder) => (
        <FolderRow key={folder.id} folder={folder} onOpen={() => go({ location: folder.id })} />
      ))}
      {place.documents.map((a) => (
        <DocumentRow
          key={a.id}
          artifact={a}
          folderId={place.folder?.id}
          selected={a.id === item}
          onOpen={() => go({ item: a.id })}
          onGone={() => a.id === item && go({})}
        />
      ))}
    </div>
  );
}

function WithMenu({ actions, children }: { actions: Action[]; children: ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-56">
        <ActionItems actions={actions} menu="context" />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FolderRow({ folder, onOpen }: { folder: DriveFolder; onOpen: () => void }) {
  const actions = useFolderActions(folder, { onOpen });
  return (
    <WithMenu actions={actions}>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-sidebar-row-hover"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border">
          <FolderIcon className="size-4 text-sidebar-muted-foreground" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-sidebar-foreground">
          {folder.name}
        </span>
        {folder.shared ? (
          <UsersIcon className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
        ) : null}
      </button>
    </WithMenu>
  );
}

function DocumentRow({
  artifact,
  folderId,
  selected,
  onOpen,
  onGone,
}: {
  artifact: DriveArtifact;
  folderId: string | undefined;
  selected: boolean;
  onOpen: () => void;
  onGone: () => void;
}) {
  const kind = KINDS[kindOf(artifact)];
  const thumb = useThumbnail(artifact);
  const warm = useWarm(artifact);
  const actions = useDocumentActions(artifact, { folderId, onGone });
  const subtitle = artifact.description || artifact.current?.entryPath || "";
  return (
    <WithMenu actions={actions}>
      <button
        type="button"
        onClick={onOpen}
        {...warm}
        aria-current={selected ? "page" : undefined}
        className={cn(
          "flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
          selected ? "bg-sidebar-row-selected" : "hover:bg-sidebar-row-hover",
        )}
      >
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-sidebar-border bg-background">
          {thumb.src ? (
            <img
              src={thumb.src}
              alt=""
              loading="lazy"
              onError={thumb.failed}
              className="size-full object-cover object-top"
            />
          ) : (
            <kind.Icon className="size-4 text-sidebar-muted-foreground" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-snug">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-sidebar-foreground">
              {artifact.title}
            </span>
            <span className="shrink-0 text-[11px] text-sidebar-muted-foreground tabular-nums">
              {when(artifact.updatedAt)}
            </span>
          </span>
          {subtitle ? (
            <span className="truncate text-[12px] text-sidebar-muted-foreground">{subtitle}</span>
          ) : null}
          <span className="flex items-center gap-1 truncate text-[11px] text-sidebar-muted-foreground/80">
            {artifact.shared ? <UsersIcon className="size-3 shrink-0" /> : null}
            {[
              kind.one,
              artifact.shared ? "Shared" : null,
              artifact.versionCount > 1
                ? `v${artifact.current?.number ?? artifact.versionCount}`
                : null,
              artifact.archived ? "Archived" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      </button>
    </WithMenu>
  );
}

function useWarm({ id, folderId }: DriveArtifact) {
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return {
    onPointerEnter: () => {
      timer.current = setTimeout(
        () => void qc.prefetchQuery(previewQuery(id, folderId || undefined, null)),
        120,
      );
    },
    onPointerLeave: () => clearTimeout(timer.current),
  };
}

function useThumbnail({ id, folderId, thumbnailUrl: url }: DriveArtifact) {
  const [direct, setDirect] = useState(true);
  const fetched = useQuery({
    queryKey: ["otter-drive", "thumbnail", id],
    queryFn: () => driveApi.thumbnail(id, folderId || undefined),
    enabled: url !== null && !direct,
    retry: false,
    staleTime: 4 * 60_000,
  });
  return {
    src: !url ? null : direct ? url : (fetched.data ?? null),
    failed: () => setDirect(false),
  };
}

export function DriveMain(props: WorkspaceMainProps) {
  const status = useDriveStatus();
  const place = usePlace(props.location);
  if (status.data && !status.data.connected) return <SignInScreen {...props} />;
  return props.item ? (
    <DocumentView key={props.item} {...props} id={props.item} folderId={place.folder?.id} />
  ) : (
    <Overview {...props} place={place} />
  );
}

function SignInScreen({ titleLeading, titleTrailing }: WorkspaceMainProps) {
  const { code, url, pending, signIn, cancel } = useDriveSignIn();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TitleBar leading={titleLeading} trailing={titleTrailing}>
        <span className="min-w-0 flex-1" />
      </TitleBar>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <OtterDriveIcon className="size-14 rounded-2xl shadow-sm" />
        <div className="flex max-w-sm flex-col gap-1.5">
          <h2 className="text-lg font-medium text-foreground">Your documents, beside your mail</h2>
          <p className="text-sm text-muted-foreground">
            Sign in to Otter Drive to browse, preview and upload your drives&apos; documents here.
            Your sign-in stays on this device.
          </p>
        </div>
        {code ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground">Confirm this code in your browser</p>
            <span className="rounded-lg border border-border px-4 py-2 font-mono text-lg tracking-widest text-foreground select-all">
              {code}
            </span>
            <div className="flex gap-2">
              {url ? (
                <Btn size="sm" onClick={() => void window.desktopBridge.openExternal(url)}>
                  Open sign-in page
                </Btn>
              ) : null}
              <Btn size="sm" onClick={cancel}>
                Cancel
              </Btn>
            </div>
          </div>
        ) : (
          <Btn variant="primary" disabled={pending} onClick={() => void signIn()}>
            {pending ? "Signing in…" : "Sign in to Otter Drive"}
          </Btn>
        )}
      </div>
    </div>
  );
}

function useDropUpload(enabled: boolean, onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: DragEvent) => enabled && e.dataTransfer.types.includes("Files");
  return {
    over,
    handlers: {
      onDragEnter: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        depth.current++;
        setOver(true);
      },
      onDragLeave: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        if (--depth.current <= 0) setOver(false);
      },
      onDragOver: (e: DragEvent) => {
        if (hasFiles(e)) e.preventDefault();
      },
      onDrop: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length) onFiles(files);
      },
    },
  };
}

function Overview({
  go,
  place,
  titleLeading,
  titleTrailing,
}: WorkspaceMainProps & { place: Place }) {
  const upload = useUpload(place.folder?.id, go);
  const drop = useDropUpload(place.writable, upload.files);
  const f = useFilters();
  const title = place.sharedWithMe
    ? "Shared with me"
    : place.folder
      ? place.folder.parentId
        ? place.folder.name
        : driveLabel(place.folder)
      : "Drive";
  const where = place.sharedWithMe ? SHARED : place.folder?.id;
  const filtered = Boolean(f.query || f.kind || f.recent);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" {...drop.handlers}>
      <TitleBar leading={titleLeading} trailing={titleTrailing}>
        {place.sharedWithMe ? (
          <SharedMark />
        ) : place.drive ? (
          <DriveMark folder={place.drive} />
        ) : null}
        <Crumbs place={place} title={title} go={go} />
        {place.folder ? <FolderMenu folder={place.folder} go={go} /> : null}
        {place.loading ? null : (
          <span className="text-xs text-muted-foreground tabular-nums">
            {place.documents.length}
          </span>
        )}
        <span className="min-w-0 flex-1" />
        <SortMenu />
        {place.writable ? (
          <Btn
            size="sm"
            variant="primary"
            className="no-drag"
            disabled={upload.busy}
            onClick={upload.pick}
          >
            <UploadIcon />
            {upload.busy ? "Uploading…" : "Upload"}
          </Btn>
        ) : null}
      </TitleBar>
      <div key={where} className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-6">
        {place.error ? (
          <Empty title="Couldn't load your documents" detail={errorText(place.error)} />
        ) : place.loading ? (
          <Grid>
            {["a", "b", "c", "d", "e", "f", "g", "h"].map((k) => (
              <div key={k} className="aspect-[4/3] animate-pulse rounded-xl bg-muted/60" />
            ))}
          </Grid>
        ) : place.documents.length === 0 ? (
          <Empty
            title={
              filtered ? "No documents match" : f.archived ? "Nothing archived" : "No documents yet"
            }
            detail={
              filtered
                ? "Try another filter."
                : place.writable
                  ? "Upload a file, drop one here, or save an attachment from an email."
                  : "Documents shared with you show up here."
            }
          />
        ) : (
          <Grid>
            {place.documents.map((a) => (
              <DocumentCard
                key={a.id}
                artifact={a}
                folderId={place.folder?.id}
                onOpen={() => go({ item: a.id })}
              />
            ))}
          </Grid>
        )}
      </div>
      {drop.over ? (
        <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/70 bg-background/80">
          <p className="text-sm font-medium text-foreground">Drop to upload to {title}</p>
        </div>
      ) : null}
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">{children}</div>
  );
}

function DocumentCard({
  artifact,
  folderId,
  onOpen,
}: {
  artifact: DriveArtifact;
  folderId: string | undefined;
  onOpen: () => void;
}) {
  const kind = KINDS[kindOf(artifact)];
  const thumb = useThumbnail(artifact);
  const warm = useWarm(artifact);
  const actions = useDocumentActions(artifact, { folderId });
  return (
    <WithMenu actions={actions}>
      <button
        type="button"
        onClick={onOpen}
        {...warm}
        className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-left outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <div className="relative aspect-[4/3] overflow-hidden border-b border-border bg-muted/50">
          {thumb.src ? (
            <img
              src={thumb.src}
              alt=""
              loading="lazy"
              onError={thumb.failed}
              className="size-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <kind.Icon className="size-8 text-muted-foreground/60" />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
          <span className="truncate text-[13px] font-medium text-foreground">{artifact.title}</span>
          <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            {artifact.shared ? (
              <UsersIcon className="size-3 shrink-0" />
            ) : (
              <kind.Icon className="size-3 shrink-0" />
            )}
            <span className="truncate">
              {kind.one}
              {artifact.versionCount > 1 ? ` · v${artifact.current?.number ?? ""}` : ""} ·{" "}
              {when(artifact.updatedAt)}
            </span>
          </span>
        </div>
      </button>
    </WithMenu>
  );
}

function Crumbs({ place, title, go }: { place: Place; title: string; go: WorkspaceProps["go"] }) {
  if (place.sharedWithMe || place.trail.length < 2)
    return <h1 className="truncate text-sm font-medium text-foreground">{title}</h1>;
  const steps =
    place.trail.length > 3 ? [place.trail[0]!, null, ...place.trail.slice(-2)] : place.trail;
  return (
    <nav aria-label="Location" className="no-drag flex min-w-0 items-center gap-0.5 text-sm">
      {steps.map((f, i) => {
        const last = i === steps.length - 1;
        return (
          <span key={f?.id ?? "more"} className="flex min-w-0 items-center gap-0.5">
            {i > 0 ? <span className="px-0.5 text-muted-foreground">›</span> : null}
            {!f ? (
              <span className="text-muted-foreground">…</span>
            ) : last ? (
              <h1 className="truncate font-medium text-foreground">{f.name}</h1>
            ) : (
              <button
                type="button"
                onClick={() => go({ location: f.id })}
                className="truncate rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {f.parentId ? f.name : driveLabel(f)}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function FolderMenu({ folder, go }: { folder: DriveFolder; go: WorkspaceProps["go"] }) {
  const actions = useFolderActions(folder);
  if (!actions.some((a) => !("separator" in a))) return null;
  const shown = actions.map((a) =>
    a.id === "new" && "run" in a
      ? {
          ...a,
          run: () =>
            openDialog({
              type: "newFolder",
              parent: folder,
              onCreated: (id) => go({ location: id }),
            }),
        }
      : a,
  );
  return (
    <DropdownMenu>
      <HintTooltip label="Folder actions">
        <DropdownMenuTrigger asChild>
          <IconBtn label="Folder actions" className="no-drag">
            <MoreHorizontalIcon />
          </IconBtn>
        </DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent align="start" className="min-w-52">
        <ActionItems actions={shown} menu="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortMenu() {
  const f = useFilters();
  return (
    <DropdownMenu>
      <HintTooltip label="Sort">
        <DropdownMenuTrigger asChild>
          <IconBtn label="Sort" className="no-drag">
            <ArrowUpDownIcon />
          </IconBtn>
        </DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(Object.keys(SORTS) as Sort[]).map((k) => (
          <DropdownMenuItem key={k} onSelect={() => setFilters({ sort: k })}>
            <Tick on={f.sort === k} />
            {SORTS[k]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
