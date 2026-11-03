/**
 * Otter Drive's API (https://drive.otterware.app): a device sign-in, your
 * drives and what's shared with you, their documents, and publishing files
 * (an attachment, the email, an upload) as new ones. The token, and the drives
 * you've turned off here, stay in this device's secrets; a drive that's off is
 * refused below, whoever asks (the workspace or an agent).
 */

import {
  fromBase64,
  getAttachmentData,
  mailStore,
  platform,
  sha256Hex,
  toBase64,
  utf8Encode,
} from "@otter-mail/core/extension-kit";

const BASE = "https://drive.otterware.app";
/** Otter Drive's device-flow client for Otterware's own apps. */
const CLIENT_ID = "otterware-cli";
const SECRET = "otter-drive";

/** `hidden`: drives turned off on this device (their ids, or "shared" for Shared with me). */
type Session = { token: string; hidden?: string[] };
export type DriveFolder = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  kind: "personal" | "shared" | "folder";
  role: "owner" | "editor" | "viewer";
  shared: boolean;
};
/** Shared with me, as a pseudo-drive's id. */
export const SHARED = "shared";
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
  role: "owner" | "editor" | "viewer" | null;
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
/**
 * What the workspace shows of a document: what it draws itself (Markdown, text, a table, a
 * workbook's sheets), or Otter Drive's URL for it (a video, an image, a frame for the rest).
 */
export type DrivePreview =
  | { kind: "markdown" | "table" | "text"; text: string; delimiter?: string; truncated: boolean }
  | { kind: "workbook"; sheets: { name: string; rows: string[][] }[]; truncated: boolean }
  | { kind: "video" | "image" | "frame"; url: string };
export type DriveSignIn = {
  attempt: number;
  userCode: string;
  verificationUrl: string;
  deviceCode: string;
};

/** The drives turned off here: kept apart from the sign-in, so signing in again keeps them. */
const HIDDEN = "otter-drive-hidden";

