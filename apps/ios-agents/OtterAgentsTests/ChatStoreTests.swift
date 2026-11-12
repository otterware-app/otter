import Foundation
import Testing
@testable import Otter_Agents

/** A turn's events, as the store makes a chat of them. The demo's agent stands in for a real one. */
@MainActor
struct ChatStoreTests {
    private func store(followUp: Agents.FollowUp = .queue) -> ChatStore {
        let agents = Agents()
        agents.startDemo()
        agents.selected = "hermes"
        agents.followUp = followUp
        let store = ChatStore(agents: agents)
        store.replace(chats: [])
        return store
    }

    /** A chat with a turn in flight, and that turn's id. */
    private func running(_ store: ChatStore, _ text: String = "Hello there") -> (chat: String, request: String) {
        let chat = store.newChat()
        store.send(text, in: chat)
        return (chat, store.runs[chat]!.requestId)
    }

    @Test func sendingStartsATurnAndNamesTheChat() {
        let store = store()
        let (chat, request) = running(store, "Where do things stand with the budget for the fourth quarter of this year?")
        let made = store.chat(chat)!
        #expect(made.turns.map(\.id) == ["u-\(request)", "a-\(request)"])
        #expect(made.title.hasSuffix("…") && made.title.count == 57)
        #expect(store.working == [chat])
        #expect(store.openRequests[chat] == request)
    }

