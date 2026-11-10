import SwiftUI

/** What a task's results do, in words. */
func deliveryText(_ delivery: ScheduledTask.Delivery) -> String {
    switch delivery {
    case .otter(let newChat): newChat ? "A new chat in Otter each time" : "Its chat in Otter"
    case .none: "Kept on the agent: not sent anywhere"
    case .webhook(let url): "Posted to a webhook (\(URL(string: url)?.host() ?? url))"
    case .elsewhere(let label): "Sent to \(label)"
    case .channel(_, let label, let to, let account):
        [label, to, account.flatMap { $0 == "default" ? nil : "as \($0)" }].compactMap(\.self).joined(separator: " · ")
    }
}

/** What the agents do on their own, on a schedule: what's coming up, what's paused, and what each agent keeps for itself. */
struct ScheduledScreen: View {
    @Environment(\.palette) private var palette
    @Environment(\.scenePhase) private var scenePhase
    @Environment(ScheduledStore.self) private var store
    var open: (String) -> Void
    var openSettings: () -> Void

    @State private var agentFilter = ""
    @State private var status = ""
    @State private var showKept: Set<String> = []

    private func matches(_ task: ScheduledTask) -> Bool {
        if !agentFilter.isEmpty, "\(task.provider):\(task.agent ?? "")" != agentFilter, task.provider != agentFilter { return false }
        switch status {
        case "active": return task.enabled
        case "paused": return !task.enabled
        case "attention": return task.failed || task.autoPaused != nil
        default: return true
        }
    }

