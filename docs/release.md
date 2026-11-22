# Releases

The short version, for every part including the web app and relay: `docs/runbook.md`.

Every app is released by one workflow, `.github/workflows/release.yml`: each run works out which
apps to ship ([What a run releases](#what-a-run-releases)). Mac releases are GitHub Releases of
this repository.
New releases support Apple Silicon Macs only (arm64). Intel Macs can keep using older releases,
but no longer receive compatible updates.
The iPhone app ships separately, with its own version ([The iPhone app](#the-iphone-app)); Otter
Agents, the second iPhone app, likewise ([Otter Agents](#otter-agents)).
The Mac and Linux app follow [Otter Code's stable and nightly release trains](https://github.com/otterware-app/otter-code/blob/main/.github/workflows/release.yml). Settings → General
chooses the update channel on this computer. Both channels use the same installed app, mailbox
cache and account data; switching installs the selected channel's build and icon. The default
channel follows the installed build until the user chooses one.

Installed apps check at launch and every four hours, download updates in the background, and
show "Restart to update" in the sidebar. macOS also installs when the app quits; Linux asks for
the admin password on restart. The default ivory icon identifies stable, the purple night sky
identifies nightly, and the blue blueprint identifies unpackaged development runs. The web's
favicon follows its build too; the hosted web app still deploys from main. iPhone has only stable
(TestFlight and App Store) and dev (Debug) icons.

## What a run releases

The workflow's first job, "What to release" (`scripts/release-plan.ts`), chooses the apps and
writes its choice to the run's summary; the other apps' jobs are skipped.

- **A push to `main`** ships each app the push's commits changed. The Mac, Linux and web app is
  built from the whole repository, less what only another part ships: `apps/ios`,
  `apps/ios-agents`, `infra` (the relay, which Cloudflare deploys), `docs`, `changelog`,
  `.github` and `.agents`. The iPhone app: `apps/ios`, `packages/shared`,
  `scripts/export-ios-resources.ts`, `scripts/release-ios.ts`. Otter Agents: `apps/ios-agents`,
  what it compiles and bundles from Otter Mail (`apps/ios/OtterMail/Agent`, which is
  `MailContext`, `Theme`, `Resources`, `Settings/Licenses.swift`) and the same two scripts.
  A `README.md` counts for no app.
- **A run by hand** (Actions → Release → Run workflow, or `gh workflow run release.yml`) ships
  each app that `main` has changed since that app's last release (its newest tag; the releases'
  own version-bump commits don't count). So a release that failed or was cancelled is finished
  by running the workflow again, with nothing to choose.
- `apps` (`desktop`, `iphone`, `agents`, `all`) releases those apps now, whatever changed.
  `channel=stable` is the Mac, Linux and web app's stable release, below. `bump` and `version`
  are the iPhone apps' ([The iPhone app](#the-iphone-app)).
- A `vX.Y.Z` tag releases that commit of the Mac, Linux and web app as stable.

Before publishing, the Mac, Linux and web app's commit passes the checks CI runs on pull
requests (`.github/workflows/checks.yml`; [CI](development.md#ci)). A nightly replays the
results of checks whose inputs haven't changed since they last passed on `main`; a stable
release runs them all.

## Release cycle

1. Land changes on `main` through pull requests (CI must pass).
2. **Nightly:** the Release workflow publishes on each push to `main` that changes the app, so
   each such merged PR. Each run builds that push's exact commit; there
   is no time gate or scheduled polling. A newer nightly cancels the checks and builds of an
   older one still running, which then publishes nothing: pushes in quick succession end in one
   nightly, of the last. Publishing itself is never cancelled, and runs in turn.
   For a build now, whatever changed, run Actions → Release → `apps=desktop`, or
   `gh workflow run release.yml -f apps=desktop`.
3. A nightly previews the next patch version after the latest stable tag, for example
   `0.13.10-nightly.20261013.123`. It is a GitHub prerelease, never the latest stable release,
   and carries only `nightly-mac.yml`, `nightly-linux.yml` and `nightly-linux-arm64.yml` feeds.
   Nightly runs do not change package versions on main.
4. **Stable:** run Actions → Release → `channel=stable`, or
   `gh workflow run release.yml -f channel=stable`. It builds the exact commit of the newest
   published nightly, using the stable version that nightly previewed. An optional
   `-f version=1.0.0` overrides the version, keeping that tested commit. A published nightly
   must exist first. To release another commit already on main, push a stable `vX.Y.Z` tag.
5. Both channels build an Apple Silicon DMG + ZIP on `macos-15` and Linux .debs (x64 and arm64)
   on `ubuntu-24.04`, with the same signing and notarization settings. Stable publishes as
   GitHub's latest release with only `latest-*` feeds, includes an existing changelog note if
   there is one, and records the released version in `apps/*/package.json` on main.

Stable releases queue, whole, one after another. A nightly superseded while checking or building
is cancelled; one that reached publishing finishes, and publishers take turns. Version-bump commits pushed by the workflows' `GITHUB_TOKEN` do not trigger
another workflow run. Manual runs must select the default branch;
release commits must belong to it. Nightly tags are excluded from the tag trigger. Returning
from nightly to stable allows the version downgrade until the stable build is installed; automatic
stable checks never take prereleases. Other local prerelease builds have no update feed.

### Testing the updater locally

Build a newer version into a folder, serve it, and point an older build at it:

```sh
node scripts/build-desktop-artifact.ts --arch arm64 --build-version 0.9.1 --output-dir /tmp/feed
OTTER_UPDATE_URL=http://127.0.0.1:8791 \
  node scripts/build-desktop-artifact.ts --arch arm64 --build-version 0.9.0 --skip-build --output-dir /tmp/old
(cd /tmp/feed && python3 -m http.server 8791 --bind 127.0.0.1)
```

Run the 0.9.0 app from `/tmp/old` with `OTTER_HOME=/tmp/test-home` so it stays off your
data. Unsigned builds download the update but macOS refuses to install it; the full flow needs
signed builds (below).

On Linux, the same with `--platform linux --arch x64`; install the old .deb with
`sudo apt install ./Otter-0.9.0-amd64.deb`. "Restart to update" installs the new one with
dpkg, asking for the admin password (pkexec), and starts it again. Linux builds aren't signed:
apt checks the update's SHA-512 from the feed.

## Google OAuth client

Release builds need the Google OAuth client, or the app can't sign in (the workflow fails early
without it). Under Settings → Secrets and variables → Actions:

- Variable `OTTER_GOOGLE_CLIENT_ID`: the "Desktop app" client ID from the `otterware`
  project.
- Secret `OTTER_GOOGLE_CLIENT_SECRET`: its client secret.

## Signing and notarization

Without these secrets the workflow still publishes, but builds are ad hoc signed: Gatekeeper
blocks them on first open (right-click → Open), and macOS refuses to install their updates (the
sidebar card then says "Couldn't update").
Add them under Settings → Secrets and variables → Actions:

| Secret             | What it is                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `CSC_LINK`         | Base64 of a "Developer ID Application" certificate exported as `.p12` (`base64 -i cert.p12`). |
| `CSC_KEY_PASSWORD` | The password of that `.p12`.                                                                  |
| `APPLE_API_KEY`    | Contents of an App Store Connect API key (`AuthKey_XXXX.p8`) with the Developer role.         |
| `APPLE_API_KEY_ID` | That key's ID.                                                                                |
| `APPLE_API_ISSUER` | The issuer ID shown above the keys list in App Store Connect → Users and Access → Keys.       |

Optional: `MAC_PROVISIONING_PROFILE`, base64 of the "Otter Developer ID" provisioning profile
(Developer ID, macOS, for `dev.otterware.mail` with Communication Notifications;
`base64 -i Otter_Developer_ID.provisionprofile`). With it the app is signed with
`com.apple.developer.usernotifications.communication`, and agents' notifications come from the
agent (its picture, Otter's icon on it: `native/notifier`). Without it they show Otter's icon.
The entitlement without the profile would stop the app from launching, so the build adds one only
with the other. Locally, `OTTER_MAC_PROVISIONING_PROFILE=<path>` does the same for `--signed`
(`--skip-notarize` signs without notarizing, for a test build).

Optional repository variable: `XCODE_APP`, the Xcode to build with on the runner (for example
`/Applications/Xcode_26.0.app`). By default the newest Xcode 26+ on the image is used.

## Building locally

`pnpm dist:desktop:deb` (on Linux) builds the .deb for x64; `--arch arm64` builds the arm64
one on the same machine. It installs to `/opt/otter-mail` with `otter-mail` on the PATH, an
`otter-mail.desktop` that handles mailto: links, and depends on what Debian 12+ and
Ubuntu 22.04+ ship (GTK 3, NSS, libnotify, libsecret, xdg-utils).

`pnpm dist:desktop:dmg` builds an unsigned Apple Silicon DMG. With the secrets above exported
(`APPLE_API_KEY` as a path to the `.p8`), `node scripts/build-desktop-artifact.ts --arch arm64
--signed` builds what CI builds. On a Mac that has the Developer ID identity in its keychain,
`CSC_NAME="Christophe Nicolas Kafrouni (838JVGY7W4)"` can stand in for `CSC_LINK` and
`CSC_KEY_PASSWORD`.

## The iPhone app

The iPhone app has its own version (`MARKETING_VERSION` in `apps/ios/OtterMail.xcodeproj`) and
its own tags (`ios-vX.Y.Z`), apart from the Mac app's: it is released when it has changed, not
with every Mac release. It started from the Mac app's 0.5.6, the last shared version.

1. The Release workflow's "Otter Mail for iPhone" job runs on each push to `main` that touches
   `apps/ios`, `packages/shared`, `scripts/export-ios-resources.ts` or `scripts/release-ios.ts`,
   as a patch. Its releases go one at a time; while one runs, only the newest push waits. For a
   minor or major version: Actions → Release → Run workflow, `apps=iphone` and `patch`, `minor`
   or `major`; or `gh workflow run release.yml -f apps=iphone -f bump=minor` (or
   `-f version=1.0.0`). The version is the latest `ios-vX.Y.Z` tag with that bump (the first
   release ships the project's version), read when the job's turn comes, so one that waited
   takes the version after the release it waited for.
2. The job builds the run's commit on GitHub's `xcode-27` runner with its default (release)
   Xcode, signs it for the App Store and uploads it to App Store Connect. The build number is the
   time (YYYYMMDDhhmm).
3. Only once the upload succeeded does it tag the commit `ios-vX.Y.Z` and commit the version to
   the Xcode project on `main`, so a failed run leaves nothing behind. It makes no GitHub Release:
   the Mac app updates from the latest one.
   Its last step makes the build's Sentry release, with its commits since the last iPhone tag
   (docs/error-reports.md); a failure there doesn't fail the release.
4. About half an hour later the build is in TestFlight for internal testers (everyone on the App
   Store Connect team). To put it in the App Store, pick the build in App Store Connect (Otter
   Mail: Calm Email → App Store) and submit it for review.

Each app's release pushes a version bump to `main`; each rebases before pushing, so they can run
at the same time.

The job and `scripts/release-ios.ts` (`pnpm release:ios [--version x.y.z]`, the same build
from a Mac with Xcode 27, if GitHub can't) sign with:

- The "Apple Distribution: Christophe Nicolas Kafrouni (838JVGY7W4)" identity: the
  `IOS_DISTRIBUTION_P12` secret (base64 of `~/.otter/signing/apple-distribution.p12`) and
  `IOS_DISTRIBUTION_P12_PASSWORD`; on the Mac, the keychain.
- The "Otter Mail App Store" provisioning profile for `dev.otterware.mail`: the
  `IOS_PROVISIONING_PROFILE` secret (base64 of the `.mobileprovision`); on the Mac, Xcode ›
  Settings › Accounts, or downloaded from the developer portal.
- The extension's “Otter Mail Notifications App Store” profile for
  `dev.otterware.mail.notifications`: `IOS_NOTIFICATION_PROVISIONING_PROFILE` (base64).
  Regenerate the main profile with Push Notifications, App Groups and Keychain Sharing;
  enable the shared group `group.dev.otterware.mail.notifications` on both App IDs/profiles.
  The extension and app must be signed by the same team. The release script exports both.
- An App Store Connect API key: the `APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`
  secrets the Mac release notarizes with; on the Mac, `~/.otter/signing/AuthKey_<id>.p8` or
  `OTTER_ASC_KEY`, `OTTER_ASC_KEY_ID` and `OTTER_ASC_ISSUER`.

The App Store app is "Otter Mail: Calm Email" (ID 6817249947); on the phone it's "Otter Mail".
Release builds sign in to Google with their own "iOS" OAuth client (for `dev.otterware.mail`);
development builds use the one for `dev.otterware.mail.dev`. The relay accepts both
(`GOOGLE_IOS_CLIENT_ID`). The demo mailbox shows only in development and TestFlight builds.

## Otter Agents

Otter Agents for iPhone (`apps/ios-agents`) is released like the iPhone app, apart from it: its
own version (`MARKETING_VERSION` in `apps/ios-agents/OtterAgents.xcodeproj`, from 0.1.0) and its
own tags (`ios-agents-vX.Y.Z`).

The Release workflow's "Otter Agents for iPhone" job runs on each push to `main` that
touches `apps/ios-agents`, what the app compiles and bundles from Otter Mail
(`apps/ios/OtterMail/Agent`, which is `MailContext`, `Theme`, `Resources`, `Settings/Licenses.swift`)
or the release scripts, as a patch; by hand,
`gh workflow run release.yml -f apps=agents -f bump=minor` (or `-f version=1.0.0`). It builds, signs
and uploads with the same script (`scripts/release-ios.ts --app agents`; from a Mac,
`pnpm release:ios:agents`), then tags the commit and commits the version to the Xcode project.
It has no Sentry release: the app doesn't report errors.

It signs with the iPhone app's Apple Distribution identity and App Store Connect API key (the
same secrets) and its own profiles: "Otter Agents App Store" for `dev.otterware.agents` (Push
Notifications, Communication Notifications, the `group.dev.otterware.agents` App Group), the
`IOS_AGENTS_PROVISIONING_PROFILE` secret (base64 of the `.mobileprovision`); and "Otter Agents
Notifications App Store" for the notification service extension, `dev.otterware.agents.notifications`
(the same App Group), the `IOS_AGENTS_NOTIFICATION_PROVISIONING_PROFILE` secret. Changing an App
ID's capabilities invalidates its profiles: regenerate them and update the secrets.

The App Store Connect app is "Otter Agents" (ID 6833242723). Builds go to its internal TestFlight
group, Nightly (Internal), automatically. Release builds sign in to Google with the iPhone app's
"iOS" OAuth clients.
