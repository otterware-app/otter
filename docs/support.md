# Sending feedback

Open **Send feedback** from the mailbox menu, the command palette, or
Settings → General → Support or the ? Help menu beside Back. On the Mac it is
also in the native Help menu.

Choose **Bug report** or **Feature request**, and select the affected platform:
Mac, web, or iPhone. It defaults to the app you are using. GitHub's bug template
applies the existing `bug` label; its feature template applies `enhancement`.
Labels come from templates rather than URL parameters, so public contributors
do not need permission to add labels.

Write a message describing the problem or improvement. You can attach a PNG,
JPEG, or WebP screenshot (up to 5 MB); check it for private mail.
Choose **Review feedback** to edit the generated title and
description, then **Continue on GitHub** to open a prefilled issue.
The arrow beside either action offers **Send to Claude Code / Codex** for
investigation first. Nothing is posted automatically. Attach selected files in
GitHub before submitting. Large reports are copied to the clipboard for you
to paste into GitHub's description.

Diagnostics include the app version and environment, anonymous mailbox sync
metadata, up to 50 recent classified error summaries, and the install's error
report id when error reports are on ([error-reports.md](error-reports.md)). They exclude message
content, mailbox addresses, credentials, and raw log messages. You can omit the
diagnostics or edit the final report. The Mac classifies a bounded tail of its
existing log locally; the web app retains classified backend errors in memory.
Diagnostics are a separate **Otter Mail diagnostics.json** file, rather than JSON
in the issue description. Choose **View → Download diagnostics**, or **Download**
beside the diagnostics file in the review screen, and attach it to GitHub's issue
form. The Mac hands that file to the agent automatically. Diagnostics are only
included when the affected platform matches the app collecting them, and are
off by default for feature requests.

## Investigating with an agent

On the Mac, choose **Send to Claude Code / Codex** from the action dropdown on either step.
This uses an installed agent, its account, and the binary, home, and model chosen
in Settings → Agents. It works even if the in-app provider is switched off.
The app generates a private support folder with the reviewed report, playbook,
optional screenshot, and an executable `.command` file. macOS opens that file
in your terminal. By default it uses macOS's application for `.command` files.
Choose **Terminal** in the action dropdown to use Ghostty or another installed terminal;
Otter Mail remembers that choice on this Mac without changing system file associations.
No Otter Mail CLI or npm package is
installed or required.

The session uses interactive permissions, independently of the in-app chat's
runtime mode. The report and attached screenshot are sent to the selected AI
provider when the agent reads them. The agent checks for duplicates and newer
fixes and asks follow-up questions when your description is incomplete. For
feature requests it clarifies the proposal and checks existing requests and
functionality, rather than demanding bug reproduction steps. It writes
an issue draft to `issue.md` (one `# Title` heading followed by the issue body),
or `findings.md` when a new issue is not warranted. It writes the complete file
through a temporary file and rename. The app reads that result into the preview;
if you edited the report while it worked, choose **Use agent draft** or **Keep my
edits**. Only **Continue on GitHub** opens the issue form: connected terminal
sessions are instructed to return drafts without posting issues or comments.

Its session can continue after Otter Mail closes. Reopening **Send feedback**
resumes the last investigation and loads its draft. **More report options → Show report files** reveals the
report, diagnostics, and any screenshot in Finder for attachment on GitHub.
**New report** in that menu starts another report without deleting the investigation files.
The agent asks before changing live state or publishing a draft fix PR.
Support folders are kept under the app's state directory
in `support/`; remove them when you no longer need the investigation or checkout.

On the web, or for another agent, choose **Download for another agent** from the
action dropdown, or **More report options → Download for an agent** after review. Open the
Markdown file in a coding agent that can inspect a repository. Supply any
screenshot and downloaded diagnostics separately. Choose **Import agent draft** from either menu
to bring the resulting `issue.md` or `findings.md` back into the app. The same
playbook covers diagnosis, duplicate detection,
issue review, and an optional fix in a separate checkout using the demo mailbox.

The playbook is [.github/triage/PLAYBOOK.md](../.github/triage/PLAYBOOK.md).

## If the app cannot open

Start Claude, Codex, or your usual coding agent yourself and give it the
[support playbook](https://github.com/otterware-app/otter-mail/blob/main/.github/triage/PLAYBOOK.md)
and a description of the problem. Tell it your installed version (Finder's Get
Info for Otter Mail). Automatic diagnostics need a running app; the agent should
ask before inspecting any additional local files. You can also use the
[GitHub bug report form](https://github.com/otterware-app/otter-mail/issues/new?template=bug_report.md).
