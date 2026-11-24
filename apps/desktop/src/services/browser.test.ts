import { afterEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  updateExtensions: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("electron", () => ({ app: {}, session: {} }));
vi.mock("electron-chrome-web-store", () => ({
  installChromeWebStore: vi.fn(),
  updateExtensions: mocks.updateExtensions,
}));
vi.mock("../ipc.ts", () => ({ broadcast: vi.fn() }));
vi.mock("../logger.ts", () => ({ logger: mocks.logger }));
vi.mock("./extensions.ts", () => ({ trackTab: vi.fn() }));
vi.mock("./mailto-target.ts", () => ({}));
vi.mock("../os/index.ts", () => ({ hostOS: { modifierKey: "ctrlKey" } }));
vi.mock("../windows/context-menu.ts", () => ({}));
vi.mock("../windows/history-buttons.ts", () => ({ followPageHistoryButtons: vi.fn() }));

const session = {} as Electron.Session;

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

async function checkOnce(rejection: unknown) {
  mocks.updateExtensions.mockRejectedValueOnce(rejection);
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  const { keepExtensionsUpdated } = await import("./browser.ts");
  keepExtensionsUpdated(session);
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.off("unhandledRejection", unhandled);
  expect(mocks.updateExtensions).toHaveBeenCalledOnce();
  expect(unhandled).not.toHaveBeenCalled();
}

it("warns, and doesn't leave unhandled, an update check the network failed", async () => {
  const timeout = Object.assign(new Error("Connect Timeout Error"), {
    name: "ConnectTimeoutError",
  });
  await checkOnce(new TypeError("fetch failed", { cause: timeout }));
  expect(mocks.logger.warn).toHaveBeenCalledWith(
    "browser",
    "Couldn't check for extension updates",
    { error: "ConnectTimeoutError: Connect Timeout Error" },
  );
  expect(mocks.logger.error).not.toHaveBeenCalled();
});

it("reports any other update failure", async () => {
  const error = new SyntaxError("Unexpected token");
  await checkOnce(error);
  expect(mocks.logger.error).toHaveBeenCalledWith("browser", "Extension update failed", error);
});

type Listener = (...args: unknown[]) => void;
function emitter() {
  const listeners = new Map<string, Listener>();
  return {
    on: (name: string, listener: Listener) => listeners.set(name, listener),
    emit: (name: string, ...args: unknown[]) => listeners.get(name)?.(...args),
  };
}

async function pressInPage(input: Partial<Electron.Input>) {
  const host = { ...emitter(), send: vi.fn() };
  const win = { webContents: host, isDestroyed: () => false } as unknown as Electron.BrowserWindow;
  const page = { ...emitter(), id: 7, setWindowOpenHandler: vi.fn() };
  const { attachBrowser } = await import("./browser.ts");
  attachBrowser(win);
  host.emit("did-attach-webview", {}, page);
  const event = { preventDefault: vi.fn() };
  page.emit("before-input-event", event, {
    type: "keyDown",
    control: false,
    meta: false,
    alt: false,
    shift: false,
    ...input,
  });
  return { event, send: host.send };
}

it("asks the page's panel to find when ⌘F / Ctrl+F is pressed in the page", async () => {
  const { event, send } = await pressInPage({ key: "f", control: true });
  expect(event.preventDefault).toHaveBeenCalled();
  expect(send).toHaveBeenCalledWith("browser:find", { webContentsId: 7 });
});

it("leaves the page its other keys", async () => {
  const { event, send } = await pressInPage({ key: "f" });
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
