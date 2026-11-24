import { expect, it, vi } from "vite-plus/test";

const init = vi.hoisted(() => vi.fn());
vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "1.0.0", getPath: () => "/nonexistent" },
}));
vi.mock("@sentry/electron/main", () => ({ init, IPCMode: { Classic: 1 } }));
vi.mock("./logger.ts", () => ({ reportLogsTo: vi.fn() }));

const { reportedByBackend, startErrorReports } = await import("./error-reports.ts");

const windowError = (value: string) => ({
  exception: { values: [{ type: "Error", value }] },
});

it("leaves out a window's copy of a failure core reported, not one only the window saw", () => {
  reportedByBackend((channel) => channel === "gmail:discardThreadDrafts");
  startErrorReports();
  const { beforeSend } = init.mock.calls[0]![0] as { beforeSend: (event: unknown) => unknown };
  const copy = windowError(
    "Error invoking remote method 'gmail:discardThreadDrafts': Error: Microsoft Graph error: 403",
  );
  expect(beforeSend(copy)).toBeNull();
  const unregistered = windowError(
    "Error invoking remote method 'app:takePendingMailto': Error: No handler registered for 'app:takePendingMailto'",
  );
  expect(beforeSend(unregistered)).not.toBeNull();
  expect(beforeSend(windowError("Cannot read properties of undefined"))).not.toBeNull();
});
