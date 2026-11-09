import SwiftUI

/**
 * One of the calendar's pages, Agenda, Day or Month, drawn from what it's
 * handed rather than from the screen around it. `==` holds only what its own
 * page shows, so a turn settling, the month's pick or another page's window
 * landing leaves the others undrawn (CalendarView applies `.equatable()`).
 */
/** A row to scroll to (an event just saved), once per save: saving the same one again asks again. */
nonisolated struct Reveal: Equatable {
    let id: String
    var at = Date.now
}

struct CalendarPage: View, Equatable {
    @Environment(Preferences.self) private var preferences
    @Environment(\.palette) private var palette

    let mode: CalendarMode
    /** The mailboxes read from (`CalendarStore.sources`), for their colors and names. */
    let mailboxes: [Mailbox]
    /** Those whose sign-in doesn't cover the calendar, while others' events still show. */
    let denied: [Mailbox]
    /** The page's window's events, nil until fetched. */
    let found: [CalendarEvent]?
    let state: CalendarStore.State
    let anchor: Date
    let picked: Date?
    let now: Date
    let shown: [String: Bool]
    /** An event just saved, scrolled to in the agenda: a list keeps its place when a row is put in above it. */
    var reveal: Reveal? = nil
    var onStep: (Int) -> Void = { _ in }
    var onToday: () -> Void = {}
    var onPick: (Date) -> Void = { _ in }
    var onRetry: () -> Void = {}
    var onRefresh: () async -> Void = {}

    static func == (a: Self, b: Self) -> Bool {
        a.mode == b.mode && looks(a.mailboxes) == looks(b.mailboxes) && looks(a.denied) == looks(b.denied)
            && a.found == b.found && a.state == b.state && a.now == b.now && a.shown == b.shown && a.reveal == b.reveal
            // The agenda runs from today whatever the chevrons did; only the month lists a picked day.
            && (a.mode == .agenda || a.anchor == b.anchor)
            && (a.mode != .month || a.picked == b.picked)
    }

    /** What a page draws of a mailbox: not its labels or counts, which change under it. */
    private static func looks(_ mailboxes: [Mailbox]) -> [[String]] {
        mailboxes.map { [$0.email, $0.displayName, $0.color] }
    }

    private var dates: CalendarDates { CalendarDates(preferences: preferences.calendar) }

    var body: some View {
        if mode == .day { dayPage } else { list }
    }

    private var list: some View {
        ScrollViewReader { proxy in
            List {
                if mode == .month { monthGrid }
                switch state {
                case .noAccess: noAccess
                case .failed(let message) where found == nil: failed(message)
                default:
                    ForEach(denied) { signInRow($0) }
                    listed
                }
            }
            .listStyle(.plain)
            .listSectionSeparator(.hidden, edges: .top)
            .scrollContentBackground(.hidden)
            .background(palette.canvas)
            .contentMargins(.bottom, 24, for: .scrollContent)
            .refreshable { await onRefresh() }
            .task(id: reveal) {
                guard mode == .agenda, let reveal else { return }
                // Once the editor has gone back, so the scroll is seen.
                try? await Task.sleep(for: .milliseconds(350))
                withAnimation(.smooth(duration: 0.3)) { proxy.scrollTo(reveal.id, anchor: .center) }
            }
        }
    }

    private func days(_ mode: CalendarMode) -> [Date] {
        dates.visibleDays(mode, anchor, weekends: dates.showsWeekends(mode))
    }