    @Test func textAndStepsInterleaveAndAResultFindsItsStep() {
        let store = store()
        let (chat, request) = running(store)
        let apply = { store.apply($0, requestId: request, chatId: chat) }
        apply(.delta("Let me "))
        apply(.delta("look."))
        apply(.tool(id: "s1", ChatStep(kind: "search", title: "Searched mail")))
        apply(.tool(id: "s2", ChatStep(kind: "read", title: "Read a thread")))
        apply(.toolResult(id: "s1", "4 threads"))
        apply(.delta("Here it is."))
        var turn = store.chat(chat)!.turns[1]
        #expect(turn.items == [.text(id: nil, "Let me look."), .step(id: "s1", ChatStep(kind: "search", title: "Searched mail"), output: "4 threads"),
                               .step(id: "s2", ChatStep(kind: "read", title: "Read a thread"), output: nil), .text(id: nil, "Here it is.")])
        #expect(turn.answer == "Here it is.")

        apply(.done)
        turn = store.chat(chat)!.turns[1]
        // A step whose result never came isn't running any more.
        #expect(turn.items[2] == .step(id: "s2", ChatStep(kind: "read", title: "Read a thread"), output: ""))
        #expect(turn.finishedAt != nil)
        #expect(store.runs.isEmpty)
        #expect(store.openRequests[chat] == nil)
        #expect(store.unseen == [chat])
    }

    @Test func whatsSaidInACallIsATurnOfItsOwnAndARunStaysInItsReply() {
        let store = store()
        let (chat, request) = running(store)
        let apply = { store.apply($0, requestId: request, chatId: chat) }
        apply(.delta("Working on it."))
        store.hearSpoken("How's it", by: .user, final: false, in: chat)
        store.hearSpoken(" going?", by: .user, final: false, in: chat)
        #expect(store.chat(chat)!.turns.last?.text == "How's it going?")
        store.hearSpoken(" How's it going? ", by: .user, final: true, in: chat)
        store.hearSpoken("Still on it.", by: .assistant, final: true, in: chat)
        #expect(ChatStore.runReplyIds(store.chat(chat)!.turns) == ["a-\(request)"])
        apply(.delta(" Done."))
        apply(.done)
        let turns = store.chat(chat)!.turns
        #expect(turns.map(\.role) == [.user, .assistant, .user, .assistant])
        #expect(turns[1].items == [.text(id: nil, "Working on it. Done.")])
        #expect(turns[1].finishedAt != nil)
        #expect(turns[2].spoken && turns[2].text == "How's it going?" && turns[2].finishedAt != nil)
        #expect(turns[3].spoken && turns[3].items == [.text(id: nil, "Still on it.")])
    }

    @Test func aCallLeavesWhatWasSaidFinishedAndTheAgentsAnswerOnce() {
        let store = store()
        let chat = store.newChat()
        store.hearSpoken("So any", by: .user, final: false, in: chat)
        store.endSpoken(in: chat)
        store.hearSpoken("Next call", by: .user, final: false, in: chat)
        let said = store.chat(chat)!.turns
        #expect(said.map(\.text) == ["So any", "Next call"])
        #expect(said[0].finishedAt != nil)
        store.agentAnswered(run: "consult-1", "It's Thursday.", in: chat)
        store.agentAnswered(run: "consult-1", "It's Thursday.", in: chat)
        let turns = store.chat(chat)!.turns
        #expect(turns.count == 3 && turns[2].id == "a-run:consult-1" && turns[2].answer == "It's Thursday.")
    }

    @Test func whatYouWriteWhileACallsWorkGoesOnWaitsForIt() async {
        let store = store(followUp: .steer)
        let (chat, request) = running(store)
        store.apply(.done, requestId: request, chatId: chat)
        var done: CheckedContinuation<Void, Never>?
        var stopped = false
        store.waitForAgent(in: chat, since: 1_000, finished: { await withCheckedContinuation { done = $0 } }, stop: { stopped = true })
        #expect(store.runs[chat]?.since == 1_000 && store.holdsForCall(chat))
        store.send("Yo", in: chat)
        #expect(store.queued(in: chat).map(\.question) == ["Yo"])
        store.stop(chat)
        #expect(stopped)
        await Task.yield()
        done?.resume()
        for _ in 0..<20 where store.queued(in: chat).count == 1 { await Task.yield() }
        #expect(store.queued(in: chat).isEmpty)
        #expect(store.chat(chat)!.turns.contains { $0.role == .user && $0.text == "Yo" })
    }

    @Test func aRunsRecordKeepsWhatWasSaidMeanwhile() {
        var said = ChatTurn(id: "v-1", role: .user, text: "Still there?")
        said.spoken = true
        let turns = [ChatTurn(id: "u-r", role: .user, text: "Hi"), ChatTurn(id: "a-r", role: .assistant), said]
        let next = ChatStore.withTranscript(turns, requestId: "r", [SessionMessage(role: "assistant", text: "Hello.")])
        #expect(next.map(\.id) == ["u-r", "a-r", "v-1"])
        #expect(next[1].items == [.text(id: nil, "Hello.")])
    }

    @Test func aFinishedTurnInTheChatOnScreenIsSeen() {
        let store = store()
        let (chat, request) = running(store)
        store.watched = chat
        store.apply(.done, requestId: request, chatId: chat)
        #expect(store.unseen.isEmpty)
    }

    @Test func anErrorIsSaidForPeopleAndCanBeRetriedUnlessItIsFinal() {
        let store = store()
        var (chat, request) = running(store)
        store.apply(.error("unreachable"), requestId: request, chatId: chat)
        #expect(store.chat(chat)!.turns[1].error == "Can't reach Hermes. Are you on Tailscale?")
        #expect(store.retries["a-\(request)"]?.question == "Hello there")

        store.retry("a-\(request)")
        #expect(store.chat(chat)!.turns.count == 2)
        request = store.runs[chat]!.requestId
        store.apply(.error("cancelled"), requestId: request, chatId: chat)
        #expect(store.chat(chat)!.turns[1].error == "Stopped.")
        #expect(store.retries.isEmpty)
    }

    @Test func aMessageSentWhileTheAgentWorksWaitsItsTurn() {
        let store = store()
        let (chat, request) = running(store)
        store.send("And then?", in: chat)
        #expect(store.queued(in: chat).map(\.question) == ["And then?"])
        #expect(store.chat(chat)!.turns.count == 2)

        store.apply(.done, requestId: request, chatId: chat)
        // The queue drains once the run ends: the message is a turn of its own.
        #expect(store.queue.isEmpty)
        #expect(store.chat(chat)!.turns.map(\.text) == ["Hello there", "", "And then?", ""])
        #expect(store.runs[chat]?.requestId != request)
    }

    @Test func editingAQueuedMessageHoldsItAndGivesTheDraftBack() {
        let store = store()
        let (chat, request) = running(store)
        store.drafts[chat] = "half a thought"
        store.send("first", in: chat)
        let queued = store.queued(in: chat)[0]
        store.drafts[chat] = "half a thought"
        store.editQueued(queued.id)
        #expect(store.drafts[chat] == "first")
        store.apply(.done, requestId: request, chatId: chat)
        // Held while it's edited: the run's end doesn't send it.
        #expect(store.queued(in: chat).count == 1)

        store.send("first, reworded", in: chat)
        #expect(store.drafts[chat] == "half a thought")
        #expect(store.chat(chat)!.turns.last { $0.role == .user }?.text == "first, reworded")
    }

    @Test func aQueuedMessageKeepsItsMailWhenEdited() {
        let store = store()
        let (chat, _) = running(store)
        store.mail[chat] = [MailContext(account: "me@example.com", threadID: "t1", subject: "Dinner", from: "maya@example.com", messageIDs: ["m1"])]
        store.send("first", in: chat)
        store.editQueued(store.queued(in: chat)[0].id)
        store.send("first, reworded", in: chat)
        let queued = store.queued(in: chat)[0]
        #expect(queued.input.hasPrefix("first, reworded\n\n— context from Otter Mail —"))
        #expect(queued.input.contains("threadId t1"))
        #expect(queued.mail.map(\.subject) == ["Dinner"])
    }

    @Test func aSteerJoinsTheRunAndAWholeReplyStartsAfterIt() async {
        let store = store(followUp: .steer)
        let chat = store.newChat()
        store.setProvider(.hermes, of: chat)
        store.send("Start", in: chat)
        let request = store.runs[chat]!.requestId
        let apply = { store.apply($0, requestId: request, chatId: chat) }
        let step = ChatStep(kind: "tool", title: "Looked")
        apply(.reply(text: "First part.", steps: [("s1", step, "ok")]))
        store.send("Also this", in: chat)
        let turns = store.chat(chat)!.turns
        #expect(turns.count == 4)
        #expect(turns[2].intent == "steer")
        // The reply before the steer goes on until the run ends.
        #expect(turns[1].finishedAt == nil)

        apply(.reply(text: "First part.\n\nSecond part.", steps: [("s1", step, "ok"), ("s2", step, nil)]))
        let after = store.chat(chat)!.turns
        #expect(after[1].items == [.step(id: "s1", step, output: "ok"), .text(id: nil, "First part.")])
        #expect(after[3].items == [.step(id: "s2", step, output: nil), .text(id: nil, "Second part.")])

        apply(.done)
        #expect(store.chat(chat)!.turns.allSatisfy { $0.role == .user || $0.finishedAt != nil })
    }

    @Test func whatTheAgentAsksIsTheChatsUntilTheRunEnds() {
        let store = store()
        let (chat, request) = running(store)
        store.apply(.approval(Approval(id: "ap", kind: "command", detail: "rm -rf build", choices: ["once", "deny"])), requestId: request, chatId: chat)
        store.apply(.question(Question(id: "q", items: [], expires: .distantFuture)), requestId: request, chatId: chat)
        #expect(store.approvals(in: chat).map(\.id) == ["ap"])
        #expect(store.needsYou == [chat])
        store.apply(.approvalResolved("ap"), requestId: request, chatId: chat)
        #expect(store.approvals(in: chat).isEmpty)
        store.apply(.done, requestId: request, chatId: chat)
        #expect(store.questions.isEmpty)
        #expect(store.needsYou.isEmpty)
    }

    @Test func aTurnThatCouldNotBeFollowedIsNotOver() {
        let store = store()
        let (chat, request) = running(store)
        store.apply(.delta("So far"), requestId: request, chatId: chat)
        store.apply(.error(AgentError.detached), requestId: request, chatId: chat)
        let made = store.chat(chat)!
        #expect(made.turns[1].finishedAt == nil && made.turns[1].error == nil)
        #expect(store.runs.isEmpty)
        #expect(store.isDetached(made))
    }

    @Test func aTurnThatHandedOffStaysOpenAndShowsTheReplyItsSubagentsBring() {
        let store = store()
        let (chat, request) = running(store)
        let apply = { store.apply($0, requestId: request, chatId: chat) }
        let spawn = ChatStep(kind: "tool", title: "Started Research pricing")
        apply(.reply(text: "On it.", steps: [("s1", spawn, "accepted")]))
        apply(.waiting(["Research pricing"]))
        #expect(store.runs[chat]?.waitingLabel == "Waiting · Research pricing")
        #expect(store.chat(chat)!.turns[1].finishedAt == nil)
        #expect(store.openRequests[chat] == request)
        #expect(store.unseen.isEmpty)

        apply(.working)
        #expect(store.runs[chat] == ChatStore.Run(requestId: request, provider: "hermes"))
        apply(.reply(text: "On it.\n\nAlfama is the cheapest.", steps: [("s1", spawn, "accepted")]))
        apply(.done)
        let turns = store.chat(chat)!.turns
        #expect(turns.count == 2)
        #expect(turns[1].items == [.step(id: "s1", spawn, output: "accepted"), .text(id: nil, "On it.\n\nAlfama is the cheapest.")])
        #expect(turns[1].finishedAt != nil)
        #expect(store.runs.isEmpty && store.openRequests[chat] == nil)
    }

    @Test func stoppingAWaitingTurnEndsIt() {
        let store = store()
        let (chat, request) = running(store)
        store.apply(.waiting([]), requestId: request, chatId: chat)
        #expect(store.runs[chat]?.waitingLabel == "Waiting")
        store.apply(.error("cancelled"), requestId: request, chatId: chat)
        #expect(store.chat(chat)!.turns[1].error == "Stopped.")
        #expect(store.chat(chat)!.turns[1].finishedAt != nil)
        #expect(store.runs.isEmpty && store.openRequests[chat] == nil)
    }

    @Test func aWaitingTurnTheAppLeftIsPickedUpAgain() {
        let store = store()
        let (chat, request) = running(store)
        store.apply(.waiting([nil]), requestId: request, chatId: chat)
        store.apply(.error(AgentError.detached), requestId: request, chatId: chat)
        let made = store.chat(chat)!
        #expect(made.turns[1].finishedAt == nil && made.turns[1].error == nil)
        #expect(store.isDetached(made))
        #expect(store.openRequests[chat] == request)
    }

    @Test func whatARunWaitsOnIsWordedAsOtterCodeWordsIt() {
        let label = { ChatStore.Run(requestId: "r", provider: "openclaw", waiting: $0).waitingLabel }
        #expect(label(nil) == nil)
        #expect(label([]) == "Waiting")
        #expect(label(["Research pricing"]) == "Waiting · Research pricing")
        #expect(label([nil]) == "Waiting on a subagent")
        #expect(label(["Research pricing", nil]) == "Waiting on 2 subagents")
    }

    @Test func whatTheSessionHoldsReplacesWhatTheChatShowed() {
        var user = ChatTurn(id: "u-r", role: .user, text: "Do it", now: 10)
        user.skill = "plan"
        var reply = ChatTurn(id: "a-r", role: .assistant, now: 10)
        reply.items = [.text(id: nil, "partial")]
        let turns = ChatStore.withTranscript([user, reply], requestId: "r", [
            SessionMessage(role: "assistant", text: "Whole answer", steps: [(nil, ChatStep(title: "Ran tests"), "ok")]),
        ])
        #expect(turns.map(\.id) == ["u-r", "a-r"])
        #expect(turns[0].skill == "plan")
        #expect(turns[1].items == [.text(id: nil, "Whole answer"), .step(id: nil, ChatStep(title: "Ran tests"), output: "ok")])
    }

    @Test func shelvingAndPinningMoveAChatAsOnTheDesktop() async {
        let store = store()
        let (chat, request) = running(store)
        store.apply(.done, requestId: request, chatId: chat)
        await store.pin(chat, true)
        #expect(store.chat(chat)!.pinnedAt != nil)
        await store.shelve(chat, settledAt: .now)
        // Settling a pinned chat unpins it.
        #expect(store.chat(chat)!.pinnedAt == nil && store.chat(chat)!.settledAt != nil)
        let before = store.chat(chat)!.returnedAt
        try? await Task.sleep(for: .milliseconds(5))
        await store.shelve(chat)
        // Bringing it back puts it at the top.
        #expect(store.chat(chat)!.settledAt == nil && (store.chat(chat)!.returnedAt ?? 0) > (before ?? 0))
    }

    @Test func whatTheAgentWroteOnItsOwnIsAddedOnce() {
        func said(_ id: String, _ texts: String...) -> ChatTurn {
            var turn = ChatTurn(id: id, role: .assistant, now: nil)
            turn.items = [.step(id: nil, ChatStep(title: "Looked"), output: "ok")] + texts.map { .text(id: nil, $0) }
            return turn
        }
        let shown = [ChatTurn(id: "u-1", role: .user, text: "Watch the build", now: 1), said("a-1", "On it.")]
        // The session as the gateway keeps it: more history before, the same exchange, then a message the agent sent by itself.
        let session = [ChatTurn(id: "h-0", role: .user, text: "Earlier", now: nil), said("h-1", "Earlier answer"),
                       ChatTurn(id: "h-2", role: .user, text: "Watch the build ", now: nil), said("h-3", "On it.", "The build is green again.")]
        let added = ChatStore.added(to: shown, by: session)
        #expect(added.map(\.items) == [[.text(id: nil, "The build is green again.")]])
        // Read again once it's in the chat: nothing more.
        var caught = shown
        caught.append(said("d-1", "The build is green again."))
        #expect(ChatStore.added(to: caught, by: session).isEmpty)
        // A message written elsewhere since, or a session that words things differently: left alone.
        #expect(ChatStore.added(to: shown, by: session + [ChatTurn(id: "h-4", role: .user, text: "Thanks", now: nil)]).isEmpty)
        #expect(ChatStore.added(to: shown, by: [session[2], said("h-3", "On it!", "The build is green again.")]).isEmpty)
        #expect(ChatStore.added(to: shown, by: [ChatTurn(id: "h-9", role: .user, text: "Another chat", now: nil)]).isEmpty)
        // A chat a scheduled task started: no message of yours in it at all.
        #expect(ChatStore.added(to: [said("a", "Monday's brief")], by: [said("h", "Monday's brief", "Tuesday's brief")]).map(\.items) == [[.text(id: nil, "Tuesday's brief")]])
    }

    @Test func whatIsAskedOutsideARunBelongsToItsChat() async {
        let store = store()
        let (chat, request) = running(store)
        store.apply(.done, requestId: request, chatId: chat)
        #expect(store.approvals(in: chat).isEmpty && store.needsYou.isEmpty)
        // The demo's agents ask nothing on their own: checking leaves the chat as it was.
        await store.checkAsks(chat)
        #expect(store.approvals(in: chat).isEmpty && store.questions(in: chat).isEmpty)
    }

    @Test func quotesGoToTheAgentAsReferenceWithTheirComments() {
        let input = ChatStore.withCitations("Shorten it", [ChatCitation(text: "line one\nline two", comment: " too long ")])
        #expect(input.hasPrefix("Shorten it\n\nThe user quotes your earlier replies"))
        #expect(input.hasSuffix("> line one\n> line two\nComment: too long"))
        #expect(ChatStore.withCitations("Just this", []) == "Just this")
    }
}