async function readHidden(): Promise<string[]> {
  try {
    const value: unknown = JSON.parse((await platform().secrets.get(HIDDEN)) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

async function session(): Promise<Session | null> {
  const saved = await platform().secrets.get(SECRET);
  if (!saved) return null;
  return { token: (JSON.parse(saved) as { token: string }).token, hidden: await readHidden() };
}

/** Writes to the stored sign-in and switches, one at a time, each reading what the last left. */
let writes: Promise<unknown> = Promise.resolve();
function serially<T>(work: () => Promise<T>): Promise<T> {
  const run = writes.then(work);
  writes = run.catch(() => {});
  return run;
}

async function call(
  path: string,
  init: RequestInit = {},
  auth: Session | null = null,
  folderId?: string,
) {
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  if (typeof init.body === "string") headers.set("content-type", "application/json");
  if (auth) {
    headers.set("authorization", `Bearer ${auth.token}`);
    if (folderId) headers.set("x-otterdrive-folder", folderId);
  }
  let response: Response;
  try {
    response = await fetch(path.startsWith("https:") ? path : `${BASE}${path}`, {
      ...init,
      headers,
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error("Could not reach Otter Drive. Check your connection and try again.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string } | string;
    } | null;
    if (typeof body?.error === "string") throw new DriveError(body.error);
    if (response.status === 401)
      throw new Error("Your Otter Drive sign-in expired. Sign in again in Settings → Connections.");
    throw new Error(body?.error?.message ?? `Otter Drive answered ${response.status}.`);
  }
  return response;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  auth: Session | null = null,
  folderId?: string,
) {
  const response = await call(path, init, auth, folderId);
  // An upload's PUT may answer with no JSON.
  return (await response.json().catch(() => undefined)) as T;
}

/** An OAuth error code from the device flow (authorization_pending, slow_down, …). */
class DriveError extends Error {}

async function signedIn(): Promise<Session> {
  const s = await session();
  if (!s) throw new Error("Sign in to Otter Drive in Settings → Connections.");
  return s;
}

export async function driveStatus(): Promise<{ connected: boolean; hidden: string[] }> {
  const s = await session();
  return { connected: s !== null, hidden: s?.hidden ?? [] };
}

/** The sign-in waiting for its code: a newer one, Cancel or Sign out ends it. */
let attempt = 0;

/** Starts a sign-in: its code, and the attempt to finish (or that Cancel ends before then). */
export async function startSignIn(): Promise<DriveSignIn> {
  const mine = ++attempt;
  const code = await request<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
  }>("/api/auth/device/code", {
    method: "POST",
    body: JSON.stringify({ client_id: CLIENT_ID, scope: "openid profile email offline_access" }),
  });
  if (attempt !== mine) throw new Error("Otter Drive sign-in was cancelled.");
  return {
    attempt: mine,
    deviceCode: code.device_code,
    userCode: code.user_code,
    verificationUrl: new URL(
      code.verification_uri_complete ?? code.verification_uri,
      BASE,
    ).toString(),
  };
}

/** Polls until the code is approved in the browser, or expires (10 minutes). */
export async function finishSignIn(deviceCode: string, mine: number): Promise<void> {
  let interval = 5_000;
  const expiresAt = Date.now() + 10 * 60_000;
  while (Date.now() < expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    if (attempt !== mine) throw new Error("Otter Drive sign-in was cancelled.");
    try {
      const token = await request<{ access_token: string }>("/api/auth/device/token", {
        method: "POST",
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: CLIENT_ID,
        }),
      });
      // Cancelled or replaced while the token was on its way: it isn't kept.
      await serially(async () => {
        if (attempt !== mine) throw new Error("Otter Drive sign-in was cancelled.");
        attempt++;
        await platform().secrets.set(SECRET, JSON.stringify({ token: token.access_token }));
      });
      return;
    } catch (error) {
      if (!(error instanceof DriveError)) throw error;
      if (error.message === "slow_down") interval += 5_000;
      else if (error.message !== "authorization_pending")
        throw new Error("Otter Drive sign-in was denied or expired. Try again.", { cause: error });
    }
  }
  throw new Error("The Otter Drive code expired before it was approved. Try again.");
}

export function cancelSignIn(): void {
  attempt++;
}

export async function disconnect(): Promise<void> {
  attempt++;
  await serially(() => platform().secrets.delete(SECRET));
}

let folderCache: { at: number; token: string; list: DriveFolder[] } | null = null;

/** Every folder you can reach: your drives, their folders, and folders shared with you. */
async function allFolders(auth: Session): Promise<DriveFolder[]> {
  if (folderCache?.token === auth.token && Date.now() - folderCache.at < 30_000)
    return folderCache.list;
  const result = await request<{ data: DriveFolder[] }>("/api/v1/folders", {}, auth);
  const list = result.data.map(({ id, name, slug, parentId, kind, role, shared }) => ({
    id,
    name,
    slug,
    parentId,
    kind,
    role,
    shared: shared === true,
  }));
  folderCache = { at: Date.now(), token: auth.token, list };
  return list;
}

/** The topmost folder you can reach above this one: its drive, or the folder shared with you. */
function driveOf(list: DriveFolder[], folder: DriveFolder): DriveFolder {
  const byId = new Map(list.map((f) => [f.id, f]));
  let current = folder;
  for (let i = 0; current.parentId && byId.has(current.parentId) && i < 50; i++)
    current = byId.get(current.parentId)!;
  return current;
}

/** The drives (and folders shared with you at their top), on or off here: for Settings. */
export async function drives(): Promise<DriveFolder[]> {
  const list = await allFolders(await signedIn());
  return list.filter((f) => driveOf(list, f).id === f.id);
}

/** The folders of the drives that are on. */
export async function folders(): Promise<DriveFolder[]> {
  const auth = await signedIn();
  const hidden = new Set(auth.hidden ?? []);
  const list = await allFolders(auth);
  return list.filter((f) => !hidden.has(driveOf(list, f).id));
}

/** Turns a drive (or Shared with me) off or on, on this device. */
export async function setDriveHidden(id: string, hidden: boolean): Promise<void> {
  await signedIn();
  await serially(async () => {
    const next = new Set(await readHidden());
    if (hidden) next.add(id);
    else next.delete(id);
    await platform().secrets.set(HIDDEN, JSON.stringify([...next]));
  });
}

/**
 * The session, when the folder (or, with none, Shared with me) is in a drive
 * that's on; refused otherwise, so nothing here reaches a drive you turned off.
 */
async function reachable(folderId: string | undefined): Promise<Session> {
  const auth = await signedIn();
  const hidden = new Set(auth.hidden ?? []);
  if (!folderId) {
    if (hidden.has(SHARED)) throw new Error("Shared with me is turned off in Otter Mail.");
    return auth;
  }
  const list = await allFolders(auth);
  const folder = list.find((f) => f.id === folderId);
  if (folder && hidden.has(driveOf(list, folder).id))
    throw new Error("That drive is turned off in Otter Mail.");
  if (!folder && hidden.has(SHARED)) throw new Error("Shared with me is turned off in Otter Mail.");
  return auth;
}

/**
 * A document, when its own folder is in a drive that's on. Drive finds a
 * document by id anywhere you can reach, so the folder the caller names is
 * only a hint: the check is on where the document is. Gives the folder to
 * name in later calls (none for a document shared with you on its own).
 */
async function documentAccess(
  id: string,
  hint: string | undefined,
): Promise<{ auth: Session; folder: string | undefined; raw: RawArtifact }> {
  const auth = await signedIn();
  let cached = looked.get(id);
  if (!cached || cached.token !== auth.token || Date.now() - cached.at > 30_000) {
    const raw = request<{ data: RawArtifact }>(`/api/v1/artifacts/${ref(id)}`, {}, auth, hint).then(
      (r) => r.data,
    );
    cached = { at: Date.now(), token: auth.token, raw };
    looked.set(id, cached);
    raw.catch(() => looked.get(id) === cached && looked.delete(id));
  }
  const raw = await cached.raw;
  const home = raw.folderId ?? raw.organizationId;
  await reachable(home);
  const list = await allFolders(auth);
  return { auth, folder: list.some((f) => f.id === home) ? home : undefined, raw };
}

/**
 * Documents looked up in the last 30 seconds: opening one asks for it, its
 * preview and its versions at once, and each needs to know where it is.
 * Renaming or archiving one drops it.
 */
const looked = new Map<string, { at: number; token: string; raw: Promise<RawArtifact> }>();

/** After a change: the document (or, with none, the folders) looked up again, and search rebuilt. */
function forget(id?: string) {
  if (id) looked.delete(id);
  else folderCache = null;
  index = null;
}

type RawVersion = {
  number: number;
  label: string;
  entryPath: string;
  createdAt: string;
  createdBy: { name: string } | null;
  fileCount: number;
  byteSize: number;
};
type RawArtifact = Omit<
  DriveArtifact,
  "archived" | "current" | "thumbnailUrl" | "role" | "shared" | "folderId"
> & {
  folderId?: string;
  organizationId?: string;
  role?: DriveArtifact["role"];
  shared?: boolean;
  archivedAt: string | null;
  thumbnailUrl?: string | null;
  currentVersion: RawVersion | null;
};

const version = (v: RawVersion): DriveVersion => ({
  number: v.number,
  label: v.label,
  entryPath: v.entryPath,
  createdAt: v.createdAt,
  createdBy: v.createdBy?.name ?? null,
  fileCount: v.fileCount,
  byteSize: v.byteSize,
});

const artifact = (a: RawArtifact): DriveArtifact => ({
  id: a.id,
  folderId: a.folderId ?? a.organizationId ?? "",
  role: a.role ?? null,
  shared: a.shared === true,
  slug: a.slug,
  title: a.title,
  description: a.description,
  updatedAt: a.updatedAt,
  archived: a.archivedAt !== null,
  url: a.url,
  thumbnailUrl: a.thumbnailUrl ?? null,
  versionCount: a.versionCount,
  current: a.currentVersion ? version(a.currentVersion) : null,
});

const ref = (id: string) => encodeURIComponent(id);

/** Thumbnails by document, from the lists (a single document doesn't carry its own). */
const thumbnails = new Map<string, string>();
function remember(list: DriveArtifact[]): DriveArtifact[] {
  for (const a of list) if (a.thumbnailUrl) thumbnails.set(a.id, a.thumbnailUrl);
  return list;
}

/** A folder's documents, most recently updated first (archived ones apart). */
export async function artifacts(folderId: string, archived = false): Promise<DriveArtifact[]> {
  const auth = await reachable(folderId);
  const list: DriveArtifact[] = [];
  let cursor: string | null = null;
  // Up to 500: the workspace filters and searches them in place.
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (archived) query.set("archived", "only");
    if (cursor) query.set("cursor", cursor);
    const page = await request<{ data: RawArtifact[]; pagination: { nextCursor: string | null } }>(
      `/api/v1/artifacts?${query}`,
      {},
      auth,
      folderId,
    );
    list.push(...page.data.map(artifact));
    cursor = page.pagination.nextCursor;
  } while (cursor && list.length < 500);
  return remember(list);
}

/** Documents shared with you on their own (folders shared with you are in `folders`). */
export async function sharedWithMe(): Promise<DriveArtifact[]> {
  const auth = await reachable(undefined);
  const result = await request<{ data: { type: string; artifact?: RawArtifact }[] }>(
    "/api/v1/shared",
    {},
    auth,
  );
  // A document in a folder you can reach follows that folder's drive: off, it's left out.
  const hidden = new Set(auth.hidden ?? []);
  const list = await allFolders(auth);
  const shown = (a: DriveArtifact) => {
    const folder = list.find((f) => f.id === a.folderId);
    return !folder || !hidden.has(driveOf(list, folder).id);
  };
  return remember(
    result.data
      .flatMap((item) =>
        item.type === "artifact" && item.artifact ? [artifact(item.artifact)] : [],
      )
      .filter(shown),
  );
}

export async function getArtifact(id: string, folderId?: string): Promise<DriveArtifact> {
  return artifact((await documentAccess(id, folderId)).raw);
}

export async function versions(id: string, folderId?: string): Promise<DriveVersion[]> {
  const { auth, folder } = await documentAccess(id, folderId);
  const result = await request<{ data: RawVersion[] }>(
    `/api/v1/artifacts/${ref(id)}/versions`,
    {},
    auth,
    folder,
  );
  return result.data.map(version);
}

const MAX_TEXT = 2_000_000;
const MAX_WORKBOOK = 25_000_000;
const MAX_ROWS = 5_000;

/**
 * How a document is shown, as Otter Drive decides it (its `documentKind`): text and tables
 * are drawn by the app; video, images and everything else (pages, sites, PDFs, audio)
 * from Otter Drive's own content URL.
 */
export function documentKind(contentType: string, entryPath: string): DrivePreview["kind"] {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const extension = entryPath.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "tsv" || type === "text/tab-separated-values") return "table";
  if (extension === "csv" || type === "text/csv") return "table";
  if (
    extension === "xlsx" ||
    type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  )
    return "workbook";
  if (extension === "md" || extension === "markdown" || type === "text/markdown") return "markdown";
  if (extension === "txt" || extension === "json" || type === "text/plain") return "text";
  if (type.startsWith("video/") || ["mp4", "m4v", "webm", "mov", "ogv"].includes(extension))
    return "video";
  if (type.startsWith("image/")) return "image";
  return "frame";
}

