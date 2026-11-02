/**
 * Otter Drive's API (https://drive.otterware.app, the `otterdrive` CLI's): a
 * device sign-in, the organizations, and publishing an attachment or the email
 * as a new artifact. The token stays in this device's secrets.
 */

import {
  fromBase64,
  getAttachmentData,
  mailStore,
  platform,
  sha256Hex,
  utf8Encode,
} from "@otter-mail/core/extension-kit";

const BASE = "https://drive.otterware.app";
/** Otter Drive's device-flow client for Otterware's own apps. */
const CLIENT_ID = "otterware-cli";
const SECRET = "otter-drive";

type Session = { token: string; organizationId?: string };
export type DriveOrganization = { id: string; name: string; slug: string };
export type DriveArtifact = {
  id: string;
  slug: string;
  title: string;
  description: string;
  updatedAt: string;
  url: string;
  versionCount: number;
};
export type DriveSignIn = { userCode: string; verificationUrl: string; deviceCode: string };

async function session(): Promise<Session | null> {
  const saved = await platform().secrets.get(SECRET);
  return saved ? (JSON.parse(saved) as Session) : null;
}

async function save(next: Session): Promise<void> {
  await platform().secrets.set(SECRET, JSON.stringify(next));
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  auth: Session | null = null,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (typeof init.body === "string") headers.set("content-type", "application/json");
  if (auth) {
    headers.set("authorization", `Bearer ${auth.token}`);
    if (auth.organizationId) headers.set("x-otterdrive-organization", auth.organizationId);
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

export async function driveStatus(): Promise<{
  connected: boolean;
  organizationId?: string;
}> {
  const s = await session();
  return s ? { connected: true, organizationId: s.organizationId } : { connected: false };
}

export async function startSignIn(): Promise<DriveSignIn> {
  const code = await request<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
  }>("/api/auth/device/code", {
    method: "POST",
    body: JSON.stringify({ client_id: CLIENT_ID, scope: "openid profile email offline_access" }),
  });
  return {
    deviceCode: code.device_code,
    userCode: code.user_code,
    verificationUrl: new URL(
      code.verification_uri_complete ?? code.verification_uri,
      BASE,
    ).toString(),
  };
}

let waiting: string | null = null;

/** Polls until the code is approved in the browser, or expires (10 minutes). */
export async function finishSignIn(deviceCode: string): Promise<void> {
  waiting = deviceCode;
  let interval = 5_000;
  const expiresAt = Date.now() + 10 * 60_000;
  while (Date.now() < expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    if (waiting !== deviceCode) throw new Error("Otter Drive sign-in was cancelled.");
    try {
      const token = await request<{ access_token: string }>("/api/auth/device/token", {
        method: "POST",
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: CLIENT_ID,
        }),
      });
      waiting = null;
      await save({ token: token.access_token });
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
  waiting = null;
}

export async function disconnect(): Promise<void> {
  waiting = null;
  await platform().secrets.delete(SECRET);
}

export async function organizations(): Promise<DriveOrganization[]> {
  const list = await request<DriveOrganization[]>(
    "/api/auth/organization/list",
    {},
    await signedIn(),
  );
  return list.map(({ id, name, slug }) => ({ id, name, slug }));
}

export async function selectOrganization(id: string): Promise<void> {
  const s = await signedIn();
  if (!(await organizations()).some((o) => o.id === id))
    throw new Error("That Otter Drive organization isn't yours.");
  await save({ ...s, organizationId: id });
}

export async function artifacts(): Promise<DriveArtifact[]> {
  const result = await request<{ data: DriveArtifact[] }>(
    "/api/v1/artifacts?limit=50",
    {},
    await signedIn(),
  );
  return result.data.map(({ id, slug, title, description, updatedAt, url, versionCount }) => ({
    id,
    slug,
    title,
    description,
    updatedAt,
    url,
    versionCount,
  }));
}

export type PublishInput = {
  accountId: string;
  messageId: string;
  /** An attachment's id, or absent for the email itself. */
  attachmentId?: string;
  title: string;
};

/** Publishes one file as a new artifact (version 1) and returns its page. */
export async function publish(input: PublishInput): Promise<{ url: string; title: string }> {
  const auth = await signedIn();
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new Error("Give it a title.");
  const message = mailStore.getMessageDetail(input.accountId, input.messageId);
  if (!message) throw new Error("Open the email again and retry.");

  let file: { path: string; contentType: string; bytes: Uint8Array };
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
  const sha256 = await sha256Hex(file.bytes);

  const created = await request<{ data: { id: string } }>(
    "/api/v1/artifacts",
    {
      method: "POST",
      body: JSON.stringify({
        slug: slugFor(title),
        title,
        description: `From “${message.subject}”`.slice(0, 2_000),
        entryPath: file.path,
        label: "Saved from Otter Mail",
      }),
    },
    auth,
  );
  try {
    const upload = await request<{
      data: {
        id: string;
        files: { path: string; uploadUrl: string; multipart?: boolean; partSize?: number }[];
      };
    }>(
      `/api/v1/artifacts/${created.data.id}/uploads`,
      {
        method: "POST",
        body: JSON.stringify({
          label: "Saved from Otter Mail",
          entryPath: file.path,
          expectedCurrentVersion: 0,
          files: [
            { path: file.path, contentType: file.contentType, size: file.bytes.length, sha256 },
          ],
        }),
      },
      auth,
    );
    const remote = upload.data.files[0];
    if (!remote) throw new Error("Otter Drive didn't accept the file.");
    const put = (url: string, bytes: Uint8Array) =>
      request<{ data?: { partNumber: number; etag: string } } | undefined>(
        url,
        {
          method: "PUT",
          headers: {
            "content-type": file.contentType,
            "x-content-sha256": sha256,
          },
          body: bytes as BodyInit,
        },
        auth,
      );
    if (remote.multipart && remote.partSize) {
      const parts: { partNumber: number; etag: string }[] = [];
      for (let start = 0, n = 1; start < file.bytes.length; start += remote.partSize, n++) {
        const url = new URL(remote.uploadUrl);
        url.searchParams.set("part", String(n));
        const result = await put(
          url.toString(),
          file.bytes.subarray(start, start + remote.partSize),
        );
        if (!result?.data) throw new Error("Otter Drive didn't confirm part of the upload.");
        parts.push(result.data);
      }
      await request(
        `${remote.uploadUrl}/complete`,
        { method: "POST", body: JSON.stringify({ parts }) },
        auth,
      );
    } else {
      await put(remote.uploadUrl, file.bytes);
    }
    const done = await request<{ data: { artifact: { url: string; title: string } } }>(
      `/api/v1/uploads/${upload.data.id}/complete`,
      { method: "POST" },
      auth,
    );
    return { url: done.data.artifact.url, title: done.data.artifact.title };
  } catch (error) {
    await request(`/api/v1/artifacts/${created.data.id}/draft`, { method: "DELETE" }, auth).catch(
      () => {},
    );
    throw error;
  }
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
