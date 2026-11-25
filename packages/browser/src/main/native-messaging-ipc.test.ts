import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  onQuit: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("electron", () => ({ ipcMain: { handle: mocks.handle }, app: { on: mocks.onQuit } }));
vi.mock("./native-messaging.ts", () => ({ connectNativeHost: mocks.connect }));

const ID = "aeblfdkhhhdcdjpifhhbdiojplfjncoa";
const extension = { id: ID, manifest: { permissions: ["nativeMessaging"] } };
type Invoke = (
  event: unknown,
  extensionId: string,
  method: string,
  args: unknown[],
) => Promise<unknown>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.connect.mockImplementation(async (_directories, _host, _id, _message, close) => ({
    postMessage: vi.fn(),
    disconnect: vi.fn(() => close()),
  }));
});

async function setup() {
  const { enableNativeMessaging } = await import("./native-messaging-ipc.ts");
  const workers = new Map<number, ReturnType<typeof worker>>();
  const extensions = Object.assign(new EventEmitter(), {
    getExtension: vi.fn((id) => (id === ID ? extension : null)),
  });
  const serviceWorkers = Object.assign(new EventEmitter(), {
    getWorkerFromVersionID: (id: number) => workers.get(id),
  });
  const session = { extensions, serviceWorkers };
  enableNativeMessaging(session as unknown as Parameters<typeof enableNativeMessaging>[0], [
    "/registered-hosts",
  ]);
  const invoke = mocks.handle.mock.calls[0]![1] as Invoke;
  return { session, workers, serviceWorkers, extensions, invoke, enableNativeMessaging };
}

function worker(versionId = 1) {
  const end = vi.fn();
  return {
    versionId,
    scope: `chrome-extension://${ID}/`,
    send: vi.fn(),
    isDestroyed: () => false,
    startTask: vi.fn(() => ({ end })),
    end,
    ipc: { handle: vi.fn() },
  };
}

it("rejects a spoofed origin, a foreign session, and missing nativeMessaging permission", async () => {
  const { session, invoke, extensions } = await setup();
  const owner = worker();
  owner.scope = "https://untrusted.example/";
  const event = { type: "service-worker", session, serviceWorker: owner };
  await expect(invoke(event, ID, "connect", ["port", "com.otter.test"])).rejects.toThrow(
    "Not an extension",
  );
  owner.scope = `chrome-extension://${ID}/`;
  await expect(
    invoke({ ...event, session: { ...session } }, ID, "connect", ["port", "com.otter.test"]),
  ).rejects.toThrow("Not an extension");
  extensions.getExtension.mockReturnValue({ id: ID, manifest: { permissions: [] } });
  await expect(invoke(event, ID, "connect", ["port", "com.otter.test"])).rejects.toThrow(
    "nativeMessaging permission",
  );
  expect(mocks.connect).not.toHaveBeenCalled();
});

it("keeps a worker alive, sends only to it, and ends its task once on disconnect", async () => {
  const { session, workers, serviceWorkers, invoke } = await setup();
  const owner = worker();
  workers.set(1, owner);
  serviceWorkers.emit("running-status-changed", { versionId: 1, runningStatus: "starting" });
  expect(owner.ipc.handle).toHaveBeenCalledWith("crx:nativeCall", expect.any(Function));
  const event = { type: "service-worker", session, serviceWorker: owner };
  await invoke(event, ID, "connect", ["port", "com.otter.test"]);
  expect(owner.startTask).toHaveBeenCalledTimes(1);
  const [, , , message] = mocks.connect.mock.calls[0]!;
  message({ hello: true });
  expect(owner.send).toHaveBeenCalledWith("crx:nativeEvent", "port", "message", { hello: true });
  await invoke(event, ID, "postMessage", ["port", { hello: true }]);
  await invoke(event, ID, "disconnect", ["port"]);
  expect(owner.end).toHaveBeenCalledTimes(1);
  expect(owner.send).toHaveBeenCalledWith("crx:nativeEvent", "port", "disconnect", undefined);
  await expect(invoke(event, ID, "postMessage", ["port", {}])).rejects.toThrow("disconnected port");
});

it("isolates ports between workers and rejects duplicate ids within one owner", async () => {
  const { session, invoke } = await setup();
  const first = { type: "service-worker", session, serviceWorker: worker(1) };
  const second = { type: "service-worker", session, serviceWorker: worker(2) };
  await invoke(first, ID, "connect", ["same-id", "com.otter.test"]);
  await expect(invoke(first, ID, "connect", ["same-id", "com.otter.test"])).rejects.toThrow(
    "already exists",
  );
  await expect(invoke(second, ID, "postMessage", ["same-id", {}])).rejects.toThrow(
    "disconnected port",
  );
  await invoke(second, ID, "connect", ["same-id", "com.otter.test"]);
  expect(mocks.connect).toHaveBeenCalledTimes(2);
});

it("closes hosts and releases keepalive tasks when extensions unload", async () => {
  const { session, invoke, extensions } = await setup();
  const owner = worker();
  await invoke({ type: "service-worker", session, serviceWorker: owner }, ID, "connect", [
    "port",
    "com.otter.test",
  ]);
  const port = await mocks.connect.mock.results[0]!.value;
  extensions.emit("extension-unloaded", {}, extension);
  expect(port.disconnect).toHaveBeenCalledTimes(1);
  expect(owner.end).toHaveBeenCalledTimes(1);
});

it("closes a host whose worker stops while its manifest is still loading", async () => {
  const { session, invoke, workers, serviceWorkers } = await setup();
  const owner = worker();
  workers.set(1, owner);
  serviceWorkers.emit("running-status-changed", { versionId: 1, runningStatus: "starting" });
  let finish!: (port: { postMessage: () => void; disconnect: () => void }) => void;
  const opening = new Promise((resolve) => {
    finish = resolve;
  });
  mocks.connect.mockReturnValueOnce(opening);
  const connecting = invoke(
    { type: "service-worker", session, serviceWorker: owner },
    ID,
    "connect",
    ["port", "com.otter.test"],
  );
  serviceWorkers.emit("running-status-changed", { versionId: 1, runningStatus: "stopped" });
  expect(owner.end).toHaveBeenCalledTimes(1);
  const port = { postMessage: vi.fn(), disconnect: vi.fn() };
  finish(port);
  await connecting;
  expect(port.disconnect).toHaveBeenCalledTimes(1);
  expect(owner.end).toHaveBeenCalledTimes(1);
});

it("closes a page's port when its document navigates", async () => {
  const { session, invoke } = await setup();
  const frame = {
    url: `chrome-extension://${ID}/options.html`,
    frameTreeNodeId: 7,
    isDestroyed: () => false,
    send: vi.fn(),
  };
  const contents = Object.assign(new EventEmitter(), { session, mainFrame: frame });
  const event = { type: "frame", sender: contents, senderFrame: frame };
  await invoke(event, ID, "connect", ["port", "com.otter.test"]);
  const port = await mocks.connect.mock.results[0]!.value;
  contents.emit("did-start-navigation", { isSameDocument: true, frame });
  expect(port.disconnect).not.toHaveBeenCalled();
  contents.emit("did-start-navigation", { isSameDocument: false, frame });
  expect(port.disconnect).toHaveBeenCalledTimes(1);
});