    @ViewBuilder private var listed: some View {
        if found == nil {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.top, mode == .month ? 20 : 60)
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
        } else if mode == .month {
            let day = EventDay(id: pickedDay, events: EventDays.events(shownEvents, on: pickedDay, dates: dates))
            Section {
                ForEach(day.events) { event in row(event, on: day.id) }
                if day.events.isEmpty { note("Nothing on this day") }
            } header: {
                header(day)
            }
            .textCase(nil)
        } else {
            agenda
        }
    }

    /** Today first, always: what's over dimmed, and a word when nothing else is left of it. */
    @ViewBuilder private var agenda: some View {
        let days = EventDays.agenda(shownEvents, from: dates.startOfDay(now), dates: dates)
        let today = days.first.flatMap { dates.sameDay($0.id, now) ? $0 : nil } ?? EventDay(id: dates.startOfDay(now), events: [])
        Section {
            ForEach(today.events) { event in row(event, on: today.id) }
            if !today.events.contains(where: { $0.end > now }) {
                note(today.events.isEmpty ? "Nothing today" : "Nothing else today")
            }
        } header: {
            header(today)
        }
        .textCase(nil)
        ForEach(days.filter { !dates.sameDay($0.id, now) }) { day in
            Section {
                ForEach(day.events) { event in row(event, on: day.id) }
            } header: {
                header(day)
            }
            .textCase(nil)
        }
        if days.allSatisfy({ dates.sameDay($0.id, now) }) {
            note("The months ahead are clear")
        }
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(.inter(.subheadline))
            .foregroundStyle(palette.muted)
            .padding(.leading, 92)
            .padding(.vertical, 8)
            .listRowBackground(palette.canvas)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets())
    }

    private var noAccess: some View {
        ContentUnavailableView {
            Label("Sign in again to show your calendar", systemImage: "calendar.badge.exclamationmark")
        } description: {
            Text("Otter Mail needs permission to read your calendar. \(denied.map(\.displayName).formatted(.list(type: .and))) signed in before it asked.")
        } actions: {
            ForEach(denied) { mailbox in
                SignInAgainButton(mailbox: mailbox, title: denied.count > 1 ? "Sign in \(mailbox.displayName) again" : "Sign in again")
                    .buttonStyle(.glassProminent)
            }
        }
        .foregroundStyle(palette.text)
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
        .padding(.top, 40)
    }

    /** web's AllowCalendarAccess: one mailbox's calendar missing, the rest shown. */
    private func signInRow(_ mailbox: Mailbox) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(palette.warning)
            Text("Sign in again to show \(mailbox.displayName)'s calendar")
                .font(.inter(.subheadline))
                .foregroundStyle(palette.text)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            SignInAgainButton(mailbox: mailbox, title: "Sign in")
                .buttonStyle(.glass)
        }
        .padding(12)
        .background(palette.warning.opacity(0.12), in: .rect(cornerRadius: 14))
        .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
        .listRowSeparator(.hidden)
        .listRowBackground(palette.canvas)
    }

    private func failed(_ message: String) -> some View {
        ContentUnavailableView {
            Label("Couldn't load the calendar", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("Try again", action: onRetry)
                .buttonStyle(.glass)
        }
        .foregroundStyle(palette.text)
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
        .padding(.top, 40)
    }

    /** The day's hours (`DayGrid`) under its title, or why they can't be shown. */
    private var dayPage: some View {
        let day = days(.day).first ?? anchor
        return VStack(spacing: 0) {
            period.padding(EdgeInsets(top: 4, leading: 12, bottom: 8, trailing: 12))
            switch state {
            case .noAccess:
                ScrollView { noAccess }
            case .failed(let message) where found == nil:
                ScrollView { failed(message) }
            default:
                ForEach(denied) { signInRow($0).padding(.horizontal, 16).padding(.vertical, 6) }
                DayGrid(
                    day: day,
                    events: shownEvents,
                    loaded: found != nil,
                    now: now,
                    dates: dates,
                    color: color,
                    onRefresh: onRefresh
                )
                .overlay {
                    if found == nil { ProgressView() }
                }
            }
        }
        .background(palette.canvas)
    }

    private var monthGrid: some View {
        let dates = self.dates
        let days = self.days(.month)
        let columns = dates.showsWeekends(.month) ? 7 : 5
        let grouped = EventDays.byDay(shownEvents, days: days, dates: dates)
        let pickedDay = self.pickedDay
        return VStack(spacing: 8) {
            period
            HStack(spacing: 2) {
                ForEach(days.prefix(columns), id: \.self) { day in
                    Text(dates.weekdayShort(day))
                        .font(.inter(.caption2))
                        .foregroundStyle(palette.muted)
                        .frame(maxWidth: .infinity)
                }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: columns), spacing: 2) {
                ForEach(days, id: \.self) { day in
                    let on = grouped[day] ?? []
                    DayCell(
                        day: day,
                        dots: on.prefix(3).map { color($0.calendar) },
                        count: on.count,
                        inMonth: dates.calendar.isDate(day, equalTo: anchor, toGranularity: .month),
                        selected: dates.sameDay(day, pickedDay),
                        today: dates.sameDay(day, now),
                        action: { onPick(day) }
                    )
                }
            }
        }
        .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 12, trailing: 12))
        .listRowSeparator(.hidden)
        .listRowBackground(palette.canvas)
    }

    private var period: some View {
        HStack(spacing: 0) {
            Text(title)
                .font(.inter(.headline))
                .foregroundStyle(palette.text)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 8)
            Button("Today", action: onToday)
                .font(.inter(.subheadline).weight(.medium))
                .foregroundStyle(palette.text)
                .buttonStyle(.plain)
                .padding(.horizontal, 8)
                .frame(height: 44)
                .contentShape(.rect)
            stepper(-1, symbol: "chevron.left", title: "Previous")
            stepper(1, symbol: "chevron.right", title: "Next")
        }
        .padding(.horizontal, 8)
    }

    private func stepper(_ by: Int, symbol: String, title: String) -> some View {
        Button {
            onStep(by)
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(palette.muted)
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }

    private func header(_ day: EventDay) -> some View {
        HStack(spacing: 6) {
            Text(dates.heading(day.id, now: now)).fontWeight(.medium).foregroundStyle(palette.text)
            Spacer()
            if !day.events.isEmpty { Text("\(day.events.count)").monospacedDigit() }
        }
        .font(.inter(.footnote))
        .foregroundStyle(palette.muted)
        .frame(minHeight: 36)
        .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
    }

    private func row(_ event: CalendarEvent, on day: Date) -> some View {
        NavigationLink(value: event) {
            EventRow(event: event, day: day, dates: dates, color: color(event.calendar))
                .opacity(event.end <= now ? 0.5 : 1)
        }
        .navigationLinkIndicatorVisibility(.hidden)
        .accessibilityIdentifier("event-row")
        .padding(.leading, 20)
        .padding(.trailing, 16)
        .padding(.vertical, 8)
        .listRowBackground(palette.canvas)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets())
        // The agenda lists an event once, so its id finds the row.
        .id(mode == .agenda ? event.id : "\(day.timeIntervalSince1970)/\(event.id)")
    }

    /** The events of the calendars shown (`CalendarShown`) that the account's `calendar:show-declined` allows, as calendar-view.tsx filters them. */
    private var shownEvents: [CalendarEvent] {
        let visible = CalendarShown.visible(found ?? [], shown: shown)
        return preferences.calendar.showDeclined ? visible : visible.filter { $0.response != .declined }
    }

    /** The day the month's grid is listing: the one tapped, else today, else the month's first. */
    private var pickedDay: Date {
        let window = dates.window(.month, anchor: anchor)
        if let picked, picked >= window.from, picked < window.to { return picked }
        let today = dates.startOfDay(now)
        let month = dates.startOfMonth(anchor)
        let chosen = dates.calendar.isDate(today, equalTo: month, toGranularity: .month) ? today : month
        // With weekends hidden the grid has no weekend cell to list, so the next weekday leads.
        return dates.stepDays(chosen, 0, weekends: dates.showsWeekends(.month))
    }

    /** The day itself on one line ("Monday, November 9"), else the month. */
    private var title: String {
        mode == .day ? dates.dayHeading(days(.day).first ?? anchor) : dates.monthTitle(anchor)
    }

    private func color(_ calendar: EventCalendar) -> Color {
        EventStyle.legible(
            EventStyle.hex(for: calendar, mailbox: mailboxes.first { $0.email == calendar.account }, preferences: preferences.calendar),
            over: palette.textRGB
        )
    }
}

