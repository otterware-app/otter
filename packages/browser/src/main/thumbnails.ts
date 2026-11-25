import { ipcMain, webContents, type WebContents } from "electron";

/** A picture of each tab, for the ⌃Tab switcher: a hidden page can't be captured, so it's kept. */
const thumbnails = new Map<number, string>();

async function capture(contents: WebContents): Promise<void> {
  if (contents.isDestroyed()) return;
  // A page that isn't drawn (a hidden tab) never answers: keep its last picture.
  const image = await Promise.race([
    contents.capturePage().catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 400)),
  ]);
  if (!image || image.isEmpty() || contents.isDestroyed()) return;
  // PNG: a page without a background of its own is transparent, which JPEG would make black.
  thumbnails.set(contents.id, image.resize({ width: 320 }).toDataURL());
}

export function trackThumbnail(contents: WebContents): void {
  const id = contents.id;
  contents.on("did-stop-loading", () => setTimeout(() => void capture(contents), 600));
  contents.once("destroyed", () => thumbnails.delete(id));
}

/** The tab being left: captured before it's hidden, as far as it still can be. */
export function leavingTab(id: number): void {
  const contents = webContents.fromId(id);
  if (contents) void capture(contents);
}

export function setupThumbnails(): void {
  ipcMain.handle("browser:thumbnails", async (_event, ids: unknown) => {
    if (!Array.isArray(ids)) return {};
    await Promise.all(
      ids.map((id) => {
        const contents = typeof id === "number" ? webContents.fromId(id) : undefined;
        return contents ? capture(contents) : undefined;
      }),
    );
    return Object.fromEntries(ids.map((id) => [id, thumbnails.get(id as number) ?? null]));
  });
}
