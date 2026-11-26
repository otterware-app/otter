/**
 * The made-up services `pnpm dev:fake` and `pnpm dev:desktop:fake` open on: a pretend Gmail (with
 * its Calendar), Outlook and Todoist that answer the app's own requests from seeded mailboxes
 * (@otter/shared/demo-mailboxes), and a pretend relay signed in to a made-up Otter account with
 * scripted agents and their chats, so the app runs with no Google, Microsoft or Otter account,
 * no agent and no network. Their state is a file in the app's own files, so it changes as the app
 * works.
 * Development, and Otter Mail for iPhone's demo mailbox: the shells import this lazily, behind
 * their dev switch (the iPhone's demo, `@otter/mobile/demo`).
 */
import type { Platform } from "../platform.ts";
import { SESSION_SECRET } from "../services/otter-account.ts";
import { demoGoogleAuth, installFakeGmail } from "./gmail.ts";
import { demoMicrosoftAuth, installFakeOutlook } from "./outlook.ts";
import {
  DEMO_ID_TOKEN,
  DEMO_USER,
  FAKE_RELAY_URL,
  installFakeRelay,
  startSignedIn,
} from "./relay.ts";

export { FAKE_RELAY_URL };
export { withFakeAgents } from "./agent.ts";
/** For tests that drive one service alone. */
export { demoMicrosoftAuth, installFakeOutlook };
export { largeGmailAccountId, stageLargeGmailChanges } from "./gmail.ts";

/**
 * Wraps `fetch` with the fakes and returns `platform` signed in to them. `gmailMessages` adds that
 * many made-up messages to the first Gmail mailbox (large-mailbox.ts), for measuring sync.
 */
export async function withFakeServices(
  platform: Platform,
  { gmailMessages = 0 }: { gmailMessages?: number } = {},
): Promise<Platform> {
  await installFakeGmail(platform.files, { messages: gmailMessages });
  await installFakeOutlook(platform.files);
  await installFakeRelay(platform.files);
  // A browser's session is its cookie: the made-up relay answers who it is, and stays signed out.
  if (platform.relaySession !== "cookie") {
    startSignedIn();
    if (!(await platform.secrets.get(SESSION_SECRET)))
      await platform.secrets.set(
        SESSION_SECRET,
        JSON.stringify({ token: "demo", user: DEMO_USER }),
      );
  }
  return {
    ...platform,
    google: { ...demoGoogleAuth(), signInForIdToken: async () => DEMO_ID_TOKEN },
    microsoft: demoMicrosoftAuth(),
    relayUrl: FAKE_RELAY_URL,
    connect: () => Promise.reject(new Error("The made-up mailbox can't connect to mail servers.")),
  };
}
