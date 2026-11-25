import * as linux from "./linux.ts";
import * as mac from "./mac.ts";

/** A Chromium-based browser installed here: Chrome, Arc, Brave… */
export type ChromiumBrowser = { id: string; name: string; dataDir: string };

/** What differs between macOS and Linux for the browser; the rest never checks the platform. */
export const browserOS: {
  nativeMessagingDirectories(): string[];
  /** The Chromium-based browsers Otter can import from, where each keeps its profiles. */
  chromiumBrowsers(): ChromiumBrowser[];
  /** The keys a browser encrypts its cookies and passwords with, by their prefix ("v10", "v11"). */
  chromiumKeys(browser: ChromiumBrowser): Promise<Record<string, Buffer>>;
} = process.platform === "darwin" ? mac : linux;
