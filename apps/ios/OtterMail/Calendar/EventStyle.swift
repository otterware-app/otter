import SwiftUI

/**
 * An event's color and standing, as the Mac and web apps decide them
 * (apps/web/src/main/calendar/calendar-view.tsx's listedCalendars and legible,
 * and event-style.ts): the color chosen for that calendar (`calendar:colors`,
 * made on any device), else the mailbox's color for its primary calendar and
 * for one Google gives no color, else Google's.
 */
enum EventStyle {
    /** api.ts's calendarKey, so a color chosen on the Mac is found here (an account's id is its address). */
    nonisolated static func key(mailbox: String, calendar: String) -> String { "\(mailbox)|\(calendar)" }

    nonisolated static func hex(
        for calendar: EventCalendar,
        mailbox: Mailbox?,
        preferences: CalendarPreferences
    ) -> String {
        if let mailbox, let chosen = preferences.colors[key(mailbox: mailbox.email, calendar: calendar.id)] {
            return chosen
        }
        guard !calendar.primary, let color = calendar.color, !color.isEmpty else {
            return mailbox?.color ?? "#8a8a8a"
        }
        return color
    }

    /** The colors a calendar can be given, calendar-sidebar.tsx's CALENDAR_COLORS. */
    nonisolated struct Choice: Hashable, Sendable {
        let name: String
        let hex: String
    }

    nonisolated static let choices = [
        ("Red", "#e5484d"), ("Coral", "#d9776f"), ("Orange", "#f2834d"), ("Yellow", "#f0c24d"),
        ("Lime", "#bddb6e"), ("Grass", "#8fd165"), ("Green", "#6cc78f"), ("Mint", "#94dcc4"),
        ("Blue", "#5ea8e0"), ("Sapphire", "#4f80e8"), ("Indigo", "#8e8cf0"), ("Violet", "#b48ef0"),
        ("Purple", "#9b5cf0"), ("Pink", "#ec8fb5"), ("Blush", "#d4a5ae"), ("Brown", "#b07a62"),
        ("Gray", "#a3a3a3"),
    ].map { Choice(name: $0.0, hex: $0.1) }

    /** A near-black color lifted toward the text, so it reads on a dark canvas. */
    static func legible(_ hex: String, over text: RGB) -> Color {
        let color = RGB(css: hex)
        let luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b
        return luminance < 0.12 ? color.mixed(toward: text, keep: 0.45).color : color.color
    }

    /**
     * How an event is drawn, from the user's own answer, as the Otter mobile
     * calendar decides it (eventPresentation.ts's eventTone). An invitation
     * still open is outlined rather than filled; Otter Mail dashes both open
     * tones (event-style.ts's isPending), so only `solid` is filled.
     */
    nonisolated enum Tone: Hashable {
        case solid, unanswered, tentative, declined
    }

    nonisolated static func tone(of event: CalendarEvent) -> Tone {
        switch event.response {
        case .declined: .declined
        case .needsAction: .unanswered
        case .tentative: .tentative
        default: event.status == .tentative ? .tentative : .solid
        }
    }
}
