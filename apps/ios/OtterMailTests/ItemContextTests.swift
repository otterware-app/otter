import Foundation
import Testing
@testable import Otter_Mail

/**
 * What an event or a task gives the agent: readable text, not JSON, with its
 * links and details, a short summary for the composer, and the handoff that
 * carries it beside the conversations the agent fetches itself.
 */
struct ItemContextTests {
    private var dates: CalendarDates {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Berlin")!
        calendar.locale = Locale(identifier: "en_US")
        return CalendarDates(calendar: calendar)
    }

    private let calendar = EventCalendar(id: "primary", name: "Robin", primary: true, account: "robin@otter.example")

    @Test func sendsATasksLinksWithIt() {
        let task = MailTask(
            content: "Reply", notes: "Say yes.",
            email: TaskEmail(mailbox: "robin@otter.example", thread: "t1", subject: "Dinner?"),
            events: [TaskEvent(account: "robin@otter.example", calendarId: "primary", eventId: "e1", title: "Dinner", start: .now)]
        )
        let context = ItemContext.task(task, lists: [], dates: dates)
        #expect(context.kind == .task)
        #expect(context.title == "Reply")
        #expect(context.text.contains("List: Inbox"))
        #expect(context.text.contains("Notes:\nSay yes."))
        #expect(context.text.contains("Linked conversation: \"Dinner?\" [robin@otter.example] (threadId t1)"))
        #expect(context.text.contains("Linked event: \"Dinner\""))
        #expect(context.summary.contains("2 links"))
        #expect(!context.text.contains("{"))
    }

    @Test func readsAnEventAsItsPageDoes() {
        var event = CalendarEvent(
            eventId: "e1", calendar: calendar, title: "Design review",
            start: Date(timeIntervalSince1970: 1_800_000_000), end: Date(timeIntervalSince1970: 1_800_003_600)
        )
        event.location = "Studio"
        event.details = "<p>Bring the <b>proofs</b>.</p>"
        let context = ItemContext.event(event, dates: dates)
        #expect(context.kind == .event)
        #expect(context.summary.last == "Studio")
        #expect(context.text.contains("Where: Studio"))
        #expect(context.text.contains("Description:\nBring the proofs."))
        #expect(context.text.contains("Google Calendar event e1 on calendar primary"))
    }

    @Test func cutsALongDescription() {
        var event = CalendarEvent(eventId: "e1", calendar: calendar, title: "Long", start: .now, end: .now)
        event.details = String(repeating: "a", count: ItemContext.detailLimit * 2)
        #expect(ItemContext.event(event, dates: dates).text.count < ItemContext.detailLimit + 400)
    }

    @Test func handsOffItemsBesideTheConversations() {
        let item = ItemContext(kind: .task, title: "Reply", summary: [], text: "Task: Reply")
        let message = MailContext.handoff("Help", [], items: [item])
        #expect(message.hasPrefix("Help\n"))
        #expect(message.contains("• Task:\nTask: Reply"))
        #expect(!message.contains("Fetch full content"), "nothing to fetch without a conversation")
        #expect(MailContext.handoff("Help", []) == "Help")
    }
}
