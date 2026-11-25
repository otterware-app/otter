import { EventEmitter } from "node:events";
import { expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  app: new (require("node:events").EventEmitter)(),
  extension: null as { id: string; manifest: unknown } | null,
  startWorkerForScope: vi.fn(),
}));

const ID = "aeblfdkhhhdcdjpifhhbdiojplfjncoa";

vi.mock("electron", () => ({
  app: mocks.app,
  ipcMain: {
    handle: (channel: string, handler: () => unknown) => mocks.handlers.set(channel, handler),
  },
  webFrameMain: {},
}));
vi.mock("electron-chrome-web-store", () => ({ uninstallExtension: vi.fn() }));
vi.mock("./host.ts", () => ({
  host: () => ({
    broadcast: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    mainWindow: () => null,
  }),
}));
vi.mock("./os/index.ts", () => ({ browserOS: { nativeMessagingDirectories: () => [] } }));
vi.mock("./native-messaging-ipc.ts", () => ({ enableNativeMessaging: vi.fn() }));
vi.mock("./browser.ts", () => ({
  isPageUrl: () => true,
  preparePage: vi.fn(),
  getBrowserSession: () => ({
    registerPreloadScript: vi.fn(),
    extensions: Object.assign(new EventEmitter(), {
      getExtension: (id: string) => (id === mocks.extension?.id ? mocks.extension : null),
    }),
    serviceWorkers: Object.assign(new EventEmitter(), {
      getAllRunning: () => ({}),
      startWorkerForScope: mocks.startWorkerForScope,
    }),
  }),
}));

it("skips waking the worker of an extension that's been unloaded since it listened", async () => {
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  const { setupExtensions } = await import("./extensions.ts");
  setupExtensions("/preload.js");
  mocks.extension = { id: ID, manifest: { background: { service_worker: "worker.js" } } };
  const page = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn() });
  const event = { sender: page, senderFrame: { url: `chrome-extension://${ID}/popup.html` } };
  mocks.handlers.get("crx:listen")!(event, ID, "windows.onFocusChanged");

  mocks.extension = null;
  mocks.app.emit("browser-window-focus", {}, { id: 7 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  process.off("unhandledRejection", unhandled);
  expect(unhandled).not.toHaveBeenCalled();
  expect(page.send).toHaveBeenCalledWith("crx:event", "windows.onFocusChanged", [7]);
  expect(mocks.startWorkerForScope).not.toHaveBeenCalled();
});