/**
 * A document's preview: text and tables come back to draw; anything else, Otter Drive's
 * short-lived URL for it, which opens a content session for the file (and a site's other
 * files) on Drive's content host.
 */
export async function preview(
  id: string,
  folderId?: string,
  versionNumber?: number,
): Promise<DrivePreview> {
  const { auth, folder } = await documentAccess(id, folderId);
  const query = versionNumber ? `?version=${versionNumber}` : "";
  const page = await request<{ data: { url: string; contentType: string; version: RawVersion } }>(
    `/api/v1/artifacts/${ref(id)}/preview${query}`,
    {},
    auth,
    folder,
  );
  const { url, contentType } = page.data;
  const { entryPath, byteSize } = page.data.version;
  const kind = documentKind(contentType, entryPath);
  if (
    kind === "video" ||
    kind === "image" ||
    kind === "frame" ||
    (kind === "workbook" && byteSize > MAX_WORKBOOK)
  )
    return { kind: kind === "workbook" ? "frame" : kind, url };

  const params = new URLSearchParams({ path: entryPath });
  if (versionNumber) params.set("version", String(versionNumber));
  const response = await call(
    `/api/v1/artifacts/${ref(id)}/content?${params}`,
    { headers: { accept: "*/*" } },
    auth,
    folder,
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (kind === "workbook") return workbook(bytes);
  const tsv = /\.tsv$/i.test(entryPath) || contentType.includes("tab-separated");
  return {
    kind,
    ...(kind === "table" ? { delimiter: tsv ? "\t" : "," } : {}),
    text: new TextDecoder().decode(bytes.subarray(0, MAX_TEXT)),
    truncated: bytes.length > MAX_TEXT,
  };
}

/** An Excel workbook's sheets, as text, the way Otter Drive reads them. */
async function workbook(bytes: Uint8Array): Promise<DrivePreview> {
  const XLSX = await import("@e965/xlsx");
  const book = XLSX.read(bytes, { type: "array", cellDates: true });
  let truncated = false;
  const sheets = book.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name]!, {
      header: 1,
      defval: "",
      raw: false,
    });
    if (rows.length > MAX_ROWS) truncated = true;
    return {
      name,
      rows: rows.slice(0, MAX_ROWS).map((row) => row.map((cell) => String(cell ?? ""))),
    };
  });
  return { kind: "workbook", sheets, truncated };
}

