import Foundation
import Testing
@testable import Otter_Agents

private func json(_ text: String) -> JSON { try! JSON(parsing: Data(text.utf8)) }

@MainActor
struct ChatTests {
    @Test func aTurnKeepsWhatThisAppDoesNotRead() {
        var chat = Chat(json("""
        {"id":"c1","title":"Plan","provider":"hermes","sessionId":"s1","sessionOwned":true,"lastResponseId":null,"device":null,
         "createdAt":1000,"updatedAt":2000,"pinnedAt":1500,"tabs":[{"id":"page:https://a.example","title":"a","ref":{"kind":"page","url":"https://a.example"},"addedAt":1200,"made":true}],
         "turns":[{"id":"u-1","role":"user","text":"hi","context":{"subjects":["Re: Q4"],"count":1,"kind":"mail","items":[{"title":"Re: Q4","target":{"kind":"thread","id":"t","accountId":"a"}}]},"future":{"x":1}},
                  {"id":"a-1","role":"assistant","text":"","items":[{"kind":"step","id":"s","step":{"kind":"web","title":"Opened","detail":"https://a.example"},"output":"ok"},{"kind":"text","text":"Done"}],
                   "changes":[{"title":"Draft","action":"created","target":{"kind":"draft","id":"d","accountId":"a"}}],"startedAt":1000,"finishedAt":1900}]}
        """))!
        #expect(chat.loaded)
        #expect(chat.turns[0].context?.subjects == ["Re: Q4"])
        #expect(chat.turns[1].changes.first?.kind == "draft")
        #expect(chat.turns[1].answer == "Done")

        chat.turns[1].error = "Stopped."
        let written = chat.json
        #expect(written["turns"]?.array?[0]["future"]?["x"]?.count == 1)
        #expect(written["turns"]?.array?[0]["context"]?["items"]?.array?.count == 1)
        #expect(written["turns"]?.array?[1]["changes"]?.array?.count == 1)
        #expect(written["turns"]?.array?[1]["error"]?.string == "Stopped.")
        #expect(written["pinnedAt"]?.count == 1500)
        #expect(written["tabs"]?.array?.first?["made"]?.bool == true)
    }

