import { expect, it } from "vite-plus/test";

import { pullRequestTitles } from "./release-changes";

const merge = (number: number, title: string) =>
  `Merge pull request #${number} from otterware-app/t3/branch-${number}\n\n${title}`;

it("lists the merged pull requests newest first, without what ships elsewhere", () => {
  expect(
    pullRequestTitles([
      merge(381, "Agent alerts: the chat and what happened, as T3 Code's"),
      "A call keeps mute set while it connects",
      merge(382, "AGENTS.md: drive gateway plugin changes on the real gateways"),
      merge(383, "Otter Agents: a long chat scrolls without stalling"),
      merge(388, "Docs: drop the runbook's claim about review"),
      merge(384, "iPhone IMAP: a lost connection is not a sync failure"),
      merge(385, "fix(mobile): keep the keyboard up"),
      "chore(release): ios-agents-v0.1.18",
      merge(386, "Opening a deleted message says so (Fixes OTTER-MAIL-DESKTOP-B)"),
      "Merge pull request #387 from otterware-app/t3/no-title",
    ]),
  ).toEqual([
    "Opening a deleted message says so",
    "Agent alerts: the chat and what happened, as T3 Code's",
  ]);
});
