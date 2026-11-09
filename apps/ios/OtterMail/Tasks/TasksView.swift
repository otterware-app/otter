import SwiftUI

/**
 * The Tasks module, beside Mail and Calendar, its ⌃⌄ picking the list
 * (`TaskListsPanel`): what's open by when it's due, then what's done under a
 * heading that folds away. Swipe a row to finish it or to throw it away, tap
 * it to read it and change it from there. HomeView holds the navigation stack,
 * so the bar stays on this page only.
 */
struct TasksView: View {
    @Environment(Session.self) private var session
    @Environment(Preferences.self) private var preferences
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openTaskTarget) private var openTarget

    /** A task whose reminder was tapped: it opens on top of the list. */
    var opening: UUID?
    let onEmail: (TaskEmail) -> Void
    var onTitle: () -> Void = {}
    var onSettings: () -> Void = {}

    @State private var editing: MailTask?
    @State private var viewing: MailTask?
    @State private var reveal: Reveal?
    @State private var showDone = false
    @State private var now = Date.now

    private var tasks: TaskStore { session.tasks }
    private var dates: CalendarDates { CalendarDates(preferences: preferences.calendar) }
    private var sections: [TaskSection] { TaskList.sections(tasks.visible, now: now, dates: dates) }
    /** A new task goes on the list shown; All and the Inbox leave it without one. */
    private var newTask: MailTask {
        MailTask(projectId: tasks.selected == TaskProject.inbox.id ? nil : tasks.selected)
    }
    private var animation: Animation? { reduceMotion ? nil : .smooth(duration: 0.18) }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                localNote
                ForEach(sections) { section in
                    Section {
                        if section.id != .done || showDone {
                            ForEach(section.tasks) { row($0).id($0.id.uuidString) }
                        }
                    } header: {
                        header(section)
                    }
                    .textCase(nil)
                }
                if sections.isEmpty { empty }
            }
            .listStyle(.plain)
            .listSectionSeparator(.hidden, edges: .top)
            .scrollContentBackground(.hidden)
            .background(palette.canvas)
            .contentMargins(.bottom, 24, for: .scrollContent)
            // A task saved is brought into view: a new one can sort below what the list shows.
            .task(id: reveal) {
                guard let reveal else { return }
                try? await Task.sleep(for: .milliseconds(350))
                withAnimation(animation) { proxy.scrollTo(reveal.id, anchor: .center) }
            }
        }
        .navigationTitle("Tasks")
        .toolbarTitleDisplayMode(.inline)
        .toolbar(removing: .title)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(action: onTitle) {
                    PlaceTitle(title: "Tasks", scope: tasks.project(tasks.selected)?.name ?? "")
                }
                .buttonStyle(.plain)
                .accessibilityHint("Shows the task lists")
            }
            .sharedBackgroundVisibility(.hidden)
            ToolbarItem(placement: .topBarTrailing) {
                Button("Add task", systemImage: "plus") { editing = newTask }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu("More", systemImage: "ellipsis") {
                    if tasks.visible.contains(where: \.done) {
                        Button(showDone ? "Hide done" : "Show done", systemImage: showDone ? "eye.slash" : "eye") {
                            withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) { showDone.toggle() }
                        }
                    }
                    Button("Settings", systemImage: "gearshape", action: onSettings)
                }
            }
        }
        .navigationDestination(item: $editing) { task in
            TaskEditor(task: task, onEmail: open) { saved in reveal = Reveal(id: saved.id.uuidString) }
        }
        .navigationDestination(item: $viewing) { task in
            TaskDetail(task: task, onOpen: open)
        }
        .task {
            now = .now
            await tasks.checkReminders()
            await keepTime()
        }
        // Away for a while, the clock has moved on: Overdue and Today are read again.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { now = .now }
        }
        .onChange(of: opening, initial: true) { _, id in
            guard let id, let task = tasks.task(id) else { return }
            viewing = task
        }
        // Deleted from its editor, the task's detail goes with it.
        .onChange(of: viewing.map { tasks.contains($0.id) }) { _, kept in
            if kept == false { viewing = nil }
        }
        .alert("Couldn't save the tasks", isPresented: .constant(tasks.failure != nil)) {
            Button("OK") { tasks.failure = nil }
        } message: {
            Text(tasks.failure ?? "")
        }
    }

    /** Where the list starts, so it's clear before the first task: these stay on this iPhone. */
    private var localNote: some View {
        Label("On this iPhone only. Tasks don't sync to your other devices.", systemImage: "iphone")
            .font(.inter(.footnote))
            .foregroundStyle(palette.muted)
            .padding(.horizontal, 20)
            .padding(.vertical, 6)
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(palette.canvas)
    }

    /** A deadline passing, or midnight, while the list is open moves the rows under the right heading. */
    private func keepTime() async {
        while !Task.isCancelled {
            let ahead = 60 - Date.now.timeIntervalSince1970.truncatingRemainder(dividingBy: 60)
            do { try await Task.sleep(for: .seconds(ahead)) } catch { return }
            now = .now
        }
    }

    private func header(_ section: TaskSection) -> some View {
        let folds = section.id == .done
        return Button {
            guard folds else { return }
            withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) { showDone.toggle() }
        } label: {
            HStack(spacing: 6) {
                if folds {
                    Image(systemName: "chevron.down")
                        .font(.inter(.caption2))
                        .rotationEffect(.degrees(showDone ? 0 : -90))
                }
                Text(section.id.title)
                    .fontWeight(.medium)
                    // The system red, which lightens in dark mode where the theme's error red is too dim to read.
                    .foregroundStyle(section.id == .overdue ? Color(.systemRed) : palette.text)
                Spacer()
                Text("\(section.tasks.count)").monospacedDigit()
            }
            .font(.inter(.footnote))
            .foregroundStyle(palette.muted)
            .frame(minHeight: folds ? 44 : 36)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        // Not disabled: that would dim the headings that don't fold, Overdue's red with them.
        .allowsHitTesting(folds)
        .accessibilityValue(folds ? (showDone ? "Expanded" : "Collapsed") : "")
        .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
    }

    private var empty: some View {
        ContentUnavailableView(
            "No tasks",
            systemImage: "checklist",
            description: Text("Add one with +, from a conversation's More menu, or from an event.")
        )
        .foregroundStyle(palette.muted)
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
        .padding(.top, 40)
    }

    private func row(_ task: MailTask) -> some View {
        TaskRow(
            task: task,
            due: TaskList.dueLabel(task, now: now, dates: dates),
            overdue: TaskList.group(of: task, now: now, dates: dates) == .overdue,
            onToggle: { toggle(task) },
            onOpen: { viewing = task },
            onEmail: open,
            onEvent: open
        )
        .padding(.leading, 20)
        .padding(.trailing, 16)
        .padding(.vertical, 10)
        .background(palette.canvas)
        .contextMenu {
            Button(task.done ? "Mark as not done" : "Mark as done",
                   systemImage: task.done ? "circle" : "checkmark.circle") { toggle(task) }
            Button("Edit", systemImage: "pencil") { editing = task }
            if let email = task.email {
                Button("Open the conversation", systemImage: "envelope") { open(email) }
            }
            if let event = task.events.first {
                Button("Open the event", systemImage: "calendar") { open(event) }
            }
            Divider()
            Button("Delete", systemImage: "trash", role: .destructive) {
                withAnimation(animation) { tasks.delete(task) }
            }
        }
        .modifier(MailSwipeActions(leading: doneAction(task), trailing: deleteAction(task), square: preferences.fullWidthRows))
        .listRowBackground(palette.canvas)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets())
    }

    /** The mail list's swipe: away to the right finishes it, to the left it's gone. */
    private func doneAction(_ task: MailTask) -> MailSwipeAction {
        task.done
            ? MailSwipeAction(title: "Not done", symbol: "circle", tint: palette.focus) { toggle(task) }
            : MailSwipeAction(title: "Done", symbol: "checkmark.circle", tint: .green) { toggle(task) }
    }

    private func deleteAction(_ task: MailTask) -> MailSwipeAction {
        MailSwipeAction(title: "Delete", symbol: "trash", tint: .red) {
            withAnimation(animation) { tasks.delete(task) }
        }
    }

    private func toggle(_ task: MailTask) {
        withAnimation(animation) { tasks.setDone(!task.done, task) }
    }

    private func open(_ email: TaskEmail) { open(.email(email)) }

    private func open(_ event: TaskEvent) { open(.event(event)) }

    private func open(_ target: TaskTarget) {
        editing = nil
        viewing = nil
        Self.route(target, onEmail: onEmail, openTarget: openTarget)
    }

    /** A conversation goes back to Mail as the list's do (`onEmail`), an event to the calendar (`openTaskTarget`). */
    static func route(_ target: TaskTarget, onEmail: (TaskEmail) -> Void, openTarget: (TaskTarget) -> Void) {
        switch target {
        case .email(let email): onEmail(email)
        case .event: openTarget(target)
        }
    }
}