export async function rename(
  id: string,
  folderId: string | undefined,
  title: string,
): Promise<DriveArtifact> {
  const clean = title.trim().slice(0, 200);
  if (!clean) throw new Error("Give it a title.");
  const { auth, folder } = await documentAccess(id, folderId);
  const result = await request<{ data: RawArtifact }>(
    `/api/v1/artifacts/${ref(id)}`,
    { method: "PATCH", body: JSON.stringify({ title: clean }) },
    auth,
    folder,
  );
  // After the change, so a lookup made meanwhile isn't kept.
  forget(id);
  return artifact(result.data);
}

/** Archives it (Otter Drive keeps it, out of the list), or brings it back. */
export async function setArchived(
  id: string,
  folderId: string | undefined,
  archived: boolean,
): Promise<void> {
  const { auth, folder } = await documentAccess(id, folderId);
  await request(
    `/api/v1/artifacts/${ref(id)}${archived ? "" : "/restore"}`,
    { method: archived ? "DELETE" : "POST" },
    auth,
    folder,
  );
  forget(id);
}

const THUMBNAILS = "https://usercontent.otterware.app/raw/thumbnail/";

/**
 * A thumbnail as a data URL: Drive serves them same-site only, which the
 * desktop app's pages aren't, so its cards ask here when the image won't load.
 */
