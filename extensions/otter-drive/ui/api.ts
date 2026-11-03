import { ipc, task } from "@otter-mail/web/extension-kit";

export type DriveRole = "owner" | "editor" | "viewer";
export type DriveFolder = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  kind: "personal" | "shared" | "folder";
  role: DriveRole;
  shared: boolean;
};
export type DriveVersion = {
  number: number;
  label: string;
  entryPath: string;
  createdAt: string;
  createdBy: string | null;
  fileCount: number;
  byteSize: number;
};
export type DriveArtifact = {
  id: string;
  folderId: string;
  role: DriveRole | null;
  shared: boolean;
  slug: string;
  title: string;
  description: string;
  updatedAt: string;
  archived: boolean;
  url: string;
  thumbnailUrl: string | null;
  versionCount: number;
  current: DriveVersion | null;
};
export type DrivePreview =
  | { kind: "markdown" | "table" | "text"; text: string; delimiter?: string; truncated: boolean }
  | { kind: "workbook"; sheets: { name: string; rows: string[][] }[]; truncated: boolean }
  | { kind: "video"; url: string }
  | { kind: "image"; url: string }
  | { kind: "frame"; url: string };

export type ShareRole = "viewer" | "editor";
export type ShareTarget = { type: "folder" | "artifact"; id: string; folderId?: string };
export type DrivePerson = {
  userId: string | null;
  email: string;
  name: string | null;
  image: string | null;
};
export type AccessEntry = DrivePerson & {
  id: string;
  role: ShareRole;
  inheritedFrom: { id: string; name: string } | null;
  viaLink: boolean;
};
export type Sharing = {
  resource: {
    type: "folder" | "artifact";
    id: string;
    name: string;
    folderKind: "personal" | "shared" | "folder" | null;
  };
  drive: { id: string; name: string; kind: "personal" | "shared"; memberCount: number };
  owner: DrivePerson;
  role: DriveRole;
  canShare: boolean;
  people: AccessEntry[];
  link: { url: string; role: ShareRole } | null;
  inheritedLink: { folderId: string; folderName: string; role: ShareRole } | null;
};

export type DriveMember = {
  id: string;
  email: string;
  role: ShareRole;
  userId: string | null;
};
export type StorageLocation =
  | {
      provider: "s3";
      bucket: string;
      region: string;
      endpoint: string | null;
      pathStyle: boolean;
      prefix: string;
    }
  | { provider: "gcs"; bucket: string; prefix: string }
  | {
      provider: "azure";
      account: string;
      container: string;
      endpoint: string | null;
      prefix: string;
    };
export type StorageBackend = {
  id: string;
  name: string;
  location: StorageLocation;
  isDefault: boolean;
  fileCount: number;
  byteSize: number;
  createdAt: string;
  verifiedAt: string | null;
};
export type DriveStorage = {
  defaultBackendId: string | null;
  otterware: { fileCount: number; byteSize: number };
  backends: StorageBackend[];
};
export type ApiKey = { id: string; name: string | null; start: string | null; createdAt: string };
export type StorageChange =
  | { action: "connect"; input: Record<string, string | boolean> }
  | { action: "default"; backendId: string | null }
  | { action: "keys"; backendId: string; keys: Record<string, string> }
  | { action: "verify" | "disconnect"; backendId: string };

export const SHARED = "shared";

