import SwiftUI

/**
 * The task editor's links: every conversation and event the task is linked
 * to, each opened or unlinked in place, a series' link switched between the
 * one occurrence and the whole series, and more found and linked right here.
 * Nothing is written until the editor's Save.
 */
struct TaskEditorLinks: View {
    @Environment(MailStore.self) private var store
    @Environment(Session.self) private var session
    @Environment(CalendarStore.self) private var calendar
    @Environment(Preferences.self) private var preferences
    @Environment(\.palette) private var palette

    @Binding var task: MailTask
    let onEmail: (TaskEmail) -> Void
    let onEvent: (TaskEvent) -> Void

    @State private var searching = false
    @State private var query = ""
    @State private var now = Date.now
    @FocusState private var focused: Bool

    private var dates: CalendarDates { CalendarDates(preferences: preferences.calendar) }
    private var labels: TaskLinkLabels { TaskLinkLabels(store: store, calendar: calendar, dates: dates) }
    private var sources: [Mailbox] { CalendarStore.sources(store.shownMailboxes) }
    private var window: EventWindow { dates.window(.agenda, anchor: now) }
    private var terms: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        Section {
            ForEach(task.emails, id: \.key) { email in
                let label = labels.email(email)
                TaskLinkRow(
                    symbol: "envelope", title: label.title, detail: label.detail, unavailable: label.unavailable,
                    onOpen: label.unavailable ? nil : { onEmail(email) },
                    onUnlink: { task = TaskLinks.unlinking(task, email: email.key) }
                )
            }
            ForEach(task.events, id: \.key) { link in
                let label = labels.event(link)
                TaskLinkRow(
                    symbol: link.scope == .series ? "repeat" : "calendar", title: label.title, detail: label.detail,
                    unavailable: label.unavailable,
                    onOpen: { onEvent(link) },
                    onUnlink: { task = TaskLinks.unlinking(task, event: link.key) }
                )
                if link.recurring {
                    ScopePicker(scope: Binding(
                        get: { link.scope },
                        set: { task = TaskLinks.rescoping(task, event: link.key, to: $0) }
                    ))
                }
            }
            if searching {
                search
            } else {
                Button("Link to an email or event", systemImage: "link") {
                    searching = true
                    focused = true
                }
                .accessibilityIdentifier("task-link-add")
            }
        } header: {
            Text("Linked").sectionHeader()
        } footer: {
            Text(footer).sectionFooter()
        }
        .task(id: searching) {
            guard searching, !sources.isEmpty else { return }
            now = .now
            await calendar.load(window, sources: sources, demo: store.isDemo, google: session.google, dates: dates)
        }
    }

    @ViewBuilder private var search: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(palette.muted)
            TextField(sources.isEmpty ? "Search mail" : "Search mail and events", text: $query)
                .font(.inter(.subheadline))
                .focused($focused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .accessibilityIdentifier("task-link-search")
            Button("Done") {
                searching = false
                query = ""
            }
            .font(.inter(.subheadline).weight(.medium))
            .buttonStyle(.borderless)
        }
        let emails = emailMatches
        let events = eventMatches
        ForEach(emails) { match in
            Button {
                task = TaskLinks.linking(task, email: match.email)
            } label: {
                result("envelope", match.email.subject, "\(match.from) · \(match.email.mailbox)")
            }
            .buttonStyle(.plain)
        }
        ForEach(events) { event in
            let occurrence = TaskEvent(event, scope: .occurrence)
            if occurrence.recurring {
                VStack(alignment: .leading, spacing: 6) {
                    result("repeat", event.title, eventLine(event))
                    // Asked in place, and only for a series: the one occurrence, or every one of them.
                    HStack(spacing: 8) {
                        ForEach(TaskEvent.Scope.allCases, id: \.self) { scope in
                            Button(scope.title) { task = TaskLinks.linking(task, event: TaskEvent(event, scope: scope)) }
                                .buttonStyle(.bordered)
                        }
                    }
                    .font(.inter(.footnote).weight(.medium))
                }
                .padding(.vertical, 4)
            } else {
                Button {
                    task = TaskLinks.linking(task, event: occurrence)
                } label: {
                    result("calendar", event.title, eventLine(event))
                }
                .buttonStyle(.plain)
            }
        }
        if emails.isEmpty && events.isEmpty {
            Text(terms.isEmpty ? "Nothing more to link." : "Nothing found for “\(terms)”.")
                .font(.inter(.footnote))
                .foregroundStyle(palette.muted)
        }
    }

    private func result(_ symbol: String, _ title: String, _ detail: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 15))
                .foregroundStyle(palette.muted)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.inter(.subheadline).weight(.medium))
                    .foregroundStyle(palette.text)
                    .lineLimit(1)
                Text(detail)
                    .font(.inter(.footnote))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Image(systemName: "plus.circle").foregroundStyle(palette.action)
        }
        .frame(minHeight: 44)
        .contentShape(.rect)
    }

    private func eventLine(_ event: CalendarEvent) -> String {
        let day = dates.heading(event.start, now: now)
        return event.allDay ? "\(day) · \(event.calendar.name)" : "\(day) · \(dates.timeLabel(event.start)) · \(event.calendar.name)"
    }

    /** Every mailbox's inbox, newest first, or what a search finds; what's linked already is left out. */
    private struct EmailMatch: Identifiable {
        let email: TaskEmail
        let from: String
        let date: Date
        var id: String { email.key }
    }

    private var emailMatches: [EmailMatch] {
        let linked = Set(task.emails.map(\.key))
        var seen: Set<String> = []
        var found: [EmailMatch] = []
        for scope in store.shownScopes {
            let threads = terms.isEmpty ? store.threads(in: .inbox, scope: scope.email) : store.search(terms, scope: scope.email)
            for thread in threads.prefix(30) {
                let email = TaskEmail(thread, mailbox: scope.email)
                guard !linked.contains(email.key), seen.insert(thread.id).inserted else { continue }
                found.append(EmailMatch(email: email, from: thread.latest.from.label, date: thread.latest.date))
            }
        }
        return Array(found.sorted { $0.date > $1.date }.prefix(terms.isEmpty ? 3 : 6))
    }

    /** The agenda's events from today on, soonest first; an event of a series asks whether it's the one or all. */
    private var eventMatches: [CalendarEvent] {
        let linked = Set(task.events.map(\.key))
        let found = TaskLinks.upcoming(calendar.events(in: window) ?? [], now: now, dates: dates).filter { event in
            guard event.status != .cancelled, terms.isEmpty || event.title.localizedCaseInsensitiveContains(terms) else { return false }
            let occurrence = TaskEvent(event, scope: .occurrence)
            return !linked.contains(occurrence.key) && !(occurrence.recurring && linked.contains(occurrence.scoped(.series).key))
        }
        return Array(found.prefix(terms.isEmpty ? 3 : 6))
    }

    private var footer: String {
        if task.emails.isEmpty && task.events.isEmpty {
            return "Link the conversations and events this task is about. Links stay on this iPhone, with the task."
        }
        return "Links stay on this iPhone, with the task. Nothing is changed in the mail or the calendar."
    }
}

/** For an event of a series, in place: the task is about this occurrence, or every one. */
struct ScopePicker: View {
    @Binding var scope: TaskEvent.Scope

    var body: some View {
        Picker("Linked to", selection: $scope) {
            ForEach(TaskEvent.Scope.allCases, id: \.self) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
        .font(.inter(.subheadline))
        .accessibilityIdentifier("task-link-scope")
    }
}