/** A day in the month's grid: its number, and a dot for each event. */
struct DayCell: View {
    @Environment(\.palette) private var palette
    let day: Date
    /** A dot in its calendar's color for each of the day's first events. */
    let dots: [Color]
    let count: Int
    /** In the month being shown; the days around it fade. */
    var inMonth = true
    var selected = false
    var today = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Text(day.formatted(.dateTime.day()))
                    .font(.inter(.subheadline).weight(today ? .semibold : .regular))
                    .foregroundStyle(inMonth ? palette.text : palette.muted.opacity(0.6))
                    .monospacedDigit()
                    .frame(width: 30, height: 30)
                    .background(today ? palette.action.opacity(0.18) : .clear, in: .circle)
                HStack(spacing: 2) {
                    ForEach(Array(dots.enumerated()), id: \.offset) { _, dot in
                        Circle().fill(dot).frame(width: 4, height: 4)
                    }
                }
                .frame(height: 4)
                .opacity(inMonth ? 1 : 0.5)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)
            .background(selected ? palette.text.opacity(0.1) : .clear, in: .rect(cornerRadius: 12))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var label: String {
        let date = day.formatted(.dateTime.weekday(.wide).month(.wide).day())
        return count == 0 ? date : "\(date), \(count) \(count == 1 ? "event" : "events")"
    }
}
