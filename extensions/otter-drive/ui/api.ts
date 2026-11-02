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

/** Shared with me, as a pseudo-drive's id. */
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
  artifacts: (folderId: string, archived = false): Promise<DriveArtifact[]> =>
    task("otterDrive:artifacts", { folderId, archived }),
  shared: (): Promise<DriveArtifact[]> => task("otterDrive:shared", {}),
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

/** A drive's name as Drive gives it: yours is My Drive. */
export const driveLabel = (folder: Pick<DriveFolder, "kind" | "name">) =>
  folder.kind === "personal" ? "My Drive" : folder.name;
