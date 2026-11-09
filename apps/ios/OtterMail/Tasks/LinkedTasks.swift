import SwiftUI

/** What linked tasks hang off: an event (an occurrence of a series reaches the series' tasks too), or a conversation. */
enum TaskSource {
    case event(CalendarEvent)
    case thread(MailThread, mailbox: String)

    @MainActor func linked(in tasks: TaskStore) -> [MailTask] {
        let found: [MailTask] = switch self {
        case .event(let event): tasks.linked(to: event)
        case .thread(let thread, let mailbox): tasks.linked(thread: thread.id, mailboxes: [mailbox, thread.mailbox])
        }
        return TaskList.sorted(found.filter { !$0.done }) + TaskList.sorted(found.filter(\.done))
    }

    /** "Add task": the event's title or the conversation's subject, already linked. */
    var newTask: MailTask {
        switch self {
        case .event(let event): MailTask(from: event, scope: .occurrence)
        case .thread(let thread, let mailbox): MailTask(from: thread, mailbox: mailbox)
        }
    }

    var recurringEvent: CalendarEvent? {
        if case .event(let event) = self, event.seriesId != nil { return event }
        return nil
    }

    func linking(_ task: MailTask, scope: TaskEvent.Scope) -> MailTask {
        switch self {
        case .event(let event): TaskLinks.linking(task, event: TaskEvent(event, scope: scope))
        case .thread(let thread, let mailbox): TaskLinks.linking(task, email: TaskEmail(thread, mailbox: mailbox))
        }
    }

    /** Every link of the task's that reaches this event or conversation goes; the task stays. */
    func unlinking(_ task: MailTask) -> MailTask {
        var task = task
        switch self {
        case .event(let event):
            let keys = Set(TaskLinks.links(of: task, to: event).map(\.key))
            task.events.removeAll { keys.contains($0.key) }
        case .thread(let thread, let mailbox):
            task.emails.removeAll { $0.links(thread.id, mailbox: mailbox) || $0.links(thread.id, mailbox: thread.mailbox) }
        }
        return task
    }

    /** A conversation's link that leads back to this one, which is open already. */
    func isHere(_ email: TaskEmail) -> Bool {
        guard case .thread(let thread, let mailbox) = self else { return false }
        return email.links(thread.id, mailbox: mailbox) || email.links(thread.id, mailbox: thread.mailbox)
    }
}

/**
 * The tasks linked to a conversation or an event, as a short list on it, and
 * nothing at all when there are none: each opens in the task editor,
 * finishes from its circle, or is unlinked. Adding and linking are in the
 * screen's More menu ("Add task", "Link to a task").
 */
struct LinkedTasks: View {
    @Environment(Session.self) private var session
    @Environment(Preferences.self) private var preferences
    @Environment(\.palette) private var palette
    @Environment(\.openTaskTarget) private var openTarget

    let source: TaskSource

    @State private var editing: MailTask?
    @State private var error: String?

    private var tasks: TaskStore { session.tasks }
    private var dates: CalendarDates { CalendarDates(preferences: preferences.calendar) }

    var body: some View {
        let linked = source.linked(in: tasks)
        if !linked.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text("Tasks")
                    .font(.inter(.footnote).weight(.medium))
                    .foregroundStyle(palette.muted)
                ForEach(linked) { task in
                    HStack(spacing: 8) {
                        TaskRow(
                            task: task,
                            due: TaskList.dueLabel(task, now: .now, dates: dates),
                            overdue: TaskList.group(of: task, now: .now, dates: dates) == .overdue,
                            showsLinks: false,
                            onToggle: { tasks.setDone(!task.done, task) },
                            onOpen: { editing = task }
                        )
                        if let event = source.recurringEvent, TaskLinks.links(of: task, to: event).contains(where: { $0.scope == .series }) {
                            Image(systemName: "repeat")
                                .font(.system(size: 13))
                                .foregroundStyle(palette.muted)
                                .accessibilityLabel("For the whole series")
                        }
                        UnlinkButton(title: task.content) { Task { await unlink(task) } }
                    }
                    .padding(.vertical, 2)
                }
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.inter(.footnote))
                        .foregroundStyle(palette.error)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("linked-tasks")
            .sheet(item: $editing) { task in
                NavigationStack {
                    TaskEditor(task: task, onEmail: { email in
                        editing = nil
                        if !source.isHere(email) { openTarget(.email(email)) }
                    })
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close", systemImage: "xmark") { editing = nil }
                        }
                    }
                }
            }
        }
    }

    private func unlink(_ task: MailTask) async {
        do {
            try await tasks.update(task.id) { source.unlinking($0) }
            error = nil
        } catch {
            self.error = "Couldn't unlink the task. \(error.localizedDescription)"
        }
    }
}

/**
 * Link to a task: the tasks not linked here yet, open ones first, searched by
 * name; a tap links one and closes. For an event of a series, the link is to
 * this occurrence or every one, as the picker says.
 */
struct LinkToTaskSheet: View {
    @Environment(Session.self) private var session
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    let source: TaskSource

    @State private var query = ""
    @State private var scope: TaskEvent.Scope = .occurrence
    @State private var error: String?

    private var tasks: TaskStore { session.tasks }

    private var candidates: [MailTask] {
        let terms = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let linked = Set(source.linked(in: tasks).map(\.id))
        let found = tasks.tasks.filter { !linked.contains($0.id) && (terms.isEmpty || $0.content.localizedCaseInsensitiveContains(terms)) }
        return TaskList.sorted(found.filter { !$0.done }) + TaskList.sorted(found.filter(\.done))
    }

    var body: some View {
        NavigationStack {
            SettingsForm {
                if source.recurringEvent != nil {
                    Section {
                        ScopePicker(scope: $scope)
                    }
                }
                Section {
                    ForEach(candidates) { task in
                        Button {
                            Task { await link(task) }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: task.done ? "checkmark.circle.fill" : "circle").foregroundStyle(palette.muted)
                                Text(task.content)
                                    .font(.inter(.body))
                                    .foregroundStyle(task.done ? palette.muted : palette.text)
                                    .lineLimit(2)
                                Spacer(minLength: 8)
                                Image(systemName: "link").foregroundStyle(palette.action)
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Link to \(task.content)")
                    }
                    if candidates.isEmpty {
                        Text(query.isEmpty ? "Every task is linked here already." : "No matching tasks.")
                            .foregroundStyle(palette.muted)
                    }
                } footer: {
                    if let error { Text(error).sectionFooter().foregroundStyle(palette.error) }
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search tasks")
            .navigationTitle("Link to a task")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
            }
        }
    }

    private func link(_ task: MailTask) async {
        let scope = scope
        do {
            try await tasks.update(task.id) { source.linking($0, scope: scope) }
            dismiss()
        } catch {
            self.error = "Couldn't link the task. \(error.localizedDescription)"
        }
    }
}
