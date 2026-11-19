/**
 * The made-up services `pnpm dev:fake` and `pnpm dev:desktop:fake` open on: a pretend Gmail (with
 * its Calendar), Outlook and Todoist that answer the app's own requests from seeded mailboxes
 * (@otter/shared/demo-mailboxes), and a pretend relay signed in to a made-up Otter account with
 * scripted agents and their chats, so the app runs with no Google, Microsoft or Otter account,
 * no agent and no network. Their state is a file in the app's own files, so it changes as the app
 * works.
 * Development only: both shells import this lazily, behind their dev switch.
 */
import type { Platform } from "../platform.js";
import { SESSION_SECRET } from "../services/otter-account.js";
import { demoGoogleAuth, installFakeGmail } from "./gmail.js";
import { demoMicrosoftAuth, installFakeOutlook } from "./outlook.js";
import { DEMO_USER, FAKE_RELAY_URL, installFakeRelay } from "./relay.js";

export { FAKE_RELAY_URL };
export { withFakeAgents } from "./agent.js";
/** For tests that drive one service alone. */
export { demoMicrosoftAuth, installFakeOutlook };

/** Wraps `fetch` with the fakes and returns `platform` signed in to them. */
export async function withFakeServices(platform: Platform): Promise<Platform> {
  await installFakeGmail(platform.files);
  await installFakeOutlook(platform.files);
  await installFakeRelay(platform.files);
  // A browser's session is its cookie: the made-up relay answers who it is.
  if (platform.relaySession !== "cookie" && !(await platform.secrets.get(SESSION_SECRET))) {
    await platform.secrets.set(SESSION_SECRET, JSON.stringify({ token: "demo", user: DEMO_USER }));
  }
  return {
    ...platform,
    google: demoGoogleAuth(),
    microsoft: demoMicrosoftAuth(),
    relayUrl: FAKE_RELAY_URL,
    connect: () => Promise.reject(new Error("The made-up mailbox can't connect to mail servers.")),
  };
}