export async function thumbnail(id: string, folderId?: string): Promise<string | null> {
  await documentAccess(id, folderId);
  const url = thumbnails.get(id);
  if (!url) return null;
  if (!url.startsWith(THUMBNAILS)) throw new Error("Not an Otter Drive thumbnail.");
  const response = await call(url, { headers: { accept: "image/*" } });
  const type = response.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!type.startsWith("image/") || bytes.length > 2_000_000) return null;
  return `data:${type};base64,${toBase64(bytes)}`;
}

type LocalFile = { path: string; contentType: string; bytes: Uint8Array };

const MAX_UPLOAD = 100 * 1024 * 1024;

/** Uploads one file as a new document (version 1). */
async function publishFile(
  auth: Session,
  folderId: string,
  file: LocalFile,
  meta: { title: string; description: string },
): Promise<DriveArtifact> {
  if (file.bytes.length > MAX_UPLOAD) throw new Error(`${file.path} is over 100 MB.`);
  const title = meta.title.trim().slice(0, 200) || file.path;
  const label = "Saved from Otter Mail";
  const created = await request<{ data: { id: string } }>(
    "/api/v1/artifacts",
    {
      method: "POST",
      body: JSON.stringify({
        slug: slugFor(title),
        title,
        description: meta.description.slice(0, 2_000),
        entryPath: file.path,
        label,
      }),
    },
    auth,
    folderId,
  );
  try {
    return await uploadVersion(auth, folderId, created.data.id, file, label, 0);
  } catch (error) {
    await request(
      `/api/v1/artifacts/${created.data.id}/draft`,
      { method: "DELETE" },
      auth,
      folderId,
    ).catch(() => {});
    throw error;
  }
}

/**
 * Uploads one file as a document's next version: `expected` is how many
 * versions it has, so a version someone else added meanwhile isn't overwritten.
 */
async function uploadVersion(
  auth: Session,
  folderId: string | undefined,
  id: string,
  file: LocalFile,
  label: string,
  expected: number,
): Promise<DriveArtifact> {
  if (file.bytes.length > MAX_UPLOAD) throw new Error(`${file.path} is over 100 MB.`);
  const sha256 = await sha256Hex(file.bytes);
  const upload = await request<{
    data: {
      id: string;
      files: { path: string; uploadUrl: string; multipart?: boolean; partSize?: number }[];
    };
  }>(
    `/api/v1/artifacts/${ref(id)}/uploads`,
    {
      method: "POST",
      body: JSON.stringify({
        label,
        entryPath: file.path,
        expectedCurrentVersion: expected,
        files: [
          { path: file.path, contentType: file.contentType, size: file.bytes.length, sha256 },
        ],
      }),
    },
    auth,
    folderId,
  );
  const remote = upload.data.files[0];
  if (!remote) throw new Error("Otter Drive didn't accept the file.");
  const put = (url: string, bytes: Uint8Array) =>
    request<{ data?: { partNumber: number; etag: string } } | undefined>(
      url,
      {
        method: "PUT",
        headers: { "content-type": file.contentType, "x-content-sha256": sha256 },
        body: bytes as BodyInit,
      },
      auth,
      folderId,
    );
  if (remote.multipart && remote.partSize) {
    const parts: { partNumber: number; etag: string }[] = [];
    for (let start = 0, n = 1; start < file.bytes.length; start += remote.partSize, n++) {
      const url = new URL(remote.uploadUrl);
      url.searchParams.set("part", String(n));
      const result = await put(url.toString(), file.bytes.subarray(start, start + remote.partSize));
      if (!result?.data) throw new Error("Otter Drive didn't confirm part of the upload.");
      parts.push(result.data);
    }
    await request(
      `${remote.uploadUrl}/complete`,
      { method: "POST", body: JSON.stringify({ parts }) },
      auth,
      folderId,
    );
  } else {
    await put(remote.uploadUrl, file.bytes);
  }
  const done = await request<{ data: { artifact: RawArtifact } }>(
    `/api/v1/uploads/${upload.data.id}/complete`,
    { method: "POST" },
    auth,
    folderId,
  );
  forget(id);
  return artifact(done.data.artifact);
}

const titleOf = (name: string) => name.replace(/\.[^.]+$/, "") || name;

