import SwiftUI

/**
 * Every mailbox's calendar in one, as the Mac and web apps combine them: the
 * Calendar module beside Mail, in the phone's pages, Agenda, Day and Month,
 * turned by the picker or a sideways swipe that follows the finger. The bar's
 * ⌃⌄ shows, hides and scopes its calendars (`CalendarScopePanel`). It follows
 * the account's Settings › Calendar (`CalendarPreferences`). HomeView holds
 * the navigation stack, so the bar stays on this page and not on an event.
 */
struct CalendarView: View {
    @Environment(MailStore.self) private var store
    @Environment(Session.self) private var session
    @Environment(Preferences.self) private var preferences
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /** Held by HomeView, so the events outlive switching modules. */
    let events: CalendarStore
    let visibility: CalendarShown
    @Binding var path: NavigationPath
    /** A task's event to open over the pages (HomeView's `openTaskTarget`); taken as soon as it's set. */
    @Binding var opening: TaskEvent?
    var onTitle: () -> Void = {}
    var onSettings: () -> Void = {}

    @State private var mode: CalendarMode = .agenda
    /** Where the pager is, under the finger; `mode` is the page it last came to rest on. */
    @State private var page: CalendarMode?
    @State private var anchor = Date.now
    @State private var picked: Date?
    @State private var now = Date.now
    @State private var reveal: Reveal?

    private var dates: CalendarDates { CalendarDates(preferences: preferences.calendar) }

    private var calendars: [EventCalendar] { sources.flatMap { events.lists[$0.email] ?? [] } }

    /** The calendars a new event can go on: the shown ones that take events, as calendar-view.tsx's `visible`. */
    private var writable: [EventCalendar] {
        let shown = visibility.scoped(calendars)
        let open = calendars.filter { $0.writable && CalendarShown.isShown(shown, $0) }
        return open.isEmpty ? calendars.filter(\.writable) : open
    }

    /** A new event on the day in front: the Day page's, the day picked in Month, else today. */
    private var newEvent: EventDraft? {
        guard let calendar = defaultCalendar(of: writable, chosen: preferences.calendar.defaultCalendar) else { return nil }
        let day = switch mode {
        case .day: anchor
        case .month: picked ?? anchor
        default: now
        }
        return EventDraft.new(on: calendar, day: day, now: .now, dates: dates)
    }

    /** The mailbox scoped to, else every calendar unless some are turned off: then how many of them show. */
    private var shownTitle: String {
        if let account = visibility.account, let mailbox = sources.first(where: { $0.email == account }) {
            return mailbox.displayName
        }
        let all = calendars
        let shown = all.count(where: { visibility.isShown($0) })
        return shown == all.count ? "All calendars" : "\(shown) of \(all.count)"
    }
    private var sources: [Mailbox] { CalendarStore.sources(store.shownMailboxes) }
    private var denied: [Mailbox] { sources.filter { events.denied.contains($0.email) } }
    /** Every page's window, so turning one doesn't wait on a fetch. */
    private var windows: [EventWindow] { CalendarMode.phone.map(window) }

    /** The agenda runs from today; Day and Month share the anchor their chevrons move. */
    private func window(_ mode: CalendarMode) -> EventWindow {
        dates.window(mode, anchor: mode == .agenda ? now : anchor)
    }

