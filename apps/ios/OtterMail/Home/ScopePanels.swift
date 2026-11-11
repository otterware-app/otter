import SwiftUI

/**
 * The calendar's ⌃⌄, in the panel the mail's places open in (`ScopePanel`):
 * All calendars, then each mailbox with its calendars under it, as
 * calendar-sidebar.tsx lists them. A mailbox scopes the calendar to its own;
 * a calendar's row shows or hides it, and holding it offers Show only this
 * calendar and its color (calendar-sidebar.tsx's menu).
 */
struct CalendarScopePanel: View {
    @Environment(MailStore.self) private var store
    @Environment(Preferences.self) private var preferences
    @Environment(\.palette) private var palette

    let events: CalendarStore
    let visibility: CalendarShown
    let onDone: () -> Void

    private var sources: [Mailbox] { CalendarStore.sources(store.shownMailboxes) }
    private var calendars: [EventCalendar] { sources.flatMap { events.lists[$0.email] ?? [] } }

    var body: some View {
        ScopePanel {
            HStack(spacing: 10) {
                Image(systemName: "calendar").font(.system(size: 19)).foregroundStyle(palette.text)
                Text("Calendars").font(.inter(.headline)).foregroundStyle(palette.text)
                Spacer(minLength: 0)
            }
        } rows: {
            PlaceRow(title: "All calendars", selected: visibility.account == nil) {
                Image(systemName: "calendar.badge.checkmark").font(.system(size: 17)).foregroundStyle(palette.text)
            } action: {
                visibility.showAll(calendars)
                onDone()
            }
            Divider().overlay(palette.border).padding(.vertical, 6).padding(.horizontal, 4)
            ForEach(CalendarStore.grouped(sources, lists: events.lists), id: \.mailbox.email) { group in
                account(group.mailbox, calendars: group.calendars)
            }
        }
    }

    @ViewBuilder
    private func account(_ mailbox: Mailbox, calendars: [EventCalendar]) -> some View {
        PlaceRow(title: mailbox.displayName, selected: visibility.account == mailbox.email) {
            MailboxAvatar(mailbox: mailbox, size: 24)
        } action: {
            visibility.account = mailbox.email
            onDone()
        }
        .accessibilityHint("Shows only this mailbox's calendars")
        if events.denied.contains(mailbox.email) {
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(palette.warning)
                Text("Sign in again to show this calendar").font(.inter(.subheadline)).lineLimit(2)
                Spacer(minLength: 8)
                SignInAgainButton(mailbox: mailbox)
            }
            .foregroundStyle(palette.text)
            .padding(.leading, 32)
            .padding(.trailing, 12)
            .frame(minHeight: 48)
        } else if calendars.isEmpty, events.state == .loading {
            ProgressView().frame(maxWidth: .infinity, minHeight: 48)
        }
        ForEach(calendars, id: \.key) { calendar in
            row(calendar)
        }
    }

    private func row(_ calendar: EventCalendar) -> some View {
        let shown = visibility.isShown(calendar)
        return PlaceRow(title: calendar.name, indent: 1, checked: shown) {
            Circle().fill(color(calendar)).frame(width: 10, height: 10)
        } action: {
            visibility.setShown(calendar, show: !shown)
        }
        .contextMenu {
            Button("Show only this calendar", systemImage: "eye") {
                visibility.showOnly(calendar, among: calendars)
                onDone()
            }
            colors(calendar)
        }
    }

    /** calendar-sidebar.tsx's Color menu, written to the synced `calendar:colors` as it is there. */
    private func colors(_ calendar: EventCalendar) -> some View {
        let picked = preferences.calendar.colors[calendar.key]
        return Menu("Color", systemImage: "paintpalette") {
            ForEach(EventStyle.choices, id: \.hex) { choice in
                Button {
                    preferences.setCalendarColor(choice.hex, for: calendar.key)
                } label: {
                    Label {
                        Text(choice.name)
                    } icon: {
                        Image(systemName: choice.hex == picked ? "checkmark.circle.fill" : "circle.fill")
                    }
                }
                .tint(Color(hex: choice.hex))
            }
            if picked != nil {
                Divider()
                Button("Its own color", systemImage: "arrow.uturn.backward") {
                    preferences.setCalendarColor(nil, for: calendar.key)
                }
            }
        }
    }

    private func color(_ calendar: EventCalendar) -> Color {
        EventStyle.legible(
            EventStyle.hex(for: calendar, mailbox: store.mailbox(calendar.account), preferences: preferences.calendar),
            over: palette.textRGB
        )
    }
}