/** Files the user picks, each as a new document. */
export async function uploadPicked(folderId: string): Promise<DriveArtifact[]> {
  const auth = await reachable(folderId);
  const picked = await platform().userFiles.pick();
  const done: DriveArtifact[] = [];
  for (const f of picked)
    done.push(
      await publishFile(
        auth,
        folderId,
        {
          path: safeName(f.name) || "file",
          contentType: f.mimeType || "application/octet-stream",
          bytes: f.bytes,
        },
        { title: titleOf(f.name), description: "" },
      ),
    );
  return done;
}

/** A file dropped on the workspace. */
export async function uploadBytes(
  folderId: string,
  file: { name: string; type: string; base64: string },
): Promise<DriveArtifact> {
  return publishFile(
    await reachable(folderId),
    folderId,
    {
      path: safeName(file.name) || "file",
      contentType: file.type || "application/octet-stream",
      bytes: fromBase64(file.base64),
    },
    { title: titleOf(file.name), description: "" },
  );
}

/** A file the user picks, as the document's next version. */
export async function uploadNewVersion(
  id: string,
  folderId: string | undefined,
): Promise<DriveArtifact | null> {
  const { auth, folder, raw } = await documentAccess(id, folderId);
  const [f] = await platform().userFiles.pick();
  if (!f) return null;
  return uploadVersion(
    auth,
    folder,
    id,
    {
      path: safeName(f.name) || "file",
      contentType: f.mimeType || "application/octet-stream",
      bytes: f.bytes,
    },
    `Uploaded ${safeName(f.name)}`.slice(0, 300),
    // Drive counts versions here, not the current one's number (an earlier one may be current).
    raw.versionCount,
  );
}

/**
 * Saves a document where the user chooses: its one file as itself, or a
 * version of several files (a site) as Otter Drive's zip of them.
 */
export async function download(
  id: string,
  folderId: string | undefined,
  versionNumber?: number,
): Promise<boolean> {
  const { auth, folder, raw } = await documentAccess(id, folderId);
  let entry = raw.currentVersion;
  if (versionNumber && versionNumber !== entry?.number) {
    const all = await request<{ data: RawVersion[] }>(
      `/api/v1/artifacts/${ref(id)}/versions`,
      {},
      auth,
      folder,
    );
    entry = all.data.find((v) => v.number === versionNumber) ?? null;
  }
  if (!entry) throw new Error("This document has no files yet.");
  const query = new URLSearchParams();
  if (versionNumber) query.set("version", String(versionNumber));
  if (entry.fileCount === 1) {
    query.set("path", entry.entryPath);
    const response = await call(
      `/api/v1/artifacts/${ref(id)}/content?${query}`,
      { headers: { accept: "*/*" } },
      auth,
      folder,
    );
    const name = safeName(entry.entryPath.split("/").pop() ?? "") || raw.slug;
    return platform().userFiles.save(name, new Uint8Array(await response.arrayBuffer()));
  }
  const response = await call(
    `/api/v1/artifacts/${ref(id)}/download${query.size ? `?${query}` : ""}`,
    { headers: { accept: "application/zip" } },
    auth,
    folder,
  );
  return platform().userFiles.save(`${raw.slug}.zip`, new Uint8Array(await response.arrayBuffer()));
}

/** Moves a document into another folder (its owner's, into one they own). */
export async function move(
  id: string,
  folderId: string | undefined,
  destination: string,
): Promise<DriveArtifact> {
  const { auth, folder } = await documentAccess(id, folderId);
  await reachable(destination);
  const result = await request<{ data: RawArtifact }>(
    `/api/v1/artifacts/${ref(id)}/move`,
    { method: "POST", body: JSON.stringify({ folderId: destination }) },
    auth,
    folder,
  );
  forget(id);
  return artifact(result.data);
}

/** Deletes an archived document for good, every version. */
export async function deletePermanently(id: string, folderId: string | undefined): Promise<void> {
  const { auth, folder } = await documentAccess(id, folderId);
  await request(`/api/v1/artifacts/${ref(id)}/permanent`, { method: "DELETE" }, auth, folder);
  forget(id);
}

/** A folder in a drive that's on: a new one inside it. */
export async function createFolder(parentId: string, name: string): Promise<{ id: string }> {
  const auth = await reachable(parentId);
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error("Give it a name.");
  const result = await request<{ data: { id: string } }>(
    "/api/v1/folders",
    { method: "POST", body: JSON.stringify({ name: clean, parentId, kind: "folder" }) },
    auth,
  );
  forget();
  return { id: result.data.id };
}

