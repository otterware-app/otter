import Foundation
import Observation

/**
 * What the calendar screen renders from: every calendar of every mailbox that
 * has one, merged as the Mac and web apps merge them (calendar-view.tsx's
 * calendarAccounts and useCalendarLists), and their events kept per window as
 * React Query keeps them (`useCalendarEvents`): a window shown before is shown
 * again at once, and asked of Google again in the background once it's older
 * than `freshFor`. HomeView holds it, so it outlives switching to Mail and
 * back. Google Calendar for a Gmail mailbox, the pretend one in the demo. A
 * mailbox signed in from before the app asked for calendar access is `denied`,
 * and the others still load; only when every one is does the screen end in
 * `noAccess`, where it offers signing in again (core's NoCalendarAccess).
 */
@Observable
final class CalendarStore {
    enum State: Equatable {
        case loading, ready, noAccess
        case failed(String)
    }

    /** `staleTime` in apps/web/src/main/calendar/api.ts. */
    static let freshFor: TimeInterval = 30

    static func isFresh(_ loadedAt: Date?, now: Date = .now) -> Bool {
        guard let loadedAt else { return false }
        return now.timeIntervalSince(loadedAt) < freshFor
    }

    private(set) var state: State = .ready
    /** Each mailbox's calendars, by its address. */
    private(set) var lists: [String: [EventCalendar]] = [:]
    /** The mailboxes whose sign-in doesn't cover the calendar, by address. */
    private(set) var denied: Set<String> = []
    /** Observed, so every page the screen keeps up draws its own window as soon as it lands. */
    private var cache: [EventWindow: [CalendarEvent]] = [:]
    /** Each window's events by mailbox, so one mailbox failing a refresh keeps what it had. */
    @ObservationIgnored private var parts: [EventWindow: [String: [CalendarEvent]]] = [:]
    @ObservationIgnored private var loadedAt: [EventWindow: Date] = [:]
    @ObservationIgnored private var accounts: [String] = []
    /** Mailboxes whose calendar list is asked for again on their next fetch. */
    @ObservationIgnored private var stale: Set<String> = []
    @ObservationIgnored private var generation = 0
    /** The demo's events made, changed and deleted, as its pretend events are made again on every load. */
    @ObservationIgnored private var demoEdits = DemoEdits()
    /** The demo's answers, for the same reason. */
    @ObservationIgnored private var demoAnswers: [String: CalendarEvent.Response] = [:]
    /** Task links Google answered for with nothing, or whose event was deleted here, by `TaskEvent.key`; kept across restarts. */
    private var gone: Set<String> {
        didSet { if gone != oldValue { goneDefaults.set(gone.sorted(), forKey: Self.goneKey) } }
    }
    @ObservationIgnored private let goneDefaults: UserDefaults
    private static let goneKey = "calendar.goneLinks"

    init(defaults: UserDefaults = .standard) {
        goneDefaults = defaults
        gone = Set(defaults.stringArray(forKey: Self.goneKey) ?? [])
    }


    /** The mailboxes the calendar is read from: calendar-view.tsx's calendarAccounts. */
    nonisolated static func sources(_ mailboxes: [Mailbox]) -> [Mailbox] {
        mailboxes.filter { $0.capabilities.calendar && !$0.signedOut }
    }

    /** Every mailbox's part of a window as one list, the calendar's order. */
    nonisolated static func merged(_ parts: [String: [CalendarEvent]], accounts: [String]) -> [CalendarEvent] {
        EventDays.sorted(accounts.flatMap { parts[$0] ?? [] })
    }

    /** The calendar list's sections, a mailbox each, in the mailboxes' order: calendar-sidebar.tsx's groups. */
    nonisolated static func grouped(
        _ sources: [Mailbox], lists: [String: [EventCalendar]]
    ) -> [(mailbox: Mailbox, calendars: [EventCalendar])] {
        sources.map { ($0, lists[$0.email] ?? []) }
    }