struct MailContextTests {
    @Test func aLinkFromOtterMailCarriesThePointers() throws {
        let draft = MailContext(kind: "draft", account: "me@example.com", threadID: "t 1", subject: "Re: Q3 & plans?", from: "me@example.com", messageIDs: ["m1", "m2"])
        var quoted = MailContext(account: "me@example.com", threadID: "t2", subject: "Dinner", from: "maya@example.com", messageIDs: ["m3"])
        quoted.quote = "See you at 7!\n“Bring bread” & wine"
        let link = try #require(MailContext.link([draft, quoted], scheme: "dev.otterware.agents"))
        #expect(link.scheme == "dev.otterware.agents")
        #expect(MailContext.read(link: link) == [draft, quoted])
        #expect(MailContext.link([]) == nil)
        #expect(MailContext.read(link: URL(string: "dev.otterware.agents://new?mail=%7B%7D")!).isEmpty)
        #expect(MailContext.read(link: URL(string: link.absoluteString.replacingOccurrences(of: "://new", with: "://chat"))!).isEmpty)
        #expect(MailContext.scheme(mail: "dev.otterware.mail.dev") == "dev.otterware.agents.dev")
        #expect(MailContext.scheme(mail: "dev.otterware.mail") == "dev.otterware.agents")
        #expect(MailContext.handoff("Why 7?", [quoted]).contains("• Quoted from \"Dinner\" [me@example.com] (threadId t2):\n  “See you at 7!"))
        #expect(ChatContext([quoted])?.kind == "quote")
    }

    @Test func aTurnSaysWhatMailItWasAbout() throws {
        let mail = MailContext(kind: "draft", account: "me@example.com", threadID: "", subject: "Offer", from: "me@example.com", messageIDs: ["m1"])
        #expect(MailContext.handoff("Tighten it", [mail]).contains("• Draft [me@example.com] \"Offer\" — from me@example.com (message m1)"))
        var turn = ChatTurn(id: "u-1", role: .user, text: "Tighten it")
        turn.context = ChatContext([mail])
        let read = try #require(ChatTurn(turn.json))
        #expect(read.context?.subjects == ["Offer"])
        #expect(read.context?.kind == "draft")
    }
}