    var body: some View {
        let mine = store.tasks.filter { $0.managedBy == nil && matches($0) }
        let active = mine.filter(\.enabled).sorted { ($0.nextRunAt ?? .max) < ($1.nextRunAt ?? .max) }
        let paused = mine.filter { !$0.enabled }
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if !store.tasks.isEmpty { filters }
                ForEach(store.agents.filter { $0.error != nil }, id: \.provider) { agent in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "exclamationmark.triangle").foregroundStyle(palette.warning)
                        Text("\(AgentKind.name(of: agent.provider)): \(agent.error ?? "")").font(.ui(14)).foregroundStyle(palette.text)
                        Spacer(minLength: 0)
                        Button("Retry") { Task { await store.refresh() } }.font(.ui(14, .semibold)).foregroundStyle(palette.text)
                    }
                    .padding(14)
                    .background(palette.card, in: .rect(cornerRadius: 16))
                    .padding(.horizontal, 18)
                }
                if !active.isEmpty { section("Active", active) }
                if !paused.isEmpty { section("Paused", paused) }
                ForEach(store.agents, id: \.provider) { agent in
                    let kept = agent.tasks.filter { $0.managedBy != nil && matches($0) }
                    if !kept.isEmpty {
                        let shown = showKept.contains(agent.provider)
                        VStack(alignment: .leading, spacing: 8) {
                            Button {
                                Haptics.tap()
                                withAnimation(.easeOut(duration: 0.18)) { if shown { showKept.remove(agent.provider) } else { showKept.insert(agent.provider) } }
                            } label: {
                                HStack(spacing: 9) {
                                    Text("Kept by \(AgentKind.name(of: agent.provider))\(shown ? "" : " (\(kept.count))")").font(.ui(13, .medium)).foregroundStyle(palette.tertiary)
                                    Rectangle().fill(palette.hairline).frame(height: 1)
                                    Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(palette.tertiary)
                                        .rotationEffect(.degrees(shown ? 180 : 0))
                                }
                                .padding(.horizontal, 18)
                                .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                            if shown { ForEach(kept) { card($0) } }
                        }
                    }
                }
            }
            .padding(.top, 4)
        }
        .contentMargins(.bottom, 96, for: .scrollContent)
        .background(palette.canvas)
        .overlay { empty(shown: !active.isEmpty || !paused.isEmpty) }
        .navigationTitle("Scheduled")
        .toolbarTitleDisplayMode(.inline)
        .refreshable { await store.refresh() }
        .task(id: scenePhase) {
            // Soon again while something runs, so its end shows.
            while scenePhase == .active, !Task.isCancelled {
                await store.refresh()
                try? await Task.sleep(for: .seconds(store.running ? 3 : 20))
            }
        }
    }

    private var filters: some View {
        let agents = Dictionary(grouping: store.tasks) { $0.provider == "openclaw" ? "openclaw:\($0.agent ?? "")" : $0.provider }
        return ScrollView(.horizontal) {
            HStack(spacing: 8) {
                Menu {
                    Picker("Agent", selection: $agentFilter) {
                        Text("All agents").tag("")
                        ForEach(agents.keys.sorted(), id: \.self) { key in
                            Text("\(store.name(of: agents[key]![0])) (\(agents[key]!.count))").tag(key)
                        }
                    }
                } label: {
                    let chosen = agents[agentFilter]?.first
                    Chip(text: chosen.map(store.name) ?? "All agents", selected: chosen != nil, avatar: chosen?.provider, agent: chosen?.agent)
                }
                Menu {
                    Picker("Status", selection: $status) {
                        Text("Any status").tag("")
                        Text("Active").tag("active")
                        Text("Paused").tag("paused")
                        Text("Needs attention").tag("attention")
                    }
                } label: {
                    Chip(text: ["active": "Active", "paused": "Paused", "attention": "Needs attention"][status] ?? "Any status", selected: !status.isEmpty)
                }
                if !agentFilter.isEmpty || !status.isEmpty {
                    Button("Show all", systemImage: "xmark.circle.fill") {
                        agentFilter = ""
                        status = ""
                    }
                    .labelStyle(.iconOnly)
                    .font(.system(size: 18))
                    .foregroundStyle(palette.muted)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 2)
        }
        .scrollIndicators(.hidden)
    }

    private func section(_ title: String, _ tasks: [ScheduledTask]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.ui(14, .medium)).foregroundStyle(palette.muted).padding(.horizontal, 26)
            ForEach(tasks) { card($0) }
        }
    }

    private func card(_ task: ScheduledTask) -> some View {
        Button { open(task.id) } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    AgentAvatar(provider: task.provider, agent: task.agent, size: 18)
                    Text(task.name).font(.ui(16, .medium)).foregroundStyle(task.enabled ? palette.text : palette.muted).lineLimit(1)
                    Spacer(minLength: 4)
                    if task.lastRun?.status == .error || task.autoPaused != nil || task.deliveryProblem != nil {
                        Image(systemName: "exclamationmark.circle").font(.system(size: 14, weight: .semibold)).foregroundStyle(palette.warning)
                            .accessibilityLabel("Needs attention")
                    }
                }
                if let preview = task.prompt ?? task.description ?? task.runs {
                    Text(preview).font(.ui(14)).foregroundStyle(palette.muted).lineLimit(2).multilineTextAlignment(.leading)
                }
                TimelineView(.periodic(from: .now, by: 30)) { _ in
                    Text(line(task)).font(.ui(13)).foregroundStyle(task.running ? Status.working : palette.tertiary).lineLimit(1)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.card, in: .rect(cornerRadius: 20))
            .padding(.horizontal, 18)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private func line(_ task: ScheduledTask) -> String {
        var parts = [store.name(of: task), task.running ? "Running" : task.enabled ? "Active" : "Paused", ScheduleText.schedule(task.schedule)]
        if let next = task.nextRunAt, task.enabled, !task.running { parts.append(ScheduleText.until(next)) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private func empty(shown: Bool) -> some View {
        if !shown, store.agents.allSatisfy({ $0.error == nil }), !store.tasks.contains(where: { $0.managedBy != nil && matches($0) }) {
            VStack(spacing: 8) {
                if !store.loaded {
                    ProgressView()
                } else if store.agents.isEmpty {
                    Text("No agent here runs tasks on a schedule").font(.ui(21, .semibold)).foregroundStyle(palette.text).multilineTextAlignment(.center)
                    Text("Connect OpenClaw, Hermes or varys, and what they run on their own shows up here.")
                        .font(.ui(16)).foregroundStyle(palette.muted).multilineTextAlignment(.center)
                    Button("Open Settings", action: openSettings)
                        .font(.ui(15, .semibold)).foregroundStyle(palette.actionText)
                        .padding(.horizontal, 20).frame(height: 42).background(palette.action, in: .capsule).padding(.top, 8)
                } else if store.tasks.isEmpty {
                    Text("Nothing scheduled yet").font(.ui(21, .semibold)).foregroundStyle(palette.text)
                    Text("Ask an agent to do something on a schedule, or make a task here.")
                        .font(.ui(16)).foregroundStyle(palette.muted).multilineTextAlignment(.center)
                } else {
                    Text("No tasks match").font(.ui(21, .semibold)).foregroundStyle(palette.text)
                    Button("Show all") {
                        agentFilter = ""
                        status = ""
                    }
                    .font(.ui(16)).foregroundStyle(palette.muted)
                }
            }
            .frame(maxWidth: 430)
            .padding(.horizontal, 32)
            .padding(.bottom, 60)
        }
    }
}