    var body: some View {
        content
            .background(palette.canvas)
            .navigationTitle("Calendar")
            .toolbarTitleDisplayMode(.inline)
            .toolbar(removing: .title)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: onTitle) {
                        PlaceTitle(title: "Calendar", scope: shownTitle)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Lists the calendars")
                }
                .sharedBackgroundVisibility(.hidden)
                if let newEvent {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("New event", systemImage: "plus") { path.append(newEvent) }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu("More", systemImage: "ellipsis") {
                        if !sources.isEmpty {
                            Button("Go to today", systemImage: "calendar.badge.clock") {
                                anchor = .now
                                picked = nil
                            }
                            Button("Refresh", systemImage: "arrow.clockwise") {
                                Task { await load(force: true) }
                            }
                        }
                        Button("Settings", systemImage: "gearshape", action: onSettings)
                    }
                }
            }
            .navigationDestination(for: CalendarEvent.self) { tapped in
                // The cache's copy, so a change saved since shows.
                let event = events.current(tapped) ?? tapped
                EventView(
                    event: event, dates: dates, color: color(event.calendar),
                    onEdit: event.isEditable ? { path.append(EditedEvent(event: event)) } : nil
                )
            }
            .navigationDestination(for: EditedEvent.self) { edited in
                EventEditor(
                    events: events, draft: EventDraft(editing: edited.event), event: edited.event, calendars: writable,
                    dates: dates, color: color, onSaved: show, onDeleted: { path = NavigationPath() }
                )
            }
            .navigationDestination(for: EventDraft.self) { draft in
                EventEditor(events: events, draft: draft, calendars: writable, dates: dates, color: color, onSaved: show)
            }
            .navigationDestination(for: LinkedEvent.self) { linked in
                EventView(event: linked.event, dates: dates, color: color(linked.event.calendar), notice: linked.notice)
            }
            .onChange(of: opening, initial: true) { _, link in
                guard let link else { return }
                opening = nil
                Task { await open(link) }
            }
    }

    @ViewBuilder private var content: some View {
        if !sources.isEmpty {
            pages
                .task(id: windows) { await load() }
                .onChange(of: sources.map(\.email)) { _, shown in
                    if let account = visibility.account, !shown.contains(account) { visibility.account = nil }
                    Task { await load() }
                }
                // Runs once a turn has come to rest (`settle`), never under the finger.
                .onChange(of: mode) {
                    picked = nil
                    if mode == .agenda, !dates.sameDay(anchor, .now) { anchor = .now }
                    // A page whose prefetch failed asks again once it's turned to.
                    if events.events(in: window(mode)) == nil { Task { await load() } }
                }
                // Signing a mailbox in again (from a page's prompt) is reason to look again.
                .onChange(of: session.busy) { before, current in
                    if before != nil, current == nil { Task { await load(force: true) } }
                }
        } else {
            // The bar offers Calendar only where there is one; this is for the last such mailbox going away.
            ContentUnavailableView(
                "No calendar",
                systemImage: "calendar",
                description: Text("None of your mailboxes has a calendar Otter Mail can read.")
            )
            .foregroundStyle(palette.muted)
        }
    }

    /**
     * Agenda, Day and Month side by side in a paging ScrollView, the pager
     * owning sideways drags and each page's list its own scrolling. The pages
     * stay mounted, so turning one draws what is already there, and `mode`
     * follows `page` only once the scroll has come to rest: nothing the turn
     * sets off runs under the finger.
     */
    private var pages: some View {
        VStack(spacing: 0) {
            ModePicker(page: $page, settled: mode, select: select)
            ScrollView(.horizontal) {
                HStack(spacing: 0) {
                    ForEach(CalendarMode.phone) { option in
                        calendarPage(option)
                            .equatable()
                            // The pages beside the one in front stay mounted: out of VoiceOver's (and UI tests') reach.
                            .accessibilityElement(children: .contain)
                            .accessibilityIdentifier("calendar-page-\(option.rawValue)")
                            .accessibilityHidden(option != mode)
                            // Not `.vertical`: measured against the pager, which is sized by its pages, a safe-area
                            // change mid-transition (a keyboard going down) left the pages taller than the screen.
                            .containerRelativeFrame(.horizontal)
                            .frame(maxHeight: .infinity)
                            .id(option)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollIndicators(.hidden)
            .scrollPosition(id: $page)
            .onScrollPhaseChange { _, phase in
                if phase == .idle { settle() }
            }
            .onAppear { page = mode }
            .background(palette.canvas)
        }
    }

    private func calendarPage(_ mode: CalendarMode) -> CalendarPage {
        CalendarPage(
            mode: mode,
            mailboxes: sources,
            denied: denied,
            found: events.events(in: window(mode)),
            state: events.state,
            anchor: anchor,
            picked: picked,
            now: now,
            shown: visibility.scoped(calendars),
            reveal: mode == .agenda ? reveal : nil,
            onStep: { by in
                anchor = dates.step(mode, anchor, by: by)
                picked = nil
            },
            onToday: {
                anchor = .now
                picked = nil
            },
            onPick: { picked = $0 },
            onRetry: { Task { await load(force: true) } },
            onRefresh: { await load(force: true) }
        )
    }

    /**
     * A task's event: the one the calendar has, else what the task kept of it,
     * read-only and saying why. The task and its link stay as they are either way.
     */
    private func open(_ link: TaskEvent) async {
        let reach = await events.resolve(link, sources: sources, demo: store.isDemo, google: session.google, dates: dates)
        let kept = { (notice: String) in
            LinkedEvent(event: link.snapshot(calendar: calendars.first { $0.id == link.calendarId && $0.account.lowercased() == link.account }), notice: notice)
        }
        path = NavigationPath()
        switch reach {
        case .found(let event):
            path.append(event)
        case .gone:
            path.append(kept("This event is no longer in the calendar. The task keeps its link and what the event said."))
        case .unavailable:
            path.append(kept("This calendar can't be reached right now. This is what the task kept of the event."))
        }
    }

    /** An event saved lands where it can be seen: its day in Day and Month, its row scrolled to in the agenda. */
    private func show(_ saved: CalendarEvent) {
        if mode == .agenda {
            reveal = Reveal(id: saved.id)
        } else {
            anchor = saved.start
            picked = mode == .month ? dates.startOfDay(saved.start) : nil
        }
        Task { await load() }
    }

    /** The picker scrolls the pager, animating only the scroll; `mode` follows once it lands. */
    private func select(_ option: CalendarMode) {
        guard option != page else { return }
        if reduceMotion {
            page = option
            settle()
        } else {
            withAnimation(.smooth(duration: 0.3)) { page = option } completion: { settle() }
        }
    }

    private func settle() {
        if let landed = mode.settling(on: page) { mode = landed }
    }

    private func color(_ calendar: EventCalendar) -> Color {
        EventStyle.legible(
            EventStyle.hex(for: calendar, mailbox: store.mailbox(calendar.account), preferences: preferences.calendar),
            over: palette.textRGB
        )
    }

    /** The page in front first, then the others and Day's and Month's either side, ahead of a turn. */
    private func load(force: Bool = false) async {
        let sources = self.sources
        guard !sources.isEmpty else { return }
        // To the minute, so a load doesn't redraw every page for a clock that hasn't moved.
        if !dates.calendar.isDate(now, equalTo: .now, toGranularity: .minute) { now = .now }
        let front = CalendarMode.phone.contains(mode) ? mode : .agenda
        await events.load(
            window(front), sources: sources, demo: store.isDemo, google: session.google, dates: dates, force: force
        )
        guard !Task.isCancelled else { return }
        let others = CalendarMode.phone.filter { $0 != front }.map(window)
        let neighbours = [CalendarMode.day, .month].flatMap { mode -> [EventWindow] in
            [-1, 1].map { dates.window(mode, anchor: dates.step(mode, anchor, by: $0)) }
        }
        await events.prefetch(others + neighbours, sources: sources, demo: store.isDemo, google: session.google, dates: dates)
    }
}

/** A task's event the calendar couldn't find, as the task kept it, with why. */
struct LinkedEvent: Hashable {
    let event: CalendarEvent
    let notice: String
}

/** One of yours, opened to be changed from its page's Edit. */
struct EditedEvent: Hashable {
    let event: CalendarEvent
}

/** Agenda, Day, Month: the pager's own position lit, so it follows the finger without redrawing the screen. */
private struct ModePicker: View {
    @Environment(\.palette) private var palette
    @Binding var page: CalendarMode?
    let settled: CalendarMode
    let select: (CalendarMode) -> Void

    var body: some View {
        let current = page ?? settled
        HStack(spacing: 4) {
            ForEach(CalendarMode.phone) { option in
                Button {
                    select(option)
                } label: {
                    Text(option.title)
                        .font(.inter(.subheadline).weight(.medium))
                        .foregroundStyle(current == option ? palette.text : palette.muted)
                        .padding(.horizontal, 14)
                        .frame(height: 36)
                        .background(current == option ? palette.text.opacity(0.08) : .clear, in: .capsule)
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(current == option ? .isSelected : [])
            }
            Spacer()
        }
        .padding(EdgeInsets(top: 4, leading: 16, bottom: 8, trailing: 16))
    }
}