    /**
     * The invitations waiting on an answer, soonest first: on a shown calendar,
     * not cancelled or over, one per series (its next occurrence), and an event
     * on two of a mailbox's calendars once, its primary one's.
     */
    nonisolated static func invites(_ events: [CalendarEvent], shown: [String: Bool], now: Date = .now) -> [CalendarEvent] {
        var seen: Set<String> = []
        return CalendarShown.visible(events, shown: shown)
            .filter { $0.response == .needsAction && $0.status != .cancelled && $0.end > now }
            .sorted { ($0.start, $0.calendar.primary ? 0 : 1) < ($1.start, $1.calendar.primary ? 0 : 1) }
            .filter { seen.insert(answerKey($0)).inserted }
    }

    /** What an answer is given to: the series for an occurrence of one (core's `allEvents`), else the event. */
    nonisolated static func answerKey(_ event: CalendarEvent) -> String {
        "\(event.calendar.account.lowercased())/\(event.seriesId ?? event.eventId)"
    }

    /** Answers an invitation, and every window's copy of it (each occurrence, for a series) says so at once. */
    func respond(_ response: CalendarEvent.Response, to event: CalendarEvent, demo: Bool, google: GoogleAuth) async throws {
        let account = event.calendar.account
        let key = Self.answerKey(event)
        if demo {
            demoAnswers[key] = response
        } else {
            let api = GoogleCalendarAPI(email: account) { [google] refresh in
                try await google.accessToken(account, force: refresh)
            }
            try await api.respond(response, to: event.seriesId ?? event.eventId, on: event.calendar.id)
        }
        for (window, byAccount) in parts {
            guard let mine = byAccount[account] else { continue }
            parts[window]?[account] = mine.map { Self.answerKey($0) == key ? Self.answered($0, response) : $0 }
            cache[window] = Self.merged(parts[window] ?? [:], accounts: accounts)
        }
    }

    /** Where an event's changes go: the demo's stand-in, or the mailbox's Google Calendar. */
    func writer(for account: String, demo: Bool, google: GoogleAuth) -> EventWriter {
        if demo { return DemoEventWriter() }
        return GoogleCalendarAPI(email: account) { [google] refresh in
            try await google.accessToken(account, force: refresh)
        }
    }

    /**
     * api.ts's create: made on the calendar picked, then in every window it falls
     * in at once; the windows are fetched again on their next load. Guests are
     * told only when there are some (none are added here).
     */
    @discardableResult
    func create(_ draft: EventDraft, with writer: EventWriter, demo: Bool = false, dates: CalendarDates = CalendarDates()) async throws -> CalendarEvent {
        if let problem = draft.problem { throw EventProblem(message: problem) }
        let made = try await writer.create(draft.input(dates: dates), on: draft.calendar, notify: false)
        if demo { demoEdits.made.append(made) }
        let account = made.calendar.account
        for (window, byAccount) in parts where made.end > window.from && made.start < window.to {
            parts[window]?[account] = (byAccount[account] ?? []) + [made]
        }
        settle()
        return made
    }

    /** api.ts's update: only what changed, and the guests told when there are any. */
    @discardableResult
    func update(
        _ event: CalendarEvent, to draft: EventDraft, with writer: EventWriter, demo: Bool = false, dates: CalendarDates = CalendarDates()
    ) async throws -> CalendarEvent {
        if let problem = draft.problem { throw EventProblem(message: problem) }
        let patch = draft.patch(from: EventDraft(editing: event), dates: dates)
        guard !patch.isEmpty else { return event }
        let saved = try await writer.update(event, with: patch, notify: event.hasGuests)
        if demo { demoEdits.changed[event.id] = saved }
        replace(event, with: saved)
        return saved
    }

    /** api.ts's remove: guests told when it's yours and has some. */
    func delete(_ event: CalendarEvent, with writer: EventWriter, demo: Bool = false) async throws {
        try await writer.delete(event, notify: event.hasGuests && event.isMine)
        if demo { demoEdits.deleted.insert(event.id) }
        gone.insert(TaskEvent(event, scope: .occurrence).key)
        replace(event, with: nil)
    }

    /** An event's copy in every window, changed or gone, as api.ts's replace patches the cache. */
    private func replace(_ event: CalendarEvent, with next: CalendarEvent?) {
        let account = event.calendar.account
        for (window, byAccount) in parts {
            guard let mine = byAccount[account], mine.contains(where: { $0.id == event.id }) else { continue }
            var kept = mine.filter { $0.id != event.id }
            if let next, next.end > window.from, next.start < window.to { kept.append(next) }
            parts[window]?[account] = kept
        }
        settle()
    }

