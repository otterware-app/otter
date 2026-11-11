import Foundation

/**
 * The demo's pretend agent: it answers from a script, with the steps, approvals and questions a
 * real one has, so every part of a chat can be tried without an account or an agent.
 */
enum DemoAgent {
    private static var waiting: [String: CheckedContinuation<String, Never>] = [:]

    static func answer(_ id: String, _ answer: String) {
        waiting.removeValue(forKey: id)?.resume(returning: answer)
    }

    private static func asked(_ id: String) async -> String {
        await withTaskCancellationHandler {
            await withCheckedContinuation { waiting[id] = $0 }
        } onCancel: {
            Task { @MainActor in answer(id, "deny") }
        }
    }

    private static func pause(_ ms: Int) async -> Bool {
        (try? await Task.sleep(for: .milliseconds(ms))) != nil
    }

    private static func say(_ text: String, _ emit: AgentRunner.Emit) async -> Bool {
        for word in text.split(separator: " ", omittingEmptySubsequences: false) {
            guard await pause(28) else { return false }
            emit(.delta(word + " "))
        }
        return true
    }

    private static func step(_ id: String, _ step: ChatStep, _ output: String, _ ms: Int, _ emit: AgentRunner.Emit) async -> Bool {
        emit(.tool(id: id, step))
        guard await pause(ms) else { return false }
        emit(.toolResult(id: id, output))
        return true
    }

    /** A file the pretend agent linked. */
    static func file(_ href: String) throws -> ChatFile {
        let name = (((try? ChatFile.path(href)) ?? href) as NSString).lastPathComponent
        return try ChatFile(name: name, data: Data("# \(name)\n\nThis is the demo. A real agent's file opens here, read from where the agent runs.\n".utf8), mimeType: "text/markdown")
    }

    static func run(_ turn: OutgoingTurn, emit: AgentRunner.Emit) async {
        if turn.sessionId == nil { emit(.session("demo-\(turn.requestId.prefix(8))")) }
        let finished = await script(turn, emit)
        emit(finished ? .done : .error("cancelled"))
    }

    private static func script(_ turn: OutgoingTurn, _ emit: AgentRunner.Emit) async -> Bool {
        let input = turn.input.lowercased()
        guard await pause(500) else { return false }
        if input.contains("fail") {
            emit(.error("unreachable"))
            _ = await pause(60_000)
            return false
        }
        if input.contains("ask") || input.contains("plan") {
            guard await say("Before I plan it, two things I can't tell from here.", emit) else { return false }
            let id = "q-\(turn.requestId.prefix(6))"
            emit(.question(Question(id: id, items: [
                .init(id: "when", header: "Timing", question: "When should the offsite happen?",
                      options: [.init(label: "Second week of December", description: "Before the holidays; flights are cheaper"),
                                .init(label: "Mid January", description: "After the release freeze")],
                      multiSelect: false, secret: false),
                .init(id: "who", header: "People", question: "Who's coming?",
                      options: [.init(label: "Engineering"), .init(label: "Design"), .init(label: "Support")],
                      multiSelect: true, secret: false),
            ], expires: .distantFuture)))
            let answer = await asked(id)
            emit(.questionResolved(id))
            guard !Task.isCancelled else { return false }
            return await say("\n\nGot it: \(answer.isEmpty ? "no preference" : answer). I'll draft the plan around that and check the venue's calendar next.", emit)
        }
        guard await step("s1", ChatStep(kind: "search", title: "Searched mail for “\(turn.input.prefix(28))”"),
                         "{\"threads\": 4, \"newest\": \"Re: Q4 planning\", \"from\": \"lena@otterware.app\"}", 900, emit),
              await step("s2", ChatStep(kind: "read", title: "Read Re: Q4 planning", detail: "4 messages"),
                         "Lena: the budget is approved up to €12k.\nMarc: can we move the kickoff to Thursday?", 800, emit)
        else { return false }
        if input.contains("send") || input.contains("run") || input.contains("approve") {
            guard await say("I have what I need. One step needs your say-so first.", emit) else { return false }
            let id = "a-\(turn.requestId.prefix(6))"
            emit(.tool(id: "s3", ChatStep(kind: "command", title: "Ran gog send --to lena@otterware.app")))
            emit(.approval(Approval(id: id, kind: "command", detail: "gog send --to lena@otterware.app --subject \"Kickoff moved to Thursday\"",
                                    reason: "Sends an email from your account.", choices: ["once", "session", "always", "deny"])))
            let decision = await asked(id)
            emit(.approvalResolved(id))
            guard !Task.isCancelled else { return false }
            emit(.toolResult(id: "s3", decision == "deny" ? "(declined)" : "Sent."))
            return await say(decision == "deny" ? "\n\nUnderstood, I left it unsent. The draft is in your Drafts." : "\n\nSent. Lena has the new time, and I added it to the team calendar.", emit)
        }
        guard await step("s3", ChatStep(kind: "web", title: "Opened otterware.app/changelog", detail: "https://otterware.app/mail/changelog"), "200 OK", 700, emit)
        else { return false }
        // Long enough to queue or steer something meanwhile.
        if input.contains("take your time") {
            guard await step("s4", ChatStep(kind: "command", title: "Ran gog search --since yesterday"), "14 threads", 12_000, emit) else { return false }
        }
        return await say("""
        Here's where things stand.

        ## What's decided

        - The **budget** is approved up to €12k
        - Kickoff moves to **Thursday**, as Marc asked

        ## Still open

        | Item | Owner | Due |
        | --- | --- | --- |
        | Venue | Lena | Fri |
        | Agenda | You | Mon |

        If you want, I can draft the note to the team:

        ```sh
        gog draft --to team@otterware.app --subject "Kickoff on Thursday"
        ```

        Say *send it* and I'll ask before it goes out.
        """, emit)
    }
}

