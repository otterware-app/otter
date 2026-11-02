import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { endianness } from "node:os";
import * as path from "node:path";

const HOST_NAME = /^[a-z0-9_]+(?:\.[a-z0-9_]+)*$/;
const MAX_HOST_MESSAGE = 1024 * 1024;
const MAX_BROWSER_MESSAGE = 64 * 1024 * 1024;
const littleEndian = endianness() === "LE";

type HostManifest = {
  name: string;
  path: string;
  type: string;
  allowed_origins: string[];
};

export async function findNativeHost(
  directories: readonly string[],
  name: string,
  extensionId: string,
): Promise<HostManifest> {
  if (!HOST_NAME.test(name)) throw new Error("Invalid native messaging host name specified.");
  for (const directory of directories) {
    let source: string;
    try {
      source = await readFile(path.join(directory, `${name}.json`), "utf8");
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) continue;
      throw new Error("Couldn't read the native messaging host manifest.", { cause: error });
    }
    let manifest: HostManifest;
    try {
      manifest = JSON.parse(source) as HostManifest;
      if (
        !manifest ||
        manifest.name !== name ||
        manifest.type !== "stdio" ||
        typeof manifest.path !== "string" ||
        !path.isAbsolute(manifest.path) ||
        !Array.isArray(manifest.allowed_origins)
      ) {
        throw new Error();
      }
    } catch {
      throw new Error("Invalid native messaging host manifest.");
    }
    if (!manifest.allowed_origins.includes(`chrome-extension://${extensionId}/`)) {
      throw new Error("Access to the native messaging host is forbidden.");
    }
    return manifest;
  }
  throw new Error("Specified native messaging host not found.");
}

export type NativePort = {
  postMessage(message: unknown): void;
  disconnect(): void;
};

/** Chrome's length-prefixed JSON protocol, without a shell or access to message contents in logs. */
export async function connectNativeHost(
  directories: readonly string[],
  name: string,
  extensionId: string,
  onMessage: (message: unknown) => void,
  onDisconnect: (error?: string) => void,
): Promise<NativePort> {
  const manifest = await findNativeHost(directories, name, extensionId);
  const child = spawn(manifest.path, [`chrome-extension://${extensionId}/`], {
    cwd: path.dirname(manifest.path),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let closed = false;
  let pending = Buffer.alloc(0);
  const finish = (error?: string) => {
    if (closed) return;
    closed = true;
    child.stdin.destroy();
    child.kill();
    onDisconnect(error);
  };
  // Host diagnostics can contain private data. Drain them without logging them.
  child.stderr.resume();
  child.on("error", () => finish("Failed to start native messaging host."));
  child.stdin.on("error", () => finish("Error when communicating with the native messaging host."));
  child.stdout.on("error", () =>
    finish("Error when communicating with the native messaging host."),
  );
  child.stdout.on("data", (chunk: Buffer) => {
    if (closed) return;
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const length = littleEndian ? pending.readUInt32LE(0) : pending.readUInt32BE(0);
      if (length === 0 || length > MAX_HOST_MESSAGE) {
        finish("Invalid native messaging message size.");
        return;
      }
      if (pending.length < length + 4) return;
      let message: unknown;
      try {
        const json = new TextDecoder("utf-8", { fatal: true }).decode(
          pending.subarray(4, length + 4),
        );
        message = JSON.parse(json);
      } catch {
        finish("Invalid JSON from the native messaging host.");
        return;
      }
      pending = pending.subarray(length + 4);
      onMessage(message);
      if (closed) return;
    }
  });
  child.stdout.on("end", () =>
    finish(pending.length ? "Incomplete native messaging message." : "Native host has exited."),
  );
  child.on("close", () => finish("Native host has exited."));
  return {
    postMessage(message) {
      if (closed) throw new Error("Attempting to use a disconnected port object.");
      const json = JSON.stringify(message);
      if (json === undefined) throw new Error("Native messages must be JSON serializable.");
      const body = Buffer.from(json, "utf8");
      if (body.length > MAX_BROWSER_MESSAGE)
        throw new Error("Native messaging message is too large.");
      const header = Buffer.alloc(4);
      if (littleEndian) header.writeUInt32LE(body.length);
      else header.writeUInt32BE(body.length);
      child.stdin.write(Buffer.concat([header, body]));
    },
    disconnect: () => finish(),
  };
}