/** Renames a folder, or moves it under another (in the same drive, or one you own). */
export async function updateFolder(
  id: string,
  change: { name?: string; parentId?: string },
): Promise<void> {
  const auth = await reachable(id);
  if (change.parentId) await reachable(change.parentId);
  const name = change.name?.trim().slice(0, 80);
  if (change.name !== undefined && !name) throw new Error("Give it a name.");
  await request(
    `/api/v1/folders/${ref(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...(name ? { name } : {}),
        ...(change.parentId ? { parentId: change.parentId } : {}),
      }),
    },
    auth,
  );
  forget();
}

/** Deletes an empty folder. */
export async function deleteFolder(id: string): Promise<void> {
  const auth = await reachable(id);
  await request(`/api/v1/folders/${ref(id)}`, { method: "DELETE" }, auth);
  forget();
}

// ---------------------------------------------------------------------------
// Sharing, as Otter Drive has it (Google Drive's model): people by email as
// viewers or editors, and anyone with the link. A shared drive shares by its
// members. Answers come back as Drive gives them (its `Sharing`).
// ---------------------------------------------------------------------------

export type ShareTarget = { type: "folder" | "artifact"; id: string; folderId?: string };
export type ShareRole = "viewer" | "editor";

async function sharingCall(
  target: ShareTarget,
  rest: string,
  init: RequestInit = {},
): Promise<unknown> {
  if (target.type === "folder") {
    const auth = await reachable(target.id);
    return request(`/api/v1/folders/${ref(target.id)}/sharing${rest}`, init, auth);
  }
  const { auth, folder } = await documentAccess(target.id, target.folderId);
  return request(`/api/v1/artifacts/${ref(target.id)}/sharing${rest}`, init, auth, folder);
}

/** Who has access, and the link. */
export async function sharing(target: ShareTarget): Promise<unknown> {
  return ((await sharingCall(target, "")) as { data: unknown }).data;
}

export async function sharePeople(
  target: ShareTarget,
  input: { emails: string[]; role: ShareRole; notify: boolean; message?: string },
): Promise<unknown> {
  const done = await sharingCall(target, "/people", {
    method: "POST",
    body: JSON.stringify(input),
  });
  forget(target.type === "artifact" ? target.id : undefined);
  return done;
}

/** A person's access: a role, or null to remove it (yours too: leaving answers nothing). */
export async function setShareRole(
  target: ShareTarget,
  entryId: string,
  role: ShareRole | null,
): Promise<unknown> {
  const done = await sharingCall(
    target,
    `/people/${ref(entryId)}`,
    role ? { method: "PATCH", body: JSON.stringify({ role }) } : { method: "DELETE" },
  );
  forget(target.type === "artifact" ? target.id : undefined);
  forget();
  return done ?? null;
}

/** Anyone with the link: on as a viewer's or an editor's, or off (null). */
export async function setShareLink(target: ShareTarget, role: ShareRole | null): Promise<unknown> {
  const done = await sharingCall(
    target,
    "/link",
    role ? { method: "PUT", body: JSON.stringify({ role }) } : { method: "DELETE" },
  );
  forget(target.type === "artifact" ? target.id : undefined);
  forget();
  return done;
}

/** People you work with whose name or email has the text, for adding. */
export async function suggestPeople(query: string): Promise<unknown> {
  const auth = await signedIn();
  const result = await request<{ data: unknown }>(
    `/api/v1/people?q=${encodeURIComponent(query)}`,
    {},
    auth,
  );
  return result.data;
}

let whoCache: { token: string; userId: string } | null = null;

/** Your Otter Drive user id: to tell "you" among the people with access. */
export async function me(): Promise<{ userId: string }> {
  const auth = await signedIn();
  if (whoCache?.token !== auth.token) {
    const result = await request<{ data: { userId: string } }>("/api/v1/me", {}, auth);
    whoCache = { token: auth.token, userId: result.data.userId };
  }
  return { userId: whoCache.userId };
}

/**
 * Where a Drive link goes in the workspace: a shared link (`/s/<token>`, which
 * adds what it shares to Shared with me), a document's page, or a folder.
 * Null for any other page, or one in a drive that's off.
 */
export async function resolveLink(
  href: string,
): Promise<{ location: string; item: string | null } | null> {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  const auth = await signedIn();
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  // Opened by its id, which reaches it anywhere (and checks its drive is on).
  const byId = async (id: string) => {
    const found = await documentAccess(id, undefined);
    return { location: found.folder ?? SHARED, item: id };
  };
  // A slug names a document only within its folder: in one you can reach, ask
  // there; a document shared with you on its own is found in Shared with me.
  const bySlug = async (slug: string, where: { folderId?: string; folderSlug?: string }) => {
    const folder = (await allFolders(auth)).find((f) =>
      where.folderId ? f.id === where.folderId : f.slug === where.folderSlug,
    );
    if (folder) {
      await reachable(folder.id);
      const found = await request<{ data: RawArtifact }>(
        `/api/v1/artifacts/${ref(slug)}`,
        {},
        auth,
        folder.id,
      );
      return byId(found.data.id);
    }
    const shared = await request<{
      data: { type: string; folderSlug: string; artifact?: RawArtifact }[];
    }>("/api/v1/shared", {}, auth);
    const item = shared.data.find(
      (i) =>
        i.artifact?.slug === slug &&
        (where.folderId
          ? (i.artifact.folderId ?? i.artifact.organizationId) === where.folderId
          : i.folderSlug === where.folderSlug),
    );
    return item?.artifact ? byId(item.artifact.id) : null;
  };
  try {
    if (parts[0] === "s" && parts[1]) {
      const opened = await request<{
        data: { type: "folder" | "artifact"; folderId: string; slug: string | null };
      }>(`/api/v1/links/${ref(parts[1])}`, { method: "POST" }, auth);
      forget();
      const { type, folderId, slug } = opened.data;
      if (type === "artifact" && slug) return await bySlug(slug, { folderId });
      await reachable(folderId);
      return { location: folderId, item: null };
    }
    if (parts[1] === "a" && parts[2]) return await bySlug(parts[2], { folderSlug: parts[0] });
    const folderId = url.searchParams.get("folder");
    if (parts[0] === "home" && folderId) {
      await reachable(folderId);
      return { location: folderId, item: null };
    }
  } catch {
    return null;
  }
  return null;
}

/** Every document in the drives that are on, for search: built at most once a minute. */
let index: { at: number; key: string; list: Promise<DriveArtifact[]> } | null = null;

async function documentIndex(): Promise<DriveArtifact[]> {
  const auth = await signedIn();
  const key = `${auth.token}\n${(auth.hidden ?? []).join(",")}`;
  if (index?.key === key && Date.now() - index.at < 60_000) return index.list;
  const list = (async () => {
    const reach = (await folders()).slice(0, 60);
    const found: DriveArtifact[] = [];
    // A few folders at a time.
    for (let i = 0; i < reach.length; i += 6)
      for (const page of await Promise.all(
        reach.slice(i, i + 6).map((f) => artifacts(f.id).catch(() => [])),
      ))
        found.push(...page);
    if (!(auth.hidden ?? []).includes(SHARED))
      found.push(...(await sharedWithMe().catch(() => [])));
    const seen = new Set<string>();
    return found.filter((a) => !seen.has(a.id) && seen.add(a.id));
  })();
  index = { at: Date.now(), key, list };
  list.catch(() => index?.list === list && (index = null));
  return list;
}

/** Documents whose title, name or description has every word typed, most recent first. */
export async function search(query: string): Promise<DriveArtifact[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return (await documentIndex())
    .filter((a) => {
      const text = `${a.title} ${a.slug} ${a.description}`.toLowerCase();
      return !a.archived && words.every((w) => text.includes(w));
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 20);
}

export type PublishInput = {
  /** The drive or folder to save into. */
  folderId: string;
  accountId: string;
  messageId: string;
  /** An attachment's id, or absent for the email itself. */
  attachmentId?: string;
  title: string;
};

/** Publishes an attachment, or the email as a page, as a new document. */
export async function publish(input: PublishInput): Promise<DriveArtifact> {
  const auth = await reachable(input.folderId);
  if (!input.title.trim()) throw new Error("Give it a title.");
  const message = mailStore.getMessageDetail(input.accountId, input.messageId);
  if (!message) throw new Error("Open the email again and retry.");
  let file: LocalFile;
  if (input.attachmentId) {
    const part = message.attachments.find((a) => a.id === input.attachmentId);
    if (!part) throw new Error("That attachment isn't on this email.");
    const { base64 } = await getAttachmentData(input.accountId, input.messageId, part.id);
    file = {
      path: safeName(part.filename) || "attachment",
      contentType: part.mimeType || "application/octet-stream",
      bytes: fromBase64(base64),
    };
  } else {
    file = {
      path: "index.html",
      contentType: "text/html",
      bytes: utf8Encode(emailPage(message.subject, message.bodyHtml, message.bodyText)),
    };
  }
  return publishFile(auth, input.folderId, file, {
    title: input.title,
    description: `From “${message.subject}”`,
  });
}

const safeName = (name: string) =>
  name
    .replace(/[\\/]+/g, "-")
    .replace(/\.\.+/g, ".")
    .trim()
    .slice(0, 200);

/** A slug from the title, with a short random tail so two saves never collide. */
export function slugFor(title: string): string {
  const base = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  const tail = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) =>
    (b % 36).toString(36),
  ).join("");
  return `${base || "email"}-${tail}`;
}

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The email as one page: its HTML body, or its text in a <pre>. */
export function emailPage(subject: string, html: string | null, text: string | null): string {
  const body = html ?? `<pre style="white-space:pre-wrap;font:inherit">${escape(text ?? "")}</pre>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body>${body}</body></html>`;
}