    /** api.ts's settle: what the cache shows now, and every window asked again on its next load. */
    private func settle() {
        for (window, byAccount) in parts {
            let merged = Self.merged(byAccount, accounts: accounts)
            if cache[window] != merged { cache[window] = merged }
        }
        loadedAt.removeAll()
    }

    nonisolated static func answered(_ event: CalendarEvent, _ response: CalendarEvent.Response) -> CalendarEvent {
        var event = event
        event.response = response
        let me = event.calendar.account.lowercased()
        event.attendees = event.attendees.map { who in
            var who = who
            if who.person.email.lowercased() == me { who.response = response }
            return who
        }
        return event
    }

    func load(
        _ window: EventWindow,
        sources: [Mailbox],
        demo: Bool,
        google: GoogleAuth,
        dates: CalendarDates = CalendarDates(),
        force: Bool = false
    ) async {
        adopt(sources.map(\.email))
        if force {
            loadedAt.removeAll()
            stale = Set(accounts)
            if !denied.isEmpty { denied.removeAll() }
        }
        // Every load, a cached one included, leaves the one before it to be dropped when it lands.
        generation += 1
        let mine = generation
        let kept = cache[window]
        if kept != nil {
            if state != .ready { state = .ready }
            if Self.isFresh(loadedAt[window]) { return }
        } else if !sources.isEmpty, denied.count < sources.count {
            state = .loading
        }
        let asked = sources.filter { !denied.contains($0.email) }
        let results = await fetch(window, from: asked, demo: demo, google: google, dates: dates)
        var failures: [Error] = []
        for (account, result) in results {
            guard case .failure(let error) = result else { continue }
            switch error {
            case is GoogleCalendarAPI.NoAccess, GoogleAuth.Failure.signedOut:
                denied.insert(account)
            case is CancellationError:
                break
            case let stopped as URLError where stopped.code == .cancelled:
                break
            default:
                failures.append(error)
            }
        }
        let reached = absorb(results, for: window)
        guard mine == generation else { return }
        // A refresh that fails leaves the events already up, as React Query keeps its data.
        if kept == nil { for error in failures { ErrorReports.capture(error, scope: "calendar") } }
        if reached || kept != nil {
            if state != .ready { state = .ready }
        } else if !sources.isEmpty, denied.count == sources.count {
            state = .noAccess
        } else if let first = failures.first {
            state = .failed(first.localizedDescription)
        } else {
            state = .ready
        }
    }

    /** The windows either side, fetched ahead as `useCalendarEvents` prefetches them; failures wait for the real load. */
    func prefetch(_ windows: [EventWindow], sources: [Mailbox], demo: Bool, google: GoogleAuth, dates: CalendarDates) async {
        guard sources.map(\.email) == accounts, !lists.isEmpty || demo else { return }
        let asked = sources.filter { !denied.contains($0.email) && lists[$0.email] != nil }
        guard !asked.isEmpty else { return }
        for window in windows where !Self.isFresh(loadedAt[window]) {
            let results = await fetch(window, from: asked, demo: demo, google: google, dates: dates)
            guard sources.map(\.email) == accounts else { return }
            absorb(results, for: window)
        }
    }

    /** Every mailbox at once; each answers for itself, so one refused leaves the others' events. */
    private func fetch(
        _ window: EventWindow, from sources: [Mailbox], demo: Bool, google: GoogleAuth, dates: CalendarDates
    ) async -> [(String, Result<[CalendarEvent], Error>)] {
        let demoAccount = demo ? sources.first?.email : nil
        return await withTaskGroup(of: (String, Result<[CalendarEvent], Error>).self) { group in
            for source in sources {
                group.addTask {
                    await self.result(window, from: source, demoAccount: demoAccount, demo: demo, google: google, dates: dates)
                }
            }
            var results: [(String, Result<[CalendarEvent], Error>)] = []
            for await result in group { results.append(result) }
            return results
        }
    }

    private func result(
        _ window: EventWindow, from source: Mailbox, demoAccount: String?, demo: Bool, google: GoogleAuth, dates: CalendarDates
    ) async -> (String, Result<[CalendarEvent], Error>) {
        do {
            let found = demo
                ? demoEvents(window, account: source.email, first: source.email == demoAccount, dates: dates)
                : try await fetch(window, from: source, google: google)
            return (source.email, .success(found))
        } catch {
            return (source.email, .failure(error))
        }
    }

