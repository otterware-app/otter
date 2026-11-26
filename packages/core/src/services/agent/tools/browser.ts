import { platform } from "../../../platform.ts";
import { getUiPreferences } from "../../preferences.ts";
import { turnChat } from "../turn-chats.ts";
import type { AgentTool, ToolArgs } from "./tool.ts";

const tabId = { type: "number", description: "The tab, from browser_tabs or the last snapshot." };
const ref = {
  type: "string",
  description: 'An element\'s ref from the last snapshot ("s1f0e12").',
};

const SNAPSHOT_HELP =
  "Returns the page as a tree of what can be read and used, each control with a ref, " +
  "frame by frame: frames from other sites and extensions (1Password's menu shows as " +
  'frame [extension="1Password – Password Manager"]) come after the page, with their own refs. ' +
  "Refs last until the next snapshot.";

export function hasBrowser(): boolean {
  try {
    return Boolean(platform().browser);
  } catch {
    // Core not started (its tests): no browser.
    return false;
  }
}

const run = (command: string, args: ToolArgs) => {
  const browser = platform().browser;
  if (!browser) throw new Error("This app has no browser.");
  return browser.run(command, args);
};

const tool = (
  name: string,
  title: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  readOnly = false,
): AgentTool => ({
  name,
  title,
  description,
  input: { type: "object", properties, required },
  readOnly,
  run: async (args, ctx) => {
    if (!readOnly) {
      const what = [args.url, args.text !== undefined ? "typing" : "", args.ref, args.key]
        .filter(Boolean)
        .join(" ");
      await ctx.confirm(`${title}${what ? `: ${String(what)}` : ""}`);
    }
    // The chat asking: pages it opens are its own, in its browser beside the conversation.
    const chatId = turnChat(ctx.caller.turn()?.requestId);
    const result = await run(name.replace(/^browser_/, ""), { ...args, ...(chatId && { chatId }) });
    return typeof result === "string" && CAPTCHA.test(result)
      ? result + (await captchaNote())
      : result;
  },
});

const CAPTCHA = /captcha|challenges\.cloudflare\.com|turnstile/i;

/** What the user said in Settings › Browser about CAPTCHAs the agent meets (on by default, as ChatGPT's). */
async function captchaNote(): Promise<string> {
  const allowed = (await getUiPreferences())["browser:solve-captchas"] !== "false";
  return allowed
    ? "\n\nThis page may show a CAPTCHA. The user lets you solve CAPTCHAs for their tasks: " +
        "solve it yourself (click its checkbox; for an image challenge, look with browser_screenshot)."
    : "\n\nThis page may show a CAPTCHA. The user solves CAPTCHAs themselves: ask them to, " +
        "then continue.";
}

/** The built-in browser, the user's own (signed in, with their extensions), as Aside's agent has it. */
export const browserTools: AgentTool[] = [
  tool(
    "browser_tabs",
    "List browser tabs",
    "The tabs open in Otter's browser, with their ids, addresses and titles: the user's own " +
      '(owner "user") and this chat\'s (owner "chat").',
    {},
    [],
    true,
  ),
  tool(
    "browser_snapshot",
    "Read a browser tab",
    `Reads a tab. ${SNAPSHOT_HELP}`,
    { tabId },
    ["tabId"],
    true,
  ),
  tool(
    "browser_open",
    "Open a page",
    `Opens a page in a new tab of this chat's own, in Otter's browser beside the conversation, and reads it. ${SNAPSHOT_HELP}`,
    { url: { type: "string" } },
    ["url"],
  ),
  tool(
    "browser_take",
    "Take a tab",
    "Takes one of the user's tabs into this chat, the page as it is (signed in, filled in): it " +
      "leaves the user's tabs and is this chat's from then on. Take a tab before working in it " +
      'for the user ("this page", "the form I have open").',
    { tabId },
    ["tabId"],
  ),
  tool(
    "browser_navigate",
    "Go to a page",
    'Loads an address in a tab, or "back" / "forward" through its history, then reads it.',
    { tabId, url: { type: "string" } },
    ["tabId", "url"],
  ),
  tool(
    "browser_click",
    "Click in a page",
    "Clicks an element (`ref`), or a point in the page from a browser_screenshot (`x`, `y`), as the user would (a real click, which extensions such as 1Password " +
      "accept), then reads the tab again. To sign in with 1Password: click the username or " +
      "password field, and its menu appears as a frame at the end of the snapshot; click the " +
      "login in it. If the menu only says 1Password is locked, ask the user to unlock 1Password; " +
      "never ask for or type their 1Password password.",
    { tabId, ref, x: { type: "number" }, y: { type: "number" } },
    ["tabId"],
  ),
  tool(
    "browser_type",
    "Type in a page",
    "Types into a field (its text replaced unless `replace` is false), as keystrokes the page " +
      "sees as the user's, optionally pressing Enter after; then reads the tab again. Never " +
      "type a password: let 1Password fill it.",
    {
      tabId,
      ref,
      text: { type: "string" },
      replace: { type: "boolean" },
      submit: { type: "boolean" },
    },
    ["tabId", "text"],
  ),
  tool(
    "browser_press",
    "Press a key in a page",
    "Presses a key in the focused element: Enter, Tab, Escape, Backspace, Delete, Space, " +
      "ArrowDown, ArrowUp, ArrowLeft, ArrowRight, PageDown, PageUp, Home or End. Then reads the tab.",
    { tabId, key: { type: "string" } },
    ["tabId", "key"],
  ),
  tool(
    "browser_screenshot",
    "See a browser tab",
    "A picture of what a tab shows, for what a snapshot can't tell (images, a CAPTCHA's challenge, " +
      "layout). Its pixels are the page's: click a point in it with browser_click's x and y.",
    { tabId },
    ["tabId"],
    true,
  ),
  tool(
    "browser_scroll",
    "Scroll a page",
    "Scrolls a tab by most of a screen, then reads it.",
    { tabId, direction: { type: "string", enum: ["down", "up"] } },
    ["tabId"],
    true,
  ),
];
