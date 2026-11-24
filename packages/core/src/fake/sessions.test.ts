import { describe, expect, it } from "vite-plus/test";

import { DEMO_AGENTS, STUDIO_SESSIONS } from "./chats.ts";
import { fakeSession, fakeSessions } from "./sessions.ts";

describe("the made-up agents' sessions", () => {
  it("lists Otter's own, and every one when asked", () => {
    expect(fakeSessions(DEMO_AGENTS.brokk).map((s) => s.title)).toEqual(["Plan the team dinner"]);
    expect(fakeSessions(DEMO_AGENTS.brokk, true).map((s) => s.title)).toEqual([
      "Grocery list",
      "Plan the team dinner",
      "Rename the photo folders",
    ]);
    expect(fakeSessions(DEMO_AGENTS.rata)).toEqual([]);
  });

  it("reads each, and Studio's copy of a removed gateway's chat", () => {
    const [newsletter] = fakeSessions(DEMO_AGENTS.studio, true).slice(-2);
    expect(fakeSession(DEMO_AGENTS.studio, newsletter!.id)).toHaveLength(2);
    const [removed] = Object.keys(STUDIO_SESSIONS);
    expect(fakeSession(DEMO_AGENTS.studio, removed!)).toHaveLength(2);
    expect(fakeSession(DEMO_AGENTS.brokk, removed!)).toEqual([]);
  });
});
