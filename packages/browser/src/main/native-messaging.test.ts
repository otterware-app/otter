import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { connectNativeHost, findNativeHost, type NativePort } from "./native-messaging.ts";

const ID = "aeblfdkhhhdcdjpifhhbdiojplfjncoa";
const HOST = "com.otter.test";
const directories: string[] = [];
const ports: NativePort[] = [];

afterEach(async () => {
  for (const port of ports.splice(0)) port.disconnect();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "otter-native-"));
  directories.push(directory);
  const binary = path.join(directory, "host with spaces");
  await writeFile(
    binary,
    `#!${process.execPath}
const os = require('node:os');
const little = os.endianness() === 'LE';
function frame(value) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  if (little) header.writeUInt32LE(body.length); else header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}
let pending = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const size = little ? pending.readUInt32LE(0) : pending.readUInt32BE(0);
    if (pending.length < 4 + size) return;
    const message = JSON.parse(pending.subarray(4, size + 4).toString());
    pending = pending.subarray(size + 4);
    if (message.mode === 'exit') { process.exit(0); }
    if (message.mode === 'oversize') {
      const header = Buffer.alloc(4);
      if (little) header.writeUInt32LE(1048577); else header.writeUInt32BE(1048577);
      process.stdout.write(header);
    } else if (message.mode === 'invalid') {
      const header = Buffer.alloc(4);
      if (little) header.writeUInt32LE(1); else header.writeUInt32BE(1);
      process.stdout.write(Buffer.concat([header, Buffer.from('!')]));
    } else if (message.mode === 'partial') {
      process.stdout.end(frame('cut short').subarray(0, 6));
    } else if (message.mode === 'multiple') {
      const frames = Buffer.concat([frame('first'), frame({ text: '🔑 café' })]);
      process.stdout.write(frames.subarray(0, 3));
      setImmediate(() => process.stdout.write(frames.subarray(3)));
    } else {
      process.stderr.write('private host diagnostics');
      process.stdout.write(frame({ received: message, origin: process.argv[2], cwd: process.cwd() }));
    }
  }
});
`,
    { mode: 0o700 },
  );
  const manifest = {
    name: HOST,
    type: "stdio",
    path: binary,
    allowed_origins: [`chrome-extension://${ID}/`],
  };
  const manifestPath = path.join(directory, `${HOST}.json`);
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { directory, manifest, manifestPath };
}

describe("native host discovery", () => {
  it("finds the first installed host, including after a missing directory", async () => {
    const { directory, manifest } = await fixture();
    expect(await findNativeHost([path.join(directory, "missing"), directory], HOST, ID)).toEqual(
      manifest,
    );
  });

  it("rejects traversal and unregistered extensions", async () => {
    const { directory } = await fixture();
    await expect(findNativeHost([directory], "../com.otter.test", ID)).rejects.toThrow(
      "Invalid native messaging host name",
    );
    await expect(findNativeHost([directory], HOST, "another-extension")).rejects.toThrow(
      "forbidden",
    );
    await expect(findNativeHost([directory], "com.missing", ID)).rejects.toThrow("not found");
  });

  it.each([
    { type: "socket" },
    { name: "com.other" },
    { path: "relative-script" },
    { allowed_origins: "*" },
  ])("refuses an invalid manifest: %j", async (override) => {
    const { directory, manifest, manifestPath } = await fixture();
    await writeFile(manifestPath, JSON.stringify({ ...manifest, ...override }));
    await expect(findNativeHost([directory], HOST, ID)).rejects.toThrow(
      "Invalid native messaging host manifest",
    );
  });

  it("doesn't bypass a higher-priority host's origin restrictions", async () => {
    const { directory, manifest, manifestPath } = await fixture();
    const second = path.join(directory, "second");
    await mkdir(second);
    await writeFile(path.join(second, `${HOST}.json`), JSON.stringify(manifest));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, allowed_origins: [] }));
    await expect(findNativeHost([directory, second], HOST, ID)).rejects.toThrow("forbidden");
  });
});

describe("native host transport", () => {
  it("round-trips JSON through a real subprocess with the extension origin and host's cwd", async () => {
    const { directory } = await fixture();
    let received!: (value: unknown) => void;
    const response = new Promise((resolve) => {
      received = resolve;
    });
    const port = await connectNativeHost([directory], HOST, ID, received, () => {});
    ports.push(port);
    port.postMessage({ text: "🔑 café", nested: [1, true, null] });
    expect(await response).toEqual({
      received: { text: "🔑 café", nested: [1, true, null] },
      origin: `chrome-extension://${ID}/`,
      cwd: await realpath(directory),
    });
  });

  it("reads split headers and several messages in one chunk", async () => {
    const { directory } = await fixture();
    const messages: unknown[] = [];
    let complete!: () => void;
    const response = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const port = await connectNativeHost(
      [directory],
      HOST,
      ID,
      (message) => {
        messages.push(message);
        if (messages.length === 2) complete();
      },
      () => {},
    );
    ports.push(port);
    port.postMessage({ mode: "multiple" });
    await response;
    expect(messages).toEqual(["first", { text: "🔑 café" }]);
  });

  it.each([
    ["oversize", "Invalid native messaging message size"],
    ["invalid", "Invalid JSON"],
    ["partial", "Incomplete native messaging message"],
    ["exit", "Native host has exited"],
  ])("disconnects on %s and rejects later writes", async (mode, error) => {
    const { directory } = await fixture();
    let closed!: (error?: string) => void;
    const disconnected = new Promise<string | undefined>((resolve) => {
      closed = resolve;
    });
    const port = await connectNativeHost([directory], HOST, ID, () => {}, closed);
    ports.push(port);
    port.postMessage({ mode });
    expect(await disconnected).toContain(error);
    expect(() => port.postMessage({})).toThrow("disconnected port");
  });

  it("reports a failed launch and disconnects only once", async () => {
    const { directory, manifest, manifestPath } = await fixture();
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, path: path.join(directory, "missing") }),
    );
    let closed!: (error?: string) => void;
    let count = 0;
    const disconnected = new Promise<string | undefined>((resolve) => {
      closed = resolve;
    });
    const port = await connectNativeHost(
      [directory],
      HOST,
      ID,
      () => {},
      (error) => {
        count++;
        closed(error);
      },
    );
    ports.push(port);
    expect(await disconnected).toContain("Failed to start");
    port.disconnect();
    expect(count).toBe(1);
  });
});
