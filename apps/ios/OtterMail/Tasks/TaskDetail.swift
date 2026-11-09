import SwiftUI

/** A row of a task's detail under Linked: what it shows, and what a tap opens (nothing for a conversation out of reach). */
struct TaskDetailLink: Identifiable {
    let target: TaskTarget
    let symbol: String
    let title: String
    let detail: String
    let unavailable: Bool
    let open: (() -> Void)?

    var id: TaskTarget { target }

    /** The conversations, then the events. */
    static func all(of task: MailTask, labels: TaskLinkLabels, onOpen: @escaping (TaskTarget) -> Void) -> [TaskDetailLink] {
        let emails = task.emails.map { email in
            let label = labels.email(email)
            let target = TaskTarget.email(email)
            return TaskDetailLink(
                target: target, symbol: "envelope", title: label.title, detail: label.detail, unavailable: label.unavailable,
                open: label.unavailable ? nil : { onOpen(target) }
            )
        }
        let events = task.events.map { link in
            let label = labels.event(link)
            let target = TaskTarget.event(link)
            return TaskDetailLink(
                target: target, symbol: link.scope == .series ? "repeat" : "calendar", title: label.title, detail: label.detail,
                unavailable: label.unavailable, open: { onOpen(target) }
            )
        }
        return emails + events
    }
}

/**
 * One task, read as the calendar reads an event (`EventView`): what it is,
 * its list, when it's due and reminds, whether it's done, its note, and the
 * conversations and events it's linked to, each opening in Mail or the
 * calendar. Edit opens the editor over it.
 */
struct TaskDetail: View {
    @Environment(Session.self) private var session
    @Environment(MailStore.self) private var store
    @Environment(CalendarStore.self) private var calendar
    @Environment(Preferences.self) private var preferences
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let task: MailTask
    let onOpen: (TaskTarget) -> Void

    @State private var editing = false

    private var tasks: TaskStore { session.tasks }
    /** The task as saved now, so a change in the editor or a tap on its circle shows here. */
    private var current: MailTask { tasks.task(task.id) ?? task }
    private var dates: CalendarDates { CalendarDates(preferences: preferences.calendar) }
    private var labels: TaskLinkLabels { TaskLinkLabels(store: store, calendar: calendar, dates: dates) }

    var body: some View {
        let task = current
        let overdue = TaskList.group(of: task, now: .now, dates: dates) == .overdue
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                head(task, overdue: overdue)
                facts(task, overdue: overdue)
                if let notes = text(task.notes) {
                    Text(notes)
                        .font(.inter(.subheadline))
                        .foregroundStyle(palette.text.opacity(0.85))
                        .textSelection(.enabled)
                }
                if !task.emails.isEmpty || !task.events.isEmpty { links(task) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
        .background(palette.canvas)
        .navigationTitle("Task")
        .toolbarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Edit") { editing = true }
                    .accessibilityIdentifier("task-detail-edit")
            }
        }
        .navigationDestination(isPresented: $editing) {
            TaskEditor(task: current, onEmail: { onOpen(.email($0)) })
        }
    }

    private func head(_ task: MailTask, overdue: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(task.content)
                .font(.inter(.title2).weight(.semibold))
                .foregroundStyle(task.done ? palette.muted : palette.text)
                .strikethrough(task.done)
                .textSelection(.enabled)
            // Done or not is the row below, with its button; the list is the one chip.
            if !tasks.projects.isEmpty, let list = tasks.project(task.projectId ?? TaskProject.inbox.id) {
                chip(list.name, color: palette.muted)
            }
        }
    }

    private func facts(_ task: MailTask, overdue: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let due = TaskList.dueLabel(task, now: .now, dates: dates) {
                fact("calendar", title: due, detail: overdue ? "Overdue" : "Due", tint: overdue ? Color(.systemRed) : palette.text)
            }
            if task.reminder, task.hasTime, let due = task.due {
                fact("bell", title: dates.timeLabel(due), detail: reminderDetail(task, at: due))
            }
            fact(task.done ? "checkmark.circle.fill" : "circle", title: task.done ? "Done" : "Not done", detail: completed(task)) {
                Button(task.done ? "Mark as not done" : "Mark as done") {
                    withAnimation(reduceMotion ? nil : .smooth(duration: 0.18)) { tasks.setDone(!task.done, task) }
                }
                .font(.inter(.subheadline).weight(.semibold))
                .buttonStyle(.borderless)
            }
        }
    }

    /** As `LinkedTasks` shows a task on an event, so is an event or a conversation shown on the task. */
    private func links(_ task: MailTask) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Linked")
                .font(.inter(.footnote).weight(.medium))
                .foregroundStyle(palette.muted)
                .padding(.bottom, 4)
            ForEach(TaskDetailLink.all(of: task, labels: labels, onOpen: onOpen)) { link in
                TaskLinkRow(symbol: link.symbol, title: link.title, detail: link.detail, unavailable: link.unavailable, onOpen: link.open)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(palette.text.opacity(0.04), in: .rect(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("task-detail-links")
    }

    private func reminderDetail(_ task: MailTask, at due: Date) -> String {
        if task.done { return "Reminder, not sent: it's done" }
        if tasks.remindersDenied { return "Reminder, but notifications are off" }
        if due < .now { return "Reminder, passed" }
        return "Reminder"
    }

    private func completed(_ task: MailTask) -> String? {
        guard task.done, let completed = task.completed else { return nil }
        return "Finished \(dates.heading(completed)), \(dates.timeLabel(completed))"
    }

    private func chip(_ title: String, color: Color) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(title).font(.inter(.footnote)).foregroundStyle(palette.text)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(palette.text.opacity(0.06), in: .capsule)
    }

    private func fact(_ symbol: String, title: String, detail: String? = nil, tint: Color? = nil) -> some View {
        fact(symbol, title: title, detail: detail, tint: tint) { EmptyView() }
    }

    private func fact<Action: View>(
        _ symbol: String, title: String, detail: String? = nil, tint: Color? = nil, @ViewBuilder action: () -> Action
    ) -> some View {
        HStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 17))
                .foregroundStyle(palette.muted)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.inter(.body))
                    .foregroundStyle(tint ?? palette.text)
                    .monospacedDigit()
                if let detail {
                    Text(detail).font(.inter(.footnote)).foregroundStyle(palette.muted)
                }
            }
            Spacer(minLength: 8)
            action()
        }
        .frame(minHeight: 52)
    }

    private func text(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