export const driveApi = {
  status: (): Promise<{ connected: boolean; hidden: string[] }> => ipc("otterDrive:status"),
  startSignIn: (): Promise<{
    attempt: number;
    userCode: string;
    verificationUrl: string;
    deviceCode: string;
  }> => ipc("otterDrive:startSignIn"),
  finishSignIn: (deviceCode: string, attempt: number): Promise<void> =>
    task("otterDrive:finishSignIn", { deviceCode, attempt }),
  cancelSignIn: (): Promise<void> => ipc("otterDrive:cancelSignIn"),
  disconnect: (): Promise<void> => ipc("otterDrive:disconnect"),
  drives: (): Promise<DriveFolder[]> => task("otterDrive:drives", {}),
  folders: (): Promise<DriveFolder[]> => task("otterDrive:folders", {}),
  setDriveHidden: (id: string, hidden: boolean): Promise<void> =>
    task("otterDrive:setDriveHidden", { id, hidden }),
  saved: <T>(
    what: "folders" | "artifacts" | "shared",
    folderId?: string,
  ): Promise<{ at: number; data: T } | null> => ipc("otterDrive:saved", { what, folderId }),
  artifacts: (folderId: string, archived = false): Promise<DriveArtifact[]> =>
    task("otterDrive:artifacts", { folderId, archived }),
  shared: (): Promise<DriveArtifact[]> => task("otterDrive:shared", {}),
  search: (query: string): Promise<DriveArtifact[]> => task("otterDrive:search", { query }),
  artifact: (id: string, folderId?: string): Promise<DriveArtifact> =>
    task("otterDrive:artifact", { id, folderId }),
  versions: (id: string, folderId?: string): Promise<DriveVersion[]> =>
    task("otterDrive:versions", { id, folderId }),
  preview: (id: string, folderId?: string, version?: number): Promise<DrivePreview> =>
    task("otterDrive:preview", { id, folderId, version }),
  rename: (id: string, folderId: string | undefined, title: string): Promise<DriveArtifact> =>
    task("otterDrive:rename", { id, folderId, title }),
  setArchived: (id: string, folderId: string | undefined, archived: boolean): Promise<void> =>
    task("otterDrive:setArchived", { id, folderId, archived }),
  thumbnail: (id: string, folderId?: string): Promise<string | null> =>
    task("otterDrive:thumbnail", { id, folderId }),
  download: (id: string, folderId: string | undefined, version?: number): Promise<boolean> =>
    task("otterDrive:download", { id, folderId, version }),
  uploadVersion: (id: string, folderId: string | undefined): Promise<DriveArtifact | null> =>
    task("otterDrive:uploadVersion", { id, folderId }),
  move: (id: string, folderId: string | undefined, destination: string): Promise<DriveArtifact> =>
    task("otterDrive:move", { id, folderId, destination }),
  deletePermanently: (id: string, folderId: string | undefined): Promise<void> =>
    task("otterDrive:deletePermanently", { id, folderId }),
  createFolder: (parentId: string, name: string): Promise<{ id: string }> =>
    task("otterDrive:createFolder", { folderId: parentId, name }),
  updateFolder: (id: string, change: { name?: string; parentId?: string }): Promise<void> =>
    task("otterDrive:updateFolder", { folderId: id, ...change }),
  deleteFolder: (id: string): Promise<void> => task("otterDrive:deleteFolder", { folderId: id }),
  sharing: (target: ShareTarget): Promise<Sharing> => task("otterDrive:sharing", target),
  sharePeople: (
    target: ShareTarget,
    input: { emails: string[]; role: ShareRole; notify: boolean; message?: string },
  ): Promise<{ data: Sharing; notified?: boolean }> =>
    task("otterDrive:sharePeople", { ...target, ...input }),
  setShareRole: (
    target: ShareTarget,
    entryId: string,
    role: ShareRole | null,
  ): Promise<{ data: Sharing } | null> =>
    task("otterDrive:setShareRole", { ...target, entryId, role }),
  setShareLink: (target: ShareTarget, role: ShareRole | null): Promise<{ data: Sharing }> =>
    task("otterDrive:setShareLink", { ...target, role }),
  people: (query: string): Promise<DrivePerson[]> => task("otterDrive:people", { query }),
  me: (): Promise<{ userId: string }> => task("otterDrive:me", {}),
  resolveLink: (href: string): Promise<{ location: string; item: string | null } | null> =>
    task("otterDrive:resolveLink", { href }),
  createDrive: (name: string): Promise<{ id: string }> => task("otterDrive:createDrive", { name }),
  renameDrive: (driveId: string, name: string): Promise<void> =>
    task("otterDrive:renameDrive", { driveId, name }),
  deleteDrive: (driveId: string): Promise<void> => task("otterDrive:deleteDrive", { driveId }),
  driveMembers: (driveId: string): Promise<DriveMember[]> =>
    task("otterDrive:driveMembers", { driveId }),
  transferDrive: (driveId: string, userId: string): Promise<void> =>
    task("otterDrive:transferDrive", { driveId, userId }),
  storage: (driveId: string): Promise<DriveStorage> => task("otterDrive:storage", { driveId }),
  changeStorage: (driveId: string, change: StorageChange): Promise<unknown> =>
    task("otterDrive:changeStorage", { driveId, ...change }),
  apiKeys: (): Promise<ApiKey[]> => task("otterDrive:apiKeys", {}),
  createApiKey: (name: string): Promise<{ key: string }> =>
    task("otterDrive:createApiKey", { name }),
  revokeApiKey: (keyId: string): Promise<void> => task("otterDrive:revokeApiKey", { keyId }),
  saveEdit: (
    id: string,
    folderId: string | undefined,
    edit: { text: string } | { sheets: { name: string; rows: string[][] }[] },
    source: { version: number; count: number },
  ): Promise<DriveArtifact> => task("otterDrive:saveEdit", { id, folderId, edit, source }),
  promoteVersion: (
    id: string,
    folderId: string | undefined,
    version: number,
  ): Promise<DriveArtifact> => task("otterDrive:promoteVersion", { id, folderId, version }),
  uploadPicked: (folderId: string): Promise<DriveArtifact[]> =>
    task("otterDrive:uploadPicked", { folderId }),
  uploadBytes: (
    folderId: string,
    file: { name: string; type: string; base64: string },
  ): Promise<DriveArtifact> => task("otterDrive:uploadBytes", { folderId, ...file }),
  publish: (input: {
    folderId: string;
    accountId: string;
    messageId: string;
    attachmentId?: string;
    title: string;
  }): Promise<DriveArtifact> => task("otterDrive:publish", input),
};

export const driveLabel = (folder: Pick<DriveFolder, "kind" | "name">) =>
  folder.kind === "personal" ? "My Drive" : folder.name;
