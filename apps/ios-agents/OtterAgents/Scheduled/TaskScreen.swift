import SwiftUI

/** One scheduled task: when it runs next, what it does, and what its past runs wrote. */
struct TaskScreen: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(ScheduledStore.self) private var store
    @Environment(ChatStore.self) private var chats
    let id: String
    var openChat: (String) -> Void

    @State private var editing = false
    @State private var deleting = false
    @State private var whole = false
    @State private var runs: [TaskRun]?
    @State private var runsError: String?
    @State private var open: String?
    @State private var transcripts: [String: [SessionMessage]] = [:]

    var body: some View {
        if let task = store.task(id) {
            content(task)
        } else {
            VStack(spacing: 8) {
                Text("This task is gone").font(.ui(21, .semibold)).foregroundStyle(palette.text)
                Button("All scheduled tasks") { dismiss() }.font(.ui(16)).foregroundStyle(palette.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(palette.canvas)
        }
    }

    private func content(_ task: ScheduledTask) -> some View {
        let agent = store.agent(of: task)
        let locked = agent?.readOnly != nil
        return SettingsPage {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    AgentAvatar(agent: task.provider, gatewayAgent: task.agent, size: 26)
                    Text(task.name).font(.ui(24, .semibold)).tracking(-0.3).foregroundStyle(palette.text)
                }
                TimelineView(.periodic(from: .now, by: 30)) { _ in
                    Text(task.running ? "Running now" : task.nextRunAt.map { "Next run: \(ScheduleText.dayTime($0))" } ?? (task.enabled ? ScheduleText.schedule(task.schedule) : "Paused"))
                        .font(.ui(15)).foregroundStyle(task.running ? Status.working : palette.muted)
                }
                if let description = task.description { Text(description).font(.ui(15)).foregroundStyle(palette.muted) }
            }
            .padding(.horizontal, 8)

            if let managed = task.managedBy {
                note("\(managed) keeps this one: run or pause it here, and change it there.", symbol: "lock")
            } else if !task.editable {
                note("Otter can't change this kind of schedule: change it in \(store.name(of: task)).", symbol: "lock")
            } else if let readOnly = agent?.readOnly {
                note(readOnly, symbol: "lock")
            }
            if let paused = task.autoPaused { note(paused, symbol: "pause.circle", tone: palette.warning) }
            if task.lastRun?.status == .error {
                note("Its last run failed\(task.lastRun?.error.map { ": \($0)" } ?? ".")", symbol: "exclamationmark.circle", tone: palette.error)
            }
            if let problem = task.deliveryProblem { note(problem, symbol: "exclamationmark.triangle", tone: palette.warning) }

            SettingsSection {
                SettingsCell {
                    Toggle(task.enabled ? "Active" : "Paused", isOn: Binding(get: { task.enabled }, set: { on in act { try await store.setEnabled(task, on) } }))
                        .font(.ui(16)).foregroundStyle(palette.text)
                }
                .disabled(locked)
                SettingsDivider()
                SettingsButton(title: task.running ? "Running…" : "Run now") {
                    act {
                        try await store.runNow(task)
                        chats.notice = "\(task.name) is running"
                    }
                }
                .disabled(task.running || locked)
                if task.editable, !locked {
                    SettingsDivider()
                    SettingsButton(title: "Edit") { editing = true }
                }
                if task.managedBy == nil, !locked {
                    SettingsDivider()
                    SettingsButton(title: "Delete…", destructive: true) { deleting = true }
                }
            }

            SettingsSection(title: task.prompt != nil ? "Instructions" : task.runs != nil ? "What it runs" : "What it does") {
                VStack(alignment: .leading, spacing: 8) {
                    let text = task.prompt ?? task.runs ?? task.description ?? "It keeps \(store.name(of: task)) going."
                    Text(text).font(.ui(15)).foregroundStyle(palette.text).lineLimit(whole ? nil : 8).textSelection(.enabled)
                    if !whole, text.count > 360 || text.filter({ $0 == "\n" }).count > 7 {
                        Button("Show all") { withAnimation { whole = true } }.font(.ui(14, .medium)).foregroundStyle(palette.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }

            SettingsSection {
                detail("Repeats", ScheduleText.schedule(task.schedule) + (task.conditional ? "\nOnly when its own check says so" : ""))
                SettingsDivider()
                detail("Agent", store.name(of: task))
                SettingsDivider()
                detail("Results", deliveryText(task.delivery))
                if let alerts = task.failureAlerts {
                    SettingsDivider()
                    detail("Failures reported to", alerts)
                }
            }

            results(task)
            history(task, agent)
        }
        .navigationTitle("")
        .sheet(isPresented: $editing) { TaskEditor(task: task) }
        .confirmationDialog("Delete “\(task.name)”?", isPresented: $deleting, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                act {
                    try await store.remove(task)
                    dismiss()
                }
            }
        } message: {
            Text("It stops running, and its agent forgets it. What it already sent stays where it went.")
        }
        .task(id: task.lastRun?.at) {
            guard agent?.can.history != false else { return }
            do { runs = try await store.runs(task) } catch { runsError = error.localizedDescription }
        }
    }

    private func act(_ work: @escaping () async throws -> Void) {
        Task { do { try await work() } catch { chats.notice = error.localizedDescription } }
    }

    private func note(_ text: String, symbol: String, tone: Color? = nil) -> some View {
        Label { Text(text).font(.ui(14)) } icon: { Image(systemName: symbol).font(.system(size: 14, weight: .medium)) }
            .foregroundStyle(tone ?? palette.muted)
            .padding(.horizontal, 8)
    }

    private func detail(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title).font(.ui(15)).foregroundStyle(palette.muted)
            Spacer(minLength: 8)
            Text(value).font(.ui(15)).foregroundStyle(palette.text).multilineTextAlignment(.trailing)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    /** The chats that got this task's results: the one it posts to, and those a run of it started. */
    @ViewBuilder
    private func results(_ task: ScheduledTask) -> some View {
        let found = chats.chats.filter { chat in
            guard chat.provider == task.provider else { return false }
            if let session = chat.sessionId, task.chats.contains(session) { return true }
            return chat.turns.contains { turn in
                if case .automation(let job, let name, _) = turn.delivered { job == task.taskId || (job == nil && name == task.name) } else { false }
            }
        }.sorted { $0.updatedAt > $1.updatedAt }.prefix(5)
        if !found.isEmpty {
            SettingsSection(title: "Results in Otter") {
                ForEach(Array(found)) { chat in
                    Button { openChat(chat.id) } label: {
                        SettingsRow("\(chat.title)", symbol: "text.bubble", value: ChatShelf.shortAgo(chat.updatedAt, .now))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder
    private func history(_ task: ScheduledTask, _ agent: AgentTasks?) -> some View {
        if agent?.can.history == false {
            Text("\(store.name(of: task)) doesn't keep a history of runs Otter can show.").font(.ui(14)).foregroundStyle(palette.muted).padding(.horizontal, 8)
        } else if let runs, !runs.isEmpty {
            SettingsSection(title: "History") {
                ForEach(Array(runs.enumerated()), id: \.element.id) { index, run in
                    if index > 0 { SettingsDivider() }
                    Button {
                        Haptics.tap()
                        withAnimation(.easeOut(duration: 0.18)) { open = open == run.id ? nil : run.id }
                        if transcripts[run.id] == nil {
                            Task { transcripts[run.id] = (try? await store.transcript(task, run: run)) ?? [] }
                        }
                    } label: {
                        SettingsCell {
                            Image(systemName: run.status == .ok ? "checkmark.circle" : run.status == .skipped ? "minus.circle" : "exclamationmark.circle")
                                .font(.system(size: 17))
                                .foregroundStyle(run.status == .ok ? Status.done : run.status == .skipped ? palette.muted : palette.error)
                                .frame(width: 24)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(ScheduleText.dayTime(run.at).prefix(1).uppercased() + ScheduleText.dayTime(run.at).dropFirst()).font(.ui(15)).foregroundStyle(palette.text)
                                Text([run.durationMs.map(ScheduleText.duration), run.model].compactMap(\.self).joined(separator: " · "))
                                    .font(.ui(13)).foregroundStyle(palette.muted)
                            }
                            Spacer()
                            Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(palette.tertiary)
                                .rotationEffect(.degrees(open == run.id ? 180 : 0))
                        }
                    }
                    .buttonStyle(.plain)
                    if open == run.id { runDetail(run) }
                }
            }
        } else if let runsError {
            Text(runsError).font(.ui(14)).foregroundStyle(palette.muted).padding(.horizontal, 8)
        }
    }

    private func runDetail(_ run: TaskRun) -> some View {
        let sent: String = if run.silent { "It chose to send nothing this time." }
            else if let error = run.deliveryError { "Couldn't send it\(run.sentTo.map { " to \($0)" } ?? ""): \(error)" }
            else if run.delivered == false { "Its result wasn't delivered." }
            else if let to = run.sentTo { "Sent to \(to)" }
            else { "" }
        return VStack(alignment: .leading, spacing: 10) {
            if let error = run.error { Text(error).font(.ui(14)).foregroundStyle(palette.error) }
            if let messages = transcripts[run.id] {
                let items = messages.flatMap { message in message.steps.map { ChatItem.step(id: $0.id, $0.step, output: $0.output ?? "") } + (message.text.isEmpty ? [] : [.text(id: nil, message.text)]) }
                if items.isEmpty {
                    if let summary = run.summary { MarkdownView(source: summary) }
                    else if run.error == nil { Text("It had nothing to say.").font(.ui(14)).foregroundStyle(palette.muted) }
                } else {
                    WorkLog(items: items, live: false)
                }
            } else {
                ProgressView().controlSize(.small)
            }
            if !sent.isEmpty { Text(sent).font(.ui(13)).foregroundStyle(palette.muted) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.bottom, 14)
    }
}
