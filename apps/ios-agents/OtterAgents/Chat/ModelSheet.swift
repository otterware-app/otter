import SwiftUI

/**
 * Who a chat talks to (apps/web's agent picker). A chat not started yet can go to any of your
 * agents, each by its picture and name, an OpenClaw gateway's agents each a row of their own;
 * once it has turns it stays with its agent. Under the chosen agent come its models and how hard
 * they think, where it has a choice (a Hermes server).
 */
struct ModelSheet: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(ChatStore.self) private var store
    let chat: Chat
    var openSettings: () -> Void = {}
    @State private var query = ""

    private var agents: Agents { store.agents }
    private var current: Agent? { agents.agent(chat.provider) }
    private var needle: String { query.trimmingCharacters(in: .whitespaces).lowercased() }

    /** The agents offered: every one that's on for a new chat, its own for one under way. */
    private var offered: [Agent] {
        chat.isBlank ? agents.runnable.filter(\.enabled) : current.map { [$0] } ?? []
    }

    /** A row each, a gateway's agents each their own: a started chat runs in its gateway agent's session, which can't change under it. */
    private var choices: [(agent: Agent, gatewayAgent: Hermes.Model?)] {
        offered.flatMap { agent -> [(agent: Agent, gatewayAgent: Hermes.Model?)] in
            guard agent.kind == .openclaw else { return [(agent, nil)] }
            let own = chat.isBlank ? agent.models : agent.models.filter { $0.slug == chat.openClawAgent }
            return own.isEmpty ? [(agent, nil)] : own.map { (agent, $0) }
        }.filter { needle.isEmpty || "\($0.gatewayAgent?.name ?? "") \($0.agent.name)".lowercased().contains(needle) }
    }

    /** The models a Hermes server offers, found by the search. */
    private func models(_ agent: Agent) -> [Hermes.Model] {
        guard agent.kind != .openclaw else { return [] }
        return needle.isEmpty ? agent.models : agent.models.filter { $0.name.lowercased().contains(needle) || ($0.subProvider ?? "").lowercased().contains(needle) }
    }

    private var favorites: [(Agent, Hermes.Model)] {
        offered.filter(\.isUsable).flatMap { agent in models(agent).filter { agents.isFavorite(agent, $0) }.map { (agent, $0) } }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if offered.isEmpty { noAgents }
                    if !favorites.isEmpty {
                        group(header: { Label("Favorites", systemImage: "star.fill").labelStyle(.titleAndIcon) }) {
                            ForEach(Array(favorites.enumerated()), id: \.offset) { index, entry in
                                row(entry.0, entry.1, first: index == 0, last: index == favorites.count - 1, showAgent: true)
                            }
                        }
                    }
                    if !choices.isEmpty {
                        group(header: { Text("Agent") }) {
                            ForEach(Array(choices.enumerated()), id: \.offset) { index, choice in
                                agentRow(choice.agent, choice.gatewayAgent, first: index == 0, last: index == choices.count - 1)
                            }
                        }
                    }
                    if let current, current.isUsable, current.models.count > 1, !models(current).isEmpty {
                        let list = models(current)
                        group(header: { Text("Model") }) {
                            let groups = Dictionary(grouping: list) { $0.subProvider ?? "" }
                            let ordered = groups.keys.sorted()
                            ForEach(ordered, id: \.self) { name in
                                if ordered.count > 1 {
                                    HStack(spacing: 6) {
                                        if let mark = Self.mark(of: name) { AgentAvatar(kind: mark, size: 14) }
                                        Text(name)
                                    }
                                    .font(.ui(12, .medium)).foregroundStyle(palette.muted).padding(.horizontal, 32).padding(.top, 8).padding(.bottom, 4)
                                }
                                let rows = groups[name] ?? []
                                ForEach(Array(rows.enumerated()), id: \.element.id) { index, model in
                                    row(current, model, first: index == 0, last: index == rows.count - 1, showAgent: false)
                                }
                            }
                        }
                    }
                    if let current, current.isUsable { options(current) }
                    if !chat.isBlank, let current {
                        Text("This chat runs on \(current.name). Start a new chat to switch agents.")
                            .font(.ui(13)).foregroundStyle(palette.muted).padding(.horizontal, 32)
                    }
                }
                .padding(.vertical, 12)
            }
            .background(palette.canvas)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Find an agent or model")
            .navigationTitle(chat.isBlank ? "Agent and model" : "Model")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done", systemImage: "checkmark") { dismiss() } }
            }
            .refreshable { await agents.checkAll() }
        }
        .presentationDragIndicator(.visible)
    }

    private var noAgents: some View {
        VStack(spacing: 8) {
            Text("No agents yet").font(.ui(19, .semibold)).foregroundStyle(palette.text)
            Text("Chats run on your agents: add Hermes, OpenClaw or varys in Settings › Agents.")
                .font(.ui(15)).foregroundStyle(palette.muted).multilineTextAlignment(.center)
            Button("Open Settings") {
                dismiss()
                openSettings()
            }
            .font(.ui(15, .semibold)).foregroundStyle(palette.actionText)
            .padding(.horizontal, 20).frame(height: 42).background(palette.action, in: .capsule).padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 32)
        .padding(.top, 40)
    }

    /** The maker's mark for a group of models, where the app has it: Anthropic's Claude, OpenAI's. */
    private static func mark(of maker: String) -> String? {
        switch maker.lowercased() {
        case "anthropic": "claude"
        case "openai": "codex"
        default: nil
        }
    }

    private func group(@ViewBuilder header: () -> some View, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            header().font(.ui(14, .medium)).foregroundStyle(palette.muted).padding(.horizontal, 32)
            VStack(alignment: .leading, spacing: 0) { content() }
        }
    }

    private func card(first: Bool, last: Bool) -> some Shape {
        UnevenRoundedRectangle(topLeadingRadius: first ? 14 : 0, bottomLeadingRadius: last ? 14 : 0, bottomTrailingRadius: last ? 14 : 0, topTrailingRadius: first ? 14 : 0)
    }

    private func choose(_ agent: Agent) {
        guard chat.isBlank else { return }
        store.setAgent(agent.id, of: chat.id)
        agents.select(agent)
    }

    private func agentRow(_ agent: Agent, _ gatewayAgent: Hermes.Model?, first: Bool, last: Bool) -> some View {
        let selected = current?.id == agent.id && (gatewayAgent == nil || agents.gatewayAgent(of: chat) == gatewayAgent?.slug)
        let detail = [gatewayAgent == nil ? nil : agent.name, agent.isUsable ? nil : agent.statusText].compactMap(\.self).joined(separator: " · ")
        return Button {
            guard chat.isBlank else { return }
            Haptics.tap()
            choose(agent)
            if let gatewayAgent { agents.set(agent, "model", .string(gatewayAgent.slug)) }
        } label: {
            HStack(spacing: 10) {
                AgentAvatar(agent: agent.id, gatewayAgent: gatewayAgent?.slug, size: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text(gatewayAgent?.name ?? agent.name).font(.ui(16, .medium)).foregroundStyle(palette.text).lineLimit(1)
                    if !detail.isEmpty { Text(detail).font(.ui(13)).foregroundStyle(palette.muted).lineLimit(1) }
                }
                Spacer(minLength: 0)
                if selected { Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(palette.text) }
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 54)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .background(palette.card, in: card(first: first, last: last))
        .overlay(alignment: .top) { if !first { Rectangle().fill(palette.hairline).frame(height: 1).padding(.leading, 54) } }
        .padding(.horizontal, 16)
    }

    private func row(_ agent: Agent, _ model: Hermes.Model, first: Bool, last: Bool, showAgent: Bool) -> some View {
        let selected = current?.id == agent.id && agent.model?.id == model.id
        return HStack(spacing: 10) {
            Button {
                Haptics.tap()
                choose(agent)
                agents.set(agent, "model", .string(model.slug))
            } label: {
                HStack(spacing: 8) {
                    if showAgent { AgentAvatar(agent: agent.id, size: 20) }
                    Text(model.shortName).font(.ui(16, .medium)).foregroundStyle(palette.text).lineLimit(1)
                    if model.isDefault {
                        Text("DEFAULT").font(.ui(10, .bold)).kerning(0.5).foregroundStyle(palette.muted)
                            .padding(.horizontal, 6).frame(height: 18).background(palette.text.opacity(0.07), in: .capsule)
                    }
                    Spacer(minLength: 0)
                    if selected { Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(palette.text) }
                }
                .frame(minHeight: 46)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(selected ? .isSelected : [])
            let starred = agents.isFavorite(agent, model)
            Button(starred ? "Remove from favorites" : "Add to favorites", systemImage: starred ? "star.fill" : "star") {
                agents.toggleFavorite(agent, model)
            }
            .labelStyle(.iconOnly)
            .font(.system(size: 16))
            .foregroundStyle(starred ? palette.warning : palette.muted.opacity(0.6))
            .frame(width: 32, height: 44)
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .background(palette.card, in: card(first: first, last: last))
        .overlay(alignment: .top) { if !first { Rectangle().fill(palette.hairline).frame(height: 1).padding(.leading, 16) } }
        .padding(.horizontal, 16)
    }

    private func setting(_ agent: Agent, _ key: String) -> Binding<String> {
        Binding(get: { agent.string(key) }, set: { agents.set(agent, key, .string($0)) })
    }

    /** What the model can be told beside its name: how hard to think, and whether to hurry. */
    @ViewBuilder
    private func options(_ agent: Agent) -> some View {
        if agent.kind == .hermes, let model = agent.model, model.reasoning || model.fast {
            group(header: { Text("Options") }) {
                VStack(spacing: 0) {
                    if model.reasoning {
                        HStack {
                            Text("Reasoning").font(.ui(16)).foregroundStyle(palette.text)
                            Spacer()
                            Picker("Reasoning", selection: setting(agent, "reasoningEffort")) {
                                ForEach(Agents.efforts(model), id: \.id) { Text($0.label).tag($0.id) }
                            }
                            .labelsHidden()
                            .tint(palette.muted)
                        }
                        .padding(.leading, 16).padding(.trailing, 6).frame(minHeight: 46)
                    }
                    if model.reasoning, model.fast { Rectangle().fill(palette.hairline).frame(height: 1).padding(.leading, 16) }
                    if model.fast {
                        Toggle("Fast", isOn: Binding(get: { agent.string("serviceTier") == "priority" }, set: { agents.set(agent, "serviceTier", .string($0 ? "priority" : "default")) }))
                            .font(.ui(16)).foregroundStyle(palette.text)
                            .padding(.horizontal, 16).frame(minHeight: 46)
                    }
                }
                .background(palette.card, in: .rect(cornerRadius: 14))
                .padding(.horizontal, 16)
            }
        }
    }
}
