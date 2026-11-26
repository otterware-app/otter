import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { expect, it, vi } from "vite-plus/test";

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "otter-permissions-"));

vi.mock("electron", () => ({
  app: { getPath: () => userData },
  ipcMain: { handle: vi.fn() },
  systemPreferences: {},
}));
vi.mock("./host.ts", () => ({ host: () => ({ broadcast: vi.fn() }) }));

fs.writeFileSync(
  path.join(userData, "Site Permissions.json"),
  JSON.stringify({ "https://meet.example": { camera: true } }),
);
const { checkPermission } = await import("./permissions.ts");

it("checks the device asked about: the camera granted isn't the microphone", () => {
  expect(checkPermission("https://meet.example", "media", "video")).toBe(true);
  expect(checkPermission("https://meet.example", "media", "audio")).toBe(false);
  expect(checkPermission("https://other.example", "media", "video")).toBe(false);
  expect(checkPermission("https://meet.example", "fullscreen")).toBe(true);
});
