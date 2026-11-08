import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** The browser profile the tabs you share from Otter are, to the gateway's agents. */
export const BROWSER_PROFILE = "otter";

/** Where OpenClaw keeps its browser extension relay's key, in its credentials directory. */
export const RELAY_KEY_FILE = "browser-extension-relay.secret";

const KEY = /^[0-9a-f]{64}$/;

/**
 * The key Otter proves itself with on the gateway's extension relay, as OpenClaw's Chrome
 * extension does. Made as OpenClaw makes it when it has none yet.
 */
export async function relayKey(credentialsDir) {
  const file = path.join(credentialsDir, RELAY_KEY_FILE);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const text = await readFile(file, "utf8").catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (text !== null) {
      const key = text.trim();
      if (KEY.test(key)) return key;
      if (key) throw new Error("The gateway's browser relay key isn't one OpenClaw made.");
    } else {
      await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
      const key = randomBytes(32).toString("hex");
      try {
        await writeFile(file, `${key}\n`, { flag: "wx", mode: 0o600 });
        return key;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The gateway's browser relay key isn't readable yet.");
}

/** What an agent in an Otter chat is told about the tabs you share with it. */
export const SHARED_TABS_NOTE = [
  `Tabs the user shares from Otter's browser are browser profile "${BROWSER_PROFILE}": pass \`profile: "${BROWSER_PROFILE}"\` to the browser tool to see and work in them (tabs, snapshot, act, navigate).`,
  'They are the user\'s own pages, signed in as the user, and the user sees what you do as you do it. When the user says "this tab", "the page I\'m on" or "my browser", it is one of these.',
].join("\n");
