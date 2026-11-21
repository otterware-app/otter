import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  app: null as unknown as import("node:events").EventEmitter,
  children: [] as Array<import("node:events").EventEmitter & { postMessage: () => void }>,
  error: vi.fn(),
}));

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  fixture.app = Object.assign(new EventEmitter(), {
    whenReady: () => Promise.resolve(),
    getPath: () => "/tmp",
    getVersion: () => "0.0.0",
    isPackaged: false,
  });
  return {
    app: fixture.app,
    clipboard: {},
    dialog: {},
    ipcMain: { handle: vi.fn() },
    nativeImage: {},
    Notification: {},
    powerMonitor: { on: vi.fn(), getSystemIdleTime: () => 0 },
    safeStorage: {},
    shell: {},
    utilityProcess: {
      fork: () => {
        const child = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
        fixture.children.push(child);
        return child;
      },
    },
  };
});
vi.mock("./error-reports.js", () => ({
  reportedByBackend: vi.fn(),
  setErrorReportsAllowed: vi.fn(),
  sendsErrorReports: false,
}));
vi.mock("./ipc.js", () => ({ broadcast: vi.fn() }));
vi.mock("./logger.js", () => ({
  logger: { error: fixture.error, warn: vi.fn() },
  writeLog: vi.fn(),
}));
vi.mock("./os/index.js", () => ({ hostOS: {} }));
vi.mock("./resources.js", () => ({ agentIconImage: vi.fn() }));
vi.mock("./services/open-message-target.js", () => ({ setPendingOpenMessage: vi.fn() }));
vi.mock("./windows/main-window.js", () => ({ focusMainWindow: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  fixture.children.length = 0;
  fixture.error.mockClear();
});

async function start() {
  const { startBackend } = await import("./backend-host.js");
  void startBackend();
  await Promise.resolve();
  return fixture.children[0]!;
}

describe("the mail backend's exit", () => {
  it("reports and restarts a backend that dies while the app runs", async () => {
    const child = await start();
    child.emit("exit", 9);
    expect(fixture.error).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1_000);
    expect(fixture.children).toHaveLength(2);
  });

  it("lets the backend go once the app is quitting, before will-quit", async () => {
    const child = await start();
    fixture.app.emit("before-quit");
    child.emit("exit", 15);
    expect(fixture.error).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(fixture.children).toHaveLength(1);
  });
});