    /** The demo's pretend calendars: Robin's under its first mailbox, Acme's under the others. */
    private func demoEvents(_ window: EventWindow, account: String, first: Bool, dates: CalendarDates) -> [CalendarEvent] {
        let calendars = (first ? DemoCalendar.calendars : DemoCalendar.acmeCalendars).map { $0.of(account) }
        if lists[account] != calendars { lists[account] = calendars }
        let pretend = (first ? DemoCalendar.events(in: window, dates: dates) : DemoCalendar.acmeEvents(in: window, dates: dates))
            .map { event in
                var event = event
                event.calendar = event.calendar.of(account)
                return demoAnswers[Self.answerKey(event)].map { Self.answered(event, $0) } ?? event
            }
        return demoEdits.applied(to: pretend, in: window, account: account)
    }

    private func fetch(_ window: EventWindow, from mailbox: Mailbox, google: GoogleAuth) async throws -> [CalendarEvent] {
        let account = mailbox.email
        let api = GoogleCalendarAPI(email: account) { [google] refresh in
            try await google.accessToken(account, force: refresh)
        }
        let known: [EventCalendar]
        if !stale.contains(account), let listed = lists[account] {
            known = listed
        } else {
            known = try await api.calendars()
        }
        guard accounts.contains(account) else { throw CancellationError() }
        stale.remove(account)
        if lists[account] != known { lists[account] = known }
        // Every calendar, the ones Google hides included: the screen filters by `CalendarShown`, so turning one on needs no fetch.
        var found: [CalendarEvent] = []
        try await withThrowingTaskGroup(of: [CalendarEvent].self) { group in
            for calendar in known {
                group.addTask { try await api.events(on: calendar, in: window) }
            }
            for try await part in group { found += part }
        }
        return found
    }

    /** A different set of mailboxes keeps what the ones still there had and asks again for all of them. */
    private func adopt(_ next: [String]) {
        guard next != accounts else { return }
        let gone = Set(accounts).subtracting(next)
        accounts = next
        loadedAt.removeAll()
        guard !gone.isEmpty else { return }
        lists = lists.filter { !gone.contains($0.key) }
        denied.subtract(gone)
        for (window, byAccount) in parts {
            let left = byAccount.filter { !gone.contains($0.key) }
            parts[window] = left
            cache[window] = Self.merged(left, accounts: next)
        }
    }

    /**
     * What each mailbox found, in its place in the window; a mailbox that failed keeps its part.
     * A refresh that finds what's already there writes nothing, so the pages it would redraw
     * (mid-swipe, perhaps) stay as they are. True when any mailbox answered.
     */
    @discardableResult
    private func absorb(_ results: [(String, Result<[CalendarEvent], Error>)], for window: EventWindow) -> Bool {
        var byAccount = parts[window] ?? [:]
        var reached = false
        var complete = true
        for (account, result) in results where accounts.contains(account) {
            switch result {
            case .success(let found):
                byAccount[account] = found
                reached = true
            case .failure:
                complete = false
            }
        }
        guard reached else { return false }
        parts[window] = byAccount
        let merged = Self.merged(byAccount, accounts: accounts)
        if cache[window] != merged { cache[window] = merged }
        if complete { loadedAt[window] = .now }
        return true
    }

    /** A window's events, nil until they have been fetched. */
    func events(in window: EventWindow) -> [CalendarEvent]? { cache[window] }

    /** An event as the cache has it now, after a change saved since it was opened. */
    func current(_ event: CalendarEvent) -> CalendarEvent? {
        for events in cache.values {
            if let found = events.first(where: { $0.id == event.id }) { return found }
        }
        return nil
    }

    /** What a task's link reaches: the event, gone from the calendar, or out of reach (signed out, offline). */
    enum Reach: Equatable {
        case found(CalendarEvent)
        case gone
        case unavailable
    }

    /** The event a task's link reaches among those loaded: the occurrence, or the series' next one. */
    func find(_ link: TaskEvent, now: Date = .now) -> CalendarEvent? {
        Self.nearest(cache.values.flatMap { $0.filter(link.matches) }, now: now)
    }

