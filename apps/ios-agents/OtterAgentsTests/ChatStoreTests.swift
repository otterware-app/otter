import Foundation
import Testing
@testable import Otter_Agents

/** A turn's events, as the store makes a chat of them. The demo's agent stands in for a real one. */
@MainActor
struct ChatStoreTests {
    private func store(followUp: Agents.FollowUp = .queue) -> ChatStore {
        let agents = Agents()
        agents.startDemo()
        // Whatever this simulator's app last chose, a new chat here starts on the Otter agent.
        agents.selected = "openrouter"
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
        #expect(store.chat(chat)!.turns[1].error == "Can't reach OpenRouter. Try again in a moment.")
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
        #expect(store.runs[chat] == ChatStore.Run(requestId: request, provider: "openrouter"))
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