    @Test func aChatsEntryComesWithoutItsTurns() {
        let listed = Chat(json(#"{"id":"c","title":"T","provider":"openclaw","sessionId":"agent:scout:otter-mail:1","createdAt":1,"updatedAt":2,"tabs":[]}"#))
        #expect(listed?.loaded == false)
        #expect(listed?.openClawAgent == "scout")
        #expect(Chat(.null) == nil, "a chat gone")
    }

    @Test func aFileLinkNamesItsPathAndLine() throws {
        #expect(try ChatFile.path("file:///home/rowan/notes/plan%20a.md:12") == "/home/rowan/notes/plan a.md")
        #expect(try ChatFile.path("sandbox:/workspace/report.pdf") == "/workspace/report.pdf")
        #expect(try ChatFile.path("docs/readme.md:3-9") == "docs/readme.md")
        #expect(throws: (any Error).self) { try ChatFile.path("file://other-mac/Users/x/a.md") }
        let link = FileLink(chatId: "c", href: "notes/plan.md:12")
        #expect(link.name == "plan.md")
        #expect(link.line == 12)
        #expect(FileLink(chatId: "c", href: "notes/plan.md").line == nil)
        #expect(try ChatFile(name: "a.json", data: Data("{}".utf8), mimeType: "application/json").text == "{}")
        #expect(try ChatFile(name: "a.pdf", data: Data("%PDF".utf8), mimeType: "application/octet-stream").text == nil)
        #expect(try ChatFile(name: "a.md", data: Data("# a".utf8), mimeType: nil).isMarkdown)
    }

    @Test func aLateDeliveryGoesWhereItHappened() {
        var chat = Chat(provider: "varys", now: 0)
        chat.turns = [ChatTurn(id: "u-1", role: .user, text: "a", now: 100), ChatTurn(id: "a-1", role: .assistant, now: 100),
                      ChatTurn(id: "u-2", role: .user, text: "b", now: 300), ChatTurn(id: "a-2", role: .assistant, now: 300)]
        var delivery = ChatTurn(id: "a-d", role: .assistant, now: 200)
        delivery.delivered = .automation(jobId: "j", name: "Brief", schedule: nil)
        chat.turns.append(delivery)
        chat.placeDelivered()
        #expect(chat.turns.map(\.id) == ["u-1", "a-1", "a-d", "u-2", "a-2"])
    }

    @Test func shelvesAreTheDesktops() {
        let day = 86_400_000, now = 100 * day
        func chat(_ id: String, updated: Int, _ change: (inout Chat) -> Void = { _ in }) -> Chat {
            var chat = Chat(provider: "hermes", now: updated)
            chat.id = id
            change(&chat)
            return chat
        }
        let chats = [
            chat("fresh", updated: now - 1000),
            chat("idle", updated: now - 8 * day),
            chat("pinned-idle", updated: now - 30 * day) { $0.pinnedAt = now - 20 * day },
            chat("snoozed", updated: now - 1000) { $0.snoozedUntil = now + 1000 },
            chat("woke", updated: now - 5000) { $0.snoozedUntil = now - 10; $0.returnedAt = now - 5000 },
            chat("settled-asking", updated: now - 1000) { $0.settledAt = now - 500 },
            chat("idle-working", updated: now - 9 * day),
        ]
        let shelves = ChatShelf.shelve(chats, working: ["idle-working"], needsYou: ["settled-asking"], now: now)
        #expect(shelves[.pinned]?.map(\.id) == ["pinned-idle"])
        // The chat whose snooze just ran out is on top; an idle one a turn runs in stays; one the agent asks in comes back.
        #expect(shelves[.active]?.map(\.id) == ["woke", "fresh", "settled-asking", "idle-working"])
        #expect(shelves[.snoozed]?.map(\.id) == ["snoozed"])
        #expect(shelves[.settled]?.map(\.id) == ["idle"])
    }

    @Test func snoozePresetsFollowTheClock() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        // A Friday at 19:30: no evening left, and next week isn't tomorrow.
        let friday = calendar.date(from: DateComponents(year: 2026, month: 11, day: 13, hour: 19, minute: 30))!
        #expect(ChatShelf.snoozePresets(friday, calendar: calendar).map(\.id) == ["hour", "three-hours", "tomorrow", "next-week"])
        // A Sunday morning: next week is tomorrow, said once.
        let sunday = calendar.date(from: DateComponents(year: 2026, month: 11, day: 15, hour: 9))!
        #expect(ChatShelf.snoozePresets(sunday, calendar: calendar).map(\.id) == ["hour", "three-hours", "evening", "tomorrow"])
    }

    @Test func shortTimesAndTitles() {
        #expect(ChatShelf.shortAgo(0, 59_000) == "now")
        #expect(ChatShelf.shortAgo(0, 3 * 3_600_000) == "3h")
        #expect(ChatShelf.shortAgo(0, 15 * 86_400_000) == "2w")
        #expect(ChatShelf.wakesIn(90 * 60_000, 0) == "2h")
        #expect(ChatText.clampTitle("  ") == "New chat")
        #expect(ChatText.clampTitle(String(repeating: "a", count: 60)).count == 57)
        #expect(ChatText.duration(125_000) == "2m 5s")
        #expect(ChatText.stripHandoff("Summarize\n\n— context from Otter Mail —\n• [a] \"x\"") == "Summarize")
        #expect(ChatText.isFileLink("notes/plan.md"))
        #expect(ChatText.isFileLink("~/Desktop/a.png"))
        #expect(!ChatText.isFileLink("https://otterware.app/a.png"))
        #expect(ChatShelf.tabsSummary([ChatTab(ref: .draft(accountId: "a", id: "1"), title: ""), ChatTab(ref: .thread(accountId: "a", id: "2"), title: ""),
                                       ChatTab(ref: .thread(accountId: "a", id: "3"), title: "")]) == "1 draft · 2 emails")
    }
}