enum DemoChats {
    static func all(now: Int = .now) -> [Chat] {
        let minute = 60_000, hour = 60 * minute, day = 24 * hour
        func chat(_ title: String, _ provider: String, ago: Int, _ turns: [ChatTurn], tabs: [ChatTab] = [],
                  _ more: (inout Chat) -> Void = { _ in }) -> Chat {
            var chat = Chat(provider: provider, now: now - ago)
            chat.title = title
            chat.sessionId = "demo-\(abs(title.hashValue) % 100_000)"
            chat.sessionOwned = true
            chat.turns = turns
            chat.tabs = tabs
            more(&chat)
            return chat
        }
        func user(_ id: String, _ text: String, at: Int, _ more: (inout ChatTurn) -> Void = { _ in }) -> ChatTurn {
            var turn = ChatTurn(id: "u-\(id)", role: .user, text: text, now: at)
            more(&turn)
            return turn
        }
        func agent(_ id: String, at: Int, took: Int, _ items: [ChatItem], _ more: (inout ChatTurn) -> Void = { _ in }) -> ChatTurn {
            var turn = ChatTurn(id: "a-\(id)", role: .assistant, now: at)
            turn.items = items
            turn.finishedAt = at + took
            more(&turn)
            return turn
        }
        let step = { (kind: String, title: String, output: String, source: String?) in
            ChatItem.step(id: nil, ChatStep(kind: kind, title: title, source: source), output: output)
        }

        return [
            chat("Plan the Lisbon offsite", "openclaw", ago: 9 * day, [
                user("1", "Plan a three-day offsite in Lisbon for twelve people in January.", at: now - 9 * day),
                agent("1", at: now - 9 * day, took: 95_000, [
                    step("search", "Searched flights LIS, 14–17 Jan", "{\"cheapest\": 148, \"currency\": \"EUR\", \"carrier\": \"TAP\"}", nil),
                    step("web", "Opened booking.com", "200 OK", nil),
                    .text(id: nil, "Three options hold twelve people within budget. **Bairro Alto** is closest to the venue; **Alfama** is quieter and €40 a night cheaper.\n\n1. Bairro Alto, 6 twin rooms, €1,980\n2. Alfama, 12 singles, €2,400\n3. Parque das Nações, 6 twin rooms, €1,740"),
                ]),
            ], tabs: [ChatTab(ref: .page(url: "https://www.booking.com"), title: "booking.com", now: now - 9 * day),
                      ChatTab(ref: .file(href: "offsite-plan.md"), title: "offsite-plan.md", made: true, now: now - 9 * day)]) {
                $0.pinnedAt = now - 8 * day
                $0.sessionId = "agent:main:otter-mail:demo-offsite"
            },
            chat("Reply to Lena about the Q4 budget", "openrouter", ago: 12 * minute, [
                user("2", "What did Lena decide about the Q4 budget, and what do I owe her?", at: now - 14 * minute),
                agent("2", at: now - 14 * minute, took: 48_000, [
                    step("search", "Searched mail for “Q4 budget”", "{\"threads\": 3}", "Otter"),
                    step("read", "Read Re: Q4 planning", "Lena: the budget is approved up to €12k.", "Otter"),
                    .text(id: nil, "Lena approved the budget **up to €12k** on Tuesday. You owe her two things:\n\n- the venue shortlist, by Friday\n- a yes or no on moving the kickoff to Thursday\n\nI drafted a reply with both; it's in your Drafts."),
                ]),
                user("3", "Make it shorter and send it.", at: now - 12 * minute) {
                    $0.citations = [ChatCitation(text: "a yes or no on moving the kickoff to Thursday", comment: "say yes")]
                },
                agent("3", at: now - 12 * minute, took: 21_000, [
                    step("edit", "Updated the draft to Lena", "Saved.", "Otter"),
                    .text(id: nil, "Shortened to three lines and sent. Lena has the shortlist and your yes on Thursday."),
                ]),
            ], tabs: [ChatTab(ref: .thread(accountId: "you@otterware.app", id: "t1"), title: "Re: Q4 planning", now: now - 14 * minute),
                      ChatTab(ref: .draft(accountId: "you@otterware.app", id: "d1"), title: "Re: Q4 planning", made: true, now: now - 13 * minute)]),
            chat("Morning brief", "hermes", ago: 3 * hour, [
                agent("4", at: now - 3 * hour, took: 64_000, [
                    step("tool", "Read today's calendar", "3 events", nil),
                    step("search", "Searched mail since yesterday", "{\"unread\": 14, \"needs_reply\": 3}", nil),
                    .text(id: nil, "Good morning. Three things need you today:\n\n1. **10:00** design review, the deck is attached to the invite\n2. Marc is waiting on the contract redlines\n3. Your flight check-in opens at 16:20\n\nEverything else can wait until tomorrow."),
                ]) { $0.delivered = .automation(jobId: "brief", name: "Morning brief", schedule: "Weekdays at 8:00") },
            ]),
            chat("Why is the nightly build red?", "codex", ago: 26 * hour, [
                user("5", "The nightly build has been red since Monday. Find out why.", at: now - 26 * hour),
                agent("5", at: now - 26 * hour, took: 212_000, [
                    step("command", "Ran gh run list --workflow release.yml --limit 5", "completed  failure  Release  main  2026-11-09", nil),
                    step("read", "Read .github/workflows/release.yml", "", nil),
                    step("edit", "Edited scripts/notarize-mac.ts", "+4 −1", nil),
                    .text(id: nil, "The notarization step times out since Apple's service moved regions. I raised the wait from 10 to 30 minutes in `scripts/notarize-mac.ts` and re-ran the workflow: it's green."),
                ]),
            ]) { $0.device = Chat.Device(id: "mac", name: "Chris's MacBook Pro") },
            chat("Summarize the board deck", "openrouter", ago: 2 * day, [
                user("6", "Summarize this for me in five bullets.", at: now - 2 * day) {
                    $0.attachments = [ChatSentAttachment(name: "Board deck Q3.pdf", isImage: false, size: 2_480_000)]
                },
                agent("6", at: now - 2 * day, took: 37_000, [
                    .text(id: nil, "- Revenue is up 18% quarter over quarter\n- Churn fell to 2.1%, the lowest yet\n- Hiring is two engineers behind plan\n- The Linux app shipped and is 9% of new installs\n- Runway is 22 months at current burn"),
                ]),
            ]),
            chat("Find the invoice from Hetzner", "varys", ago: 5 * hour, [
                user("7", "Find last month's Hetzner invoice and tell me the total.", at: now - 5 * hour),
                agent("7", at: now - 5 * hour, took: 19_000, [
                    step("search", "Searched mail from hetzner.com", "1 match", nil),
                    .text(id: nil, "Invoice R0012345678 from 1 October: **€86.42**, paid by direct debit on the 5th."),
                ]),
            ]) { $0.snoozedUntil = now + 20 * hour },
            chat("Draft the release note", "hermes", ago: 11 * day, [
                user("8", "Draft a short release note for 0.14.", at: now - 11 * day),
                agent("8", at: now - 11 * day, took: 28_000, [.text(id: nil, "**Otter 0.14** brings Outlook folders, faster search and a calmer sidebar.")]),
            ]) { $0.settledAt = now - 10 * day },
            chat("Unsubscribe from the newsletters I never open", "openrouter", ago: 13 * day, [
                user("9", "Unsubscribe me from newsletters I haven't opened in three months.", at: now - 13 * day),
                agent("9", at: now - 13 * day, took: 151_000, [
                    step("search", "Searched mail for list-unsubscribe", "38 senders", "Otter"),
                    .text(id: nil, "Unsubscribed from 23 senders. 15 need a click on their own page; I listed them in a draft."),
                ]),
            ]),
        ]
    }
}