/**
 * One task, laid out like the mail rows (`ThreadRow`): a circle to finish it
 * in the gutter, then what it is, when it's due, and what it's linked to.
 */
struct TaskRow: View {
    @Environment(\.palette) private var palette

    let task: MailTask
    var due: String?
    var overdue = false
    /** Off where the row is shown on the very thing it links to. */
    var showsLinks = true
    let onToggle: () -> Void
    let onOpen: () -> Void
    var onEmail: (TaskEmail) -> Void = { _ in }
    var onEvent: (TaskEvent) -> Void = { _ in }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button(action: onToggle) {
                Image(systemName: task.done ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(task.done ? palette.action : palette.muted)
                    .frame(width: 28, height: 28)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(task.done ? "Mark as not done" : "Mark as done")

            VStack(alignment: .leading, spacing: 4) {
                Button(action: onOpen) { lines }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .combine)
                if showsLinks, !task.emails.isEmpty || !task.events.isEmpty {
                    TaskLinkChips(task: task, onEmail: onEmail, onEvent: onEvent)
                }
            }
        }
        .contentShape(.rect)
    }

    private var lines: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(task.content)
                .font(.inter(.subheadline).weight(task.done ? .regular : .medium))
                .foregroundStyle(task.done ? palette.muted : palette.text)
                .strikethrough(task.done)
                .lineLimit(2)
            HStack(spacing: 6) {
                if let due {
                    Label(due, systemImage: task.reminder && task.hasTime ? "bell" : "calendar")
                        .font(.inter(.footnote))
                        .foregroundStyle(overdue ? Color(.systemRed) : palette.muted)
                        .monospacedDigit()
                }
                if !task.notes.isEmpty {
                    Text(task.notes)
                        .font(.inter(.footnote))
                        .foregroundStyle(palette.muted.opacity(0.8))
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
