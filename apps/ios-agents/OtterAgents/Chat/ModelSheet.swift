import SwiftUI

/**
 * The agent and model a chat runs on. A chat not started yet can go to any connected agent;
 * once it has turns it stays with its agent, and the model is that agent's own setting.
 */
struct ModelSheet: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(ChatStore.self) private var store
    let chat: Chat
    @State private var query = ""

    private var agents: Agents { store.agents }
    private var current: AgentKind? { AgentKind(rawValue: chat.provider) }
    /** The agents offered: all that work here for a new chat, its own for one under way. */
    private var kinds: [AgentKind] {
        chat.isBlank ? AgentKind.allCases.filter(agents.isEnabled) : current.map { [$0] } ?? []
    }

    private func models(_ kind: AgentKind) -> [Hermes.Model] {
        // An OpenClaw chat runs in its agent's session: the agent can't change under it.
        if kind == .openclaw, let agent = chat.openClawAgent { return agents.models(of: kind).filter { $0.slug == agent } }
        let all = agents.models(of: kind)
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return needle.isEmpty ? all : all.filter { $0.name.lowercased().contains(needle) || ($0.subProvider ?? "").lowercased().contains(needle) }
    }

    private var favorites: [(AgentKind, Hermes.Model)] {
        kinds.filter(agents.isUsable).flatMap { kind in models(kind).filter { agents.isFavorite(kind, $0) }.map { (kind, $0) } }
    }

    var body: some View {
        @Bindable var agents = store.agents
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if !favorites.isEmpty {
                        group(header: { Label("Favorites", systemImage: "star.fill").labelStyle(.titleAndIcon) }) {
                            ForEach(Array(favorites.enumerated()), id: \.offset) { index, entry in
                                row(entry.0, entry.1, first: index == 0, last: index == favorites.count - 1, showAgent: kinds.count > 1)
                            }
                        }
                    }
                    ForEach(kinds) { kind in
                        let usable = agents.isUsable(kind)
                        let list = models(kind)
                        if usable ? !list.isEmpty : query.isEmpty {
                            group(header: {
                                HStack(spacing: 7) {
                                    AgentAvatar(provider: kind.rawValue, size: 15)
                                    Text(kind.name)
                                    if !usable { Text("· \(agents.statusText(kind))") }
                                }
                            }) {
                                if usable {
                                    let groups = Dictionary(grouping: list) { $0.subProvider ?? "" }
                                    let ordered = groups.keys.sorted()
                                    ForEach(ordered, id: \.self) { name in
                                        if ordered.count > 1 {
                                            HStack(spacing: 6) {
                                                if let mark = Self.mark(of: name) { AgentAvatar(provider: mark, size: 14) }
                                                Text(name)
                                            }
                                            .font(.ui(12, .medium)).foregroundStyle(palette.muted).padding(.horizontal, 32).padding(.top, 8).padding(.bottom, 4)
                                        }
                                        let rows = groups[name] ?? []
                                        ForEach(Array(rows.enumerated()), id: \.element.id) { index, model in
                                            row(kind, model, first: index == 0, last: index == rows.count - 1, showAgent: false)
                                        }
                                    }
                                } else {
                                    Text("Connect \(kind.name) in Settings to start chats on it.")
                                        .font(.ui(14)).foregroundStyle(palette.muted).padding(.horizontal, 32)
                                }
                            }
                        }
                    }
                    if let current, agents.isUsable(current) { options(current) }
                    if !chat.isBlank, let current {
                        Text("This chat runs on \(current.name). Start a new chat to switch agents.")
                            .font(.ui(13)).foregroundStyle(palette.muted).padding(.horizontal, 32)
                    }
                }
                .padding(.vertical, 12)
            }
            .background(palette.canvas)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Find a model")
            .navigationTitle("Agent and model")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done", systemImage: "checkmark") { dismiss() } }
            }
            .refreshable { await agents.checkAll() }
        }
        .presentationDragIndicator(.visible)
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

    private func row(_ kind: AgentKind, _ model: Hermes.Model, first: Bool, last: Bool, showAgent: Bool) -> some View {
        let selected = current == kind && agents.model(of: kind)?.id == model.id
        return HStack(spacing: 10) {
            Button {
                Haptics.tap()
                if chat.isBlank {
                    store.setProvider(kind, of: chat.id)
                    agents.selected = kind.rawValue
                }
                agents.choose(model: model.slug, for: kind)
            } label: {
                HStack(spacing: 8) {
                    if showAgent || kind == .openclaw { AgentAvatar(provider: kind.rawValue, agent: kind == .openclaw ? model.slug : nil, size: 20) }
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
            if kind != .varys {
                let starred = agents.isFavorite(kind, model)
                Button(starred ? "Remove from favorites" : "Add to favorites", systemImage: starred ? "star.fill" : "star") {
                    agents.toggleFavorite(kind, model)
                }
                .labelStyle(.iconOnly)
                .font(.system(size: 16))
                .foregroundStyle(starred ? palette.warning : palette.muted.opacity(0.6))
                .frame(width: 32, height: 44)
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .background(palette.card, in: UnevenRoundedRectangle(topLeadingRadius: first ? 14 : 0, bottomLeadingRadius: last ? 14 : 0,
                                                              bottomTrailingRadius: last ? 14 : 0, topTrailingRadius: first ? 14 : 0))
        .overlay(alignment: .top) { if !first { Rectangle().fill(palette.hairline).frame(height: 1).padding(.leading, 16) } }
        .padding(.horizontal, 16)
    }

    /** What the model can be told beside its name: how hard to think, and whether to hurry. */
    @ViewBuilder
    private func options(_ kind: AgentKind) -> some View {
        @Bindable var agents = store.agents
        if kind == .hermes, let model = agents.model(of: .hermes), model.reasoning || model.fast {
            group(header: { Text("Options") }) {
                VStack(spacing: 0) {
                    if model.reasoning {
                        HStack {
                            Text("Reasoning").font(.ui(16)).foregroundStyle(palette.text)
                            Spacer()
                            Picker("Reasoning", selection: $agents.hermes.reasoningEffort) {
                                ForEach(Agents.efforts(model), id: \.id) { Text($0.label).tag($0.id) }
                            }
                            .labelsHidden()
                            .tint(palette.muted)
                        }
                        .padding(.leading, 16).padding(.trailing, 6).frame(minHeight: 46)
                    }
                    if model.reasoning, model.fast { Rectangle().fill(palette.hairline).frame(height: 1).padding(.leading, 16) }
                    if model.fast {
                        Toggle("Fast", isOn: Binding(get: { agents.hermes.serviceTier == "priority" }, set: { agents.hermes.serviceTier = $0 ? "priority" : "default" }))
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
