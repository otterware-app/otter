---
name: write-changelog
description: Write an Otter changelog note (changelog/<version>.md) in the house style after conductor.build/changelog - a few-word title, a one-line lead, a screenshot or two, short bullets. Use only when the user asks for a note, release notes or a changelog entry. The changelog is marketing, not part of releasing - never write, draft, suggest or ask about a note on your own, not even when running a release.
---

# Write a changelog note

The changelog is how Otter announces itself: marketing and brand as much
as a record. Notes live in `changelog/<version>.md` at the repository root.
The website shows them at https://otterware.app/mail/changelog, all on one page,
newest first, with the versions down the side (each note's anchor is its
version: /mail/changelog/#0.5.17); the app only links there ("Changelog" in ⌘K, in the ?
menu at the bottom of Settings). The format lives in `packages/shared/src/changelog.ts`.

The iPhone app releases on its own (TestFlight) and isn't in this changelog.

## Whether to write one

Only when the user asks for one. A release never needs a note and nothing
checks for one, so most releases have none. Don't write, draft or suggest a
note on your own, and don't ask about one when releasing.

If the user asks whether something deserves a note:

- Usually worth it: something new people would notice, want to try, or show
  someone. Those tend to be `minor` bumps (0.6.0), with a screenshot.
- Usually not: fixes, polish, internal work. Those ship as a `patch` with no
  note; gaps in the list are normal (conductor.build skips plenty).
- Unannounced changes can join a later note: it's named for the version it
  ships in and can mention anything since the last note.
- The bump (patch or minor) is the user's call too; suggest, don't decide.

## When

Whenever the user asks: before the release or after it, in a pull request of
its own. The file is named for the version it ships (or shipped) in; for one
not out yet, the latest `vX.Y.Z` tag bumped the way the release will bump it.
`gh release list --limit 1` shows the latest.

A note for a version not released yet stays hidden: the website shows only the
versions up to the one `main` last released. So it's safe on `main` ahead of
the release. The website (otterware-app/website) copies `changelog/` and that
version every hour, so a note shows there within the hour of landing or of its
release; run its Mail changelog workflow to copy it sooner.

The note is also the GitHub Release's: the Release workflow puts it above
GitHub's generated notes, and when it lands after the release, the Changelog
notes workflow (`.github/workflows/changelog-notes.yml`) updates that release.
Both use `scripts/changelog-release-notes.ts`, so write it once, in
`changelog/`, and never by hand in the GitHub Release.

## The file

```markdown
---
title: A smarter ⌘K
date: 2026-09-30
---

Type what you want and Enter does it: commands you name come first, and mail search is one ↓ away.

![⌘K with "sync" typed: Sync now first, then the mail search](images/0.5.11-command-palette.webp)

## Improved

- ⌘K ranks what you type: "set" finds Settings, "work" your Work mailbox.
- Searches like `from:maya` still go straight to your mail.

## Fixed

- The setup no longer nudges sideways as a step settles.
```

- **title**: two to four words naming the release's headline, in sentence case,
  no period. The feature, not the version ("Onboarding", "A smarter ⌘K").
- **date**: the release day, `YYYY-MM-DD`.
- **Lead**: one sentence, two at most, saying what someone can do now. Plain
  words, no marketing ("powerful", "seamless", "we're excited").
- **Images** (optional, up to three): `![Caption](images/<version>-<slug>.webp)`.
  The alt text is shown as the caption, so write it as one: what's on screen.
- **Sections**, only those with something in them, in this order:
  `## New`, `## Improved`, `## Fixed`. A release with one change can skip
  headings and be the lead and a bullet or two.

## Bullets

- One line each, about fifteen words at most. What changed for the person
  using the app, not how it was built.
- Start with the thing or the change: "⌘K ranks …", "Hermes connects …",
  "Mail from shared hosts signs in …".
- Name where it applies when it isn't everywhere: "On the Mac, …",
  "In the web app, …".
- Keys as the app shows them (⌘K, ⇧⌘O), UI names as they read on screen, in
  plain quotes when it helps ("Take the tour").
- Leave out what nobody using the app would notice: refactors, CI, tests,
  internal renames. Something like "Mac releases are Apple Silicon only" is
  noticed, so it belongs.
- Three to eight bullets in all. If there's more, keep the ones people will
  feel and drop the rest.

## Screenshots

- From the made-up mailbox (`pnpm dev:fake`, see the test-otter skill),
  never real mail, at a 1600x1000 viewport. Dark is the default; light is fine
  when the feature is about appearance.
- Crop to the feature when the whole window isn't the point.
- Save as WebP (quality about 80) under `changelog/images/`, named
  `<version>-<slug>.webp`, around 100 KB or less.

## Check it

- `pnpm --filter @otter/shared test`: every note parses and every image it
  shows exists.
- The page itself: copy the note and its images into a checkout of the website
  (`changelog/mail/`), then `pnpm dev` there and open `/mail/changelog/`.