    /**
     * Whether a task's link is known to be gone, by its event's id: deleted here, or Google said so
     * when it was opened. Missing from the day it was on proves nothing: it may have moved.
     */
    func isGone(_ link: TaskEvent, now: Date = .now) -> Bool {
        find(link, now: now) == nil && gone.contains(link.key)
    }

    /** The first not over yet, else the last there was. */
    nonisolated static func nearest(_ events: [CalendarEvent], now: Date) -> CalendarEvent? {
        events.filter { $0.end > now }.min { $0.start < $1.start } ?? events.max { $0.start < $1.start }
    }

    /**
     * A task's link outside the windows loaded, asked of Google by the
     * occurrence's id (the demo makes its events again around the link's day).
     * A series whose linked occurrence is gone is found by the series' own id,
     * and shown read-only: changing it there would change every occurrence.
     * Nothing is written, and the task keeps its link whatever the answer.
     */
    func resolve(_ link: TaskEvent, sources: [Mailbox], demo: Bool, google: GoogleAuth, dates: CalendarDates) async -> Reach {
        let reach = await reach(link, sources: sources, demo: demo, google: google, dates: dates)
        switch reach {
        case .found: gone.remove(link.key)
        case .gone: gone.insert(link.key)
        case .unavailable: break
        }
        return reach
    }

    private func reach(_ link: TaskEvent, sources: [Mailbox], demo: Bool, google: GoogleAuth, dates: CalendarDates) async -> Reach {
        if let found = find(link) { return .found(found) }
        guard link.provider == "google", let mailbox = sources.first(where: { $0.email.lowercased() == link.account }) else {
            return .unavailable
        }
        let calendar = lists[mailbox.email]?.first { $0.id == link.calendarId }
            ?? EventCalendar(id: link.calendarId, name: link.calendarId, account: mailbox.email)
        if demo {
            let day = dates.startOfDay(link.originalStart ?? link.start)
            let around = EventWindow(from: dates.addDays(day, -1), to: dates.addDays(day, 2))
            let found = demoEvents(around, account: mailbox.email, first: sources.first?.email == mailbox.email, dates: dates)
            return Self.nearest(found.filter(link.matches), now: .now).map(Reach.found) ?? .gone
        }
        let api = GoogleCalendarAPI(email: mailbox.email) { [google] refresh in
            try await google.accessToken(mailbox.email, force: refresh)
        }
        do {
            if let occurrence = try await api.event(link.eventId, on: calendar) { return .found(occurrence) }
            guard link.scope == .series, let seriesId = link.seriesId, var series = try await api.event(seriesId, on: calendar) else {
                return .gone
            }
            series.calendar.writable = false
            return .found(series)
        } catch {
            return .unavailable
        }
    }
}

/** Why an event can't be saved, said before asking Google. */
nonisolated struct EventProblem: LocalizedError {
    var message: String
    var errorDescription: String? { message }
}

/** The demo's changes, laid over its pretend events each time they're made again. */
nonisolated struct DemoEdits {
    var made: [CalendarEvent] = []
    var changed: [String: CalendarEvent] = [:]
    var deleted: Set<String> = []

    func applied(to events: [CalendarEvent], in window: EventWindow, account: String) -> [CalendarEvent] {
        let mine = made.filter { $0.calendar.account == account }
        let all = (events + mine)
            .filter { !deleted.contains($0.id) }
            .map { changed[$0.id] ?? $0 }
            .filter { $0.end > window.from && $0.start < window.to }
        return EventDays.sorted(all)
    }
}

/** The demo's stand-in for Google: the event as Google would hand it back, nothing sent anywhere. */
nonisolated struct DemoEventWriter: EventWriter {
    var dates = CalendarDates()

    func create(_ input: EventInput, on calendar: EventCalendar, notify: Bool) async throws -> CalendarEvent {
        let blank = CalendarEvent(eventId: "demo-\(UUID().uuidString.lowercased())", calendar: calendar, title: "", start: .now, end: .now)
        return input.applied(to: blank, dates: dates)
    }

    func update(_ event: CalendarEvent, with patch: EventInput, notify: Bool) async throws -> CalendarEvent {
        patch.applied(to: event, dates: dates)
    }

    func delete(_ event: CalendarEvent, notify: Bool) async throws {}
}
