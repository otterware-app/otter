import Foundation
import Testing
@testable import Otter_Mail

struct MessageListTests {
    @Test func appearancePreferencesRoundTripWithoutEchoingRemoteChanges() throws {
        let name = "MessageListTests.\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let preferences = Preferences(defaults: defaults)
        #expect(preferences.groupMessagesByDay)
        #expect(!preferences.fullWidthMessages)
        var changed: [String] = []
        preferences.onChange = { changed.append($0) }
        let remote = [
            "otter:group-messages-by-day": "false",
            "otter:full-width-messages": "true",
        ]
        preferences.apply(ui: remote, settings: [:])
        #expect(changed.isEmpty)
        let restored = Preferences(defaults: defaults)
        #expect(!restored.groupMessagesByDay)
        #expect(restored.fullWidthMessages)
        for (key, value) in remote { #expect(restored.uiSection[key] == value) }
        preferences.groupMessagesByDay = true
        #expect(changed == ["ui"])
        #expect(preferences.uiSection["otter:group-messages-by-day"] == "true")
        preferences.apply(ui: ["otter:group-messages-by-day": "invalid"], settings: [:])
        #expect(preferences.groupMessagesByDay)
    }

    /** One list style and unread always shaded, as on the Mac and the web: the old keys are gone. */
    @Test func noLongerSyncsListStyleOrDimRead() throws {
        let name = "MessageListTests.\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let preferences = Preferences(defaults: defaults)
        preferences.apply(ui: ["otter:message-list-style": "dividers", "otter:dim-read-messages": "false"], settings: [:])
        #expect(preferences.uiSection["otter:message-list-style"] == nil)
        #expect(preferences.uiSection["otter:dim-read-messages"] == nil)
    }

    @Test func groupsByLocalDayAcrossDaylightSavingTime() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "America/New_York"))
        let formatter = ISO8601DateFormatter()
        func thread(_ id: String, _ date: String, unread: Bool = false) throws -> MailThread {
            let message = Message(id: id, from: Person(name: "Sender", email: "a@example.com"),
                                  to: [], cc: [], date: try #require(formatter.date(from: date)),
                                  text: "", html: nil, attachments: [], unread: unread,
                                  starred: false, draft: false, headers: [:])
            return MailThread(id: id, mailbox: "me@example.com", subject: id, labels: [], messages: [message])
        }
        let groups = ThreadDay.group(try [
            thread("older", "2026-03-08T04:30:00Z"),
            thread("after", "2026-03-08T07:30:00Z", unread: true),
            thread("before", "2026-03-08T06:30:00Z"),
        ], calendar: calendar)
        #expect(groups.count == 2)
        #expect(groups[0].threads.map(\.id) == ["after", "before"])
        #expect(groups[0].unread == 1)
        #expect(groups[1].threads.map(\.id) == ["older"])
        #expect(ThreadDay.group([], calendar: calendar).isEmpty)
    }
}
