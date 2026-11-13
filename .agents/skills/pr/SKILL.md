---
name: pr
description: Open or update an Otter pull request the house way - a branch off main, the checks, the template filled in, and for anything a user can see, screenshots or a recording attached with `gh --attach`. Use whenever you create a PR, push a change for review, or are asked to add pictures to one.
---

# Open a pull request

## Branch and check

- Branch off `origin/main`, never commit to `main`. A stack goes through `gh stack`.
- Before pushing, run and fix `pnpm typecheck`, `pnpm lint` and `pnpm fmt`, and the tests of the
  packages you touched.
- A gateway plugin or agent client change: driven on `pnpm agents-server` first (AGENTS.md,
  Verifying), and the PR says which paths.
- A fix for a Sentry issue says `Fixes <SHORT-ID>` in its commit or PR.

## The title

The title is what users read in the update card's What's new (the PRs merged since their
version): the change they'll notice, led by its area, as in `Calendar: opens instantly on what it
last saw`. A PR the Mac and web app don't ship leads with `iPhone:`, `Otter Agents:`,
`AGENTS.md:`, `Docs:`, `Changelog:` or `CI:`, which What's new leaves out
(`apps/web/src/main/release-changes.ts`).

## The description

Fill in `.github/pull_request_template.md`: What changed, Why, UI changes, Checklist. Say what
was tested and how, and what wasn't. Name changes that reach users who never use the feature
(other providers, existing screens): reviewers weigh what a merge locks in.

## Pictures: required for anything a user sees

A PR that changes the UI or how the app behaves carries screenshots, or a short recording for
motion and interaction. Without them it isn't ready for review.

- **Capture** on the made-up mailbox (`pnpm dev:fake`, the `test-otter` skill) at a
  1600x1000 viewport, light and dark. When it needs real Gmail, Outlook or IMAP, use the demo
  mailboxes (`pnpm dev:demo`); never a real account. iPhone changes: the simulator
  (`pnpm dev:ios`), light and dark.
- **Show the change**: before and after where something changed, the new state where something
  was added, and the edge cases worth seeing (empty, error, many).
- **Recordings** for motion, drag and drop, or a flow over several screens: the Browser panel's
  recording, or the simulator's.
- **Attach them with gh**, so GitHub hosts them. Don't commit images to a branch or link them
  from a fork. Reference each file in the body and gh rewrites the link to the upload:

  ```sh
  gh pr create --title "…" --body-file body.md \
    --attach './shots/tabs-light.png#The tab row, light' \
    --attach './shots/tabs-dark.png#The tab row, dark'
  ```

  `body.md` has `![The tab row, light](./shots/tabs-light.png)` where the picture goes. To add
  pictures to an open PR: `gh pr edit <n> --attach …` (appended to its body), or
  `gh pr comment <n> --body-file … --attach …`. Alt text follows `#`; up to 50 files a command.

- Keep the files out of the repository: write them to a scratch directory.
- Screenshots use the demo's made-up data only: no real names, addresses or mail.

## After

Link the PR and say what's left: checks, review, the iPhone release if `apps/ios` changed.
Merges are normal merge commits, not squashes.
