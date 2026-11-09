import SwiftUI

struct AgentView: View {
    @Environment(Session.self) private var session
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    /** Conversations to ask about (from the reader); removable before sending. */
    @State var context: [MailContext] = []
    /** An event or a task given to the agent, shown with what's sent; removable before sending. */
    @State var items: [ItemContext] = []
    /** Shown as a sheet (from a conversation) rather than in the frame. */
    var sheet = false
    var onSettings: () -> Void = {}

    @State private var draft = ""
    @State private var showHistory = false
    @FocusState private var focused: Bool

    private var agent: Agent { session.agent }

    var body: some View {
        content
            .background(palette.canvas)
            .toolbar {
                if sheet {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close", systemImage: "xmark") { dismiss() }
                    }
                }
                ToolbarItem(placement: .principal) { modelMenu }
                ToolbarItem(placement: .topBarTrailing) {
                    // The account's chats read without an agent connected here.
                    Button("Chats", systemImage: "clock.arrow.circlepath") {
                        showHistory = true
                    }
                        .disabled(agent.status != .ready && session.user == nil)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New chat", systemImage: "square.and.pencil") { agent.newChat() }
                        .disabled(agent.turns.isEmpty)
                }
            }
            .toolbarTitleDisplayMode(.inline)
            .sheet(isPresented: $showHistory) { ChatHistory() }
            .task { if agent.status == .notConfigured || agent.models.isEmpty { await agent.check() } }
    }

    @ViewBuilder
    private var content: some View {
        if !agent.turns.isEmpty && agent.status != .ready {
            conversation
        } else {
            statusContent
        }
    }

    @ViewBuilder
    private var statusContent: some View {
        switch agent.status {
        case .notConfigured:
            unavailable(
                "Connect \(agent.providerName)",
                "Connect your agent in Settings. Its chats live on the server and follow you to every device."
            )
        case .failed(let message):
            unavailable("\(agent.providerName) isn't answering", message)
        case .checking, .ready:
            conversation
        }
    }

    private func unavailable(_ title: String, _ message: String) -> some View {
        ContentUnavailableView {
            Label {
                Text(title)
            } icon: {
                Image(decorative: "OtterAgent").resizable().scaledToFit().frame(width: 44, height: 44)
            }
        } description: {
            Text(message)
        } actions: {
            Button("Open Settings") { onSettings() }
                .buttonStyle(.glass)
            if case .failed = agent.status {
                Button("Try again") { Task { await agent.check() } }
            }
        }
        .foregroundStyle(palette.text)
    }

    private var conversation: some View {
        ScrollViewReader { reader in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(agent.turns) { turn in
                        TurnView(turn: turn).id(turn.id)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 12)
            }
            .overlay {
                if agent.turns.isEmpty { welcome }
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom)
            .onChange(of: agent.turns.last?.text) {
                if let last = agent.turns.last { reader.scrollTo(last.id, anchor: .bottom) }
            }
            .safeAreaBar(edge: .bottom) {
                if let approval = agent.pendingApproval {
                    ApprovalCard(approval: approval)
                } else if let question = agent.pendingQuestion {
                    QuestionCard(question: question).id(question.id)
                } else if let readOnly = agent.readOnly {
                    Text(readOnly)
                        .font(.inter(.footnote))
                        .foregroundStyle(palette.muted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 28)
                        .padding(.vertical, 14)
                } else {
                    composer
                }
            }
        }
    }

    private var welcome: some View {
        VStack(spacing: 18) {
            Text("What can I help with?")
                .font(.inter(.title2).weight(.semibold))
                .foregroundStyle(palette.text)
            if !context.isEmpty || !items.isEmpty {
                VStack(spacing: 8) {
                    ForEach(suggestions, id: \.self) { suggestion in
                        Button(suggestion) { send(suggestion) }
                            .font(.inter(.subheadline))
                            .foregroundStyle(palette.text)
                            .padding(.horizontal, 16)
                            .frame(height: 38)
                            .background(palette.card, in: .capsule)
                            .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(.horizontal, 28)
    }

    private var suggestions: [String] {
        switch items.first?.kind {
        case .event: ["Help me prepare for this", "Draft a note to the guests"]
        case .task: ["Help me get this done", "What's the first step?"]
        case nil: ["Summarize this conversation", "Draft a reply", "What do I need to do?"]
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(items, id: \.self) { item in
                ItemContextCard(item: item) { items.removeAll { $0 == item } }
            }
            if !context.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 6) {
                        ForEach(context, id: \.self) { item in
                            HStack(spacing: 6) {
                                Image(systemName: "envelope")
                                Text(item.subject).lineLimit(1)
                                Button("Remove", systemImage: "xmark") { context.removeAll { $0 == item } }
                                    .labelStyle(.iconOnly)
                                    .font(.inter(.caption).weight(.bold))
                            }
                            .font(.inter(.subheadline))
                            .foregroundStyle(palette.text)
                            .padding(.horizontal, 12)
                            .frame(height: 32, alignment: .leading)
                            .frame(maxWidth: 260, alignment: .leading)
                            .glassEffect(.regular, in: .capsule)
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
            HStack(alignment: .bottom, spacing: 10) {
                TextField(agent.running ? (agent.selected == "openrouter" ? "Agent is working…" : "Steer \(agent.providerName)…") : "Ask \(agent.providerName)", text: $draft, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($focused)
                    .disabled(agent.running && agent.selected == "openrouter")
                    .foregroundStyle(palette.text)
                    .padding(.vertical, 8)
                    .onSubmit { send(draft) }
                if agent.running && (draft.isEmpty || agent.selected == "openrouter") {
                    Button("Stop", systemImage: "stop.fill") { agent.stop() }
                        .labelStyle(.iconOnly)
                        .font(.system(size: 13))
                        .foregroundStyle(palette.actionText)
                        .frame(width: 34, height: 34)
                        .background(palette.action, in: .circle)
                } else {
                    Button("Send", systemImage: "arrow.up") { send(draft) }
                        .labelStyle(.iconOnly)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(palette.actionText)
                        .frame(width: 34, height: 34)
                        .background(palette.action, in: .circle)
                        .opacity(draft.trimmingCharacters(in: .whitespaces).isEmpty ? 0.35 : 1)
                        .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .padding(.leading, 18)
            .padding(.trailing, 8)
            .padding(.vertical, 6)
            .glassEffect(.regular, in: .rect(cornerRadius: 26))
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
    }

    private func send(_ text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !(agent.running && agent.selected == "openrouter") else { return }
        agent.send(text, context: agent.turns.isEmpty ? context : [], items: agent.turns.isEmpty ? items : [])
        if agent.turns.count <= 2 {
            context = []
            items = []
        }
        draft = ""
    }

    private var modelMenu: some View {
        @Bindable var agent = session.agent
        let model = agent.model
        return Menu {
            let groups = Dictionary(grouping: agent.models) { $0.subProvider ?? agent.providerName }
            ForEach(groups.keys.sorted(), id: \.self) { group in
                Section(group) {
                    ForEach(groups[group] ?? []) { m in
                        Button {
                            agent.chosenModel = m.slug
                        } label: {
                            if m.id == model?.id { Label(m.name, systemImage: "checkmark") } else { Text(m.name) }
                        }
                    }
                }
            }
            if let model, model.reasoning {
                Picker("Reasoning", systemImage: "brain", selection: $agent.hermes.reasoningEffort) {
                    ForEach(Self.efforts(model), id: \.0) { Text($0.1).tag($0.0) }
                }
                .pickerStyle(.menu)
            }
            if let model, model.fast {
                Toggle("Fast", systemImage: "hare", isOn: Binding(
                    get: { agent.hermes.serviceTier == "priority" },
                    set: { agent.hermes.serviceTier = $0 ? "priority" : "default" }
                ))
            }
        } label: {
            HStack(spacing: 4) {
                Text(agent.providerName).foregroundStyle(palette.text)
                if let model { Text(model.shortName).foregroundStyle(palette.muted).lineLimit(1) }
                Image(systemName: "chevron.down")
                    .font(.inter(.caption).weight(.semibold))
                    .foregroundStyle(palette.muted)
            }
            .font(.inter(.headline))
            .frame(maxWidth: 230)
        }
        .disabled(agent.models.isEmpty)
    }

    static func efforts(_ model: Hermes.Model) -> [(String, String)] {
        [("", "Default")] + (model.canDisableReasoning ? [("none", "Off")] : [])
            + [("minimal", "Minimal"), ("low", "Low"), ("medium", "Medium"), ("high", "High"), ("xhigh", "Extra High")]
    }
}

private struct TurnView: View {
    @Environment(Session.self) private var session
    @Environment(\.palette) private var palette
    let turn: Agent.Turn

    var body: some View {
        switch turn.role {
        case .user:
            VStack(alignment: .trailing, spacing: 6) {
                if !turn.context.isEmpty {
                    Label(turn.context.count > 1 ? "\(turn.context.count) conversations" : turn.context[0], systemImage: "envelope")
                        .font(.inter(.caption))
                        .foregroundStyle(palette.muted)
                        .lineLimit(1)
                }
                Text(turn.text)
                    .foregroundStyle(palette.text)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(palette.card, in: .rect(cornerRadius: 22))
                    .textSelection(.enabled)
                if let error = turn.error {
                    Text(error).font(.inter(.caption)).foregroundStyle(palette.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.leading, 48)
        case .agent:
            VStack(alignment: .leading, spacing: 10) {
                if !turn.tools.isEmpty {
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(turn.tools) { tool in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(tool.name).font(.caption.monospaced()).foregroundStyle(palette.text)
                                    if let output = tool.output {
                                        Text(output).font(.caption2.monospaced()).foregroundStyle(palette.muted).lineLimit(4)
                                    }
                                }
                            }
                        }
                        .padding(.top, 4)
                    } label: {
                        Label("Used \(turn.tools.count) tool\(turn.tools.count == 1 ? "" : "s")", systemImage: "wrench.and.screwdriver")
                            .font(.inter(.footnote))
                            .foregroundStyle(palette.muted)
                    }
                    .tint(palette.muted)
                }
                if turn.text.isEmpty && turn.error == nil && turn.approval == nil && session.agent.running {
                    ProgressView().controlSize(.small)
                }
                if !turn.text.isEmpty {
                    Text(Self.markdown(turn.text))
                        .foregroundStyle(palette.text)
                        .lineSpacing(3)
                        .textSelection(.enabled)
                        .tint(palette.focus)
                }
                if let error = turn.error {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.inter(.footnote))
                        .foregroundStyle(palette.error)
                }
                if let note = turn.note {
                    Text(note).font(.inter(.footnote)).foregroundStyle(palette.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    static func markdown(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }
}

private struct QuestionCard: View {
    @Environment(Session.self) private var session
    @Environment(\.palette) private var palette
    let question: OpenClaw.Question
    @State private var chosen: [String: [String]] = [:]
    @State private var own: [String: String] = [:]

    private var secret: Bool { question.items.contains(where: \.secret) }
    private var quick: Bool { question.items.count == 1 && !question.items[0].multiSelect && !secret }
    private var answers: [String: [String]] {
        Dictionary(uniqueKeysWithValues: question.items.map { item in
            let typed = (own[item.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return (item.id, (chosen[item.id] ?? []) + (typed.isEmpty ? [] : [typed]))
        })
    }
    private var complete: Bool { !secret && question.items.allSatisfy { answers[$0.id]?.isEmpty == false } }

    var body: some View {
        let agent = session.agent
        VStack(alignment: .leading, spacing: 12) {
            Label("\(agent.providerName) asks", systemImage: "questionmark.bubble")
                .font(.inter(.caption))
                .foregroundStyle(palette.muted)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(question.items) { item in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(item.question).foregroundStyle(palette.text)
                            if item.secret {
                                Text("This asks for a secret, which only goes through OpenClaw's own app.")
                                    .font(.inter(.footnote)).foregroundStyle(palette.muted)
                            } else {
                                if item.multiSelect {
                                    Text("Choose any that apply.").font(.inter(.caption)).foregroundStyle(palette.muted)
                                }
                                ForEach(item.options, id: \.label) { option in
                                    let on = chosen[item.id]?.contains(option.label) == true
                                    Button {
                                        choose(item, option.label)
                                    } label: {
                                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                                            Image(systemName: on ? (item.multiSelect ? "checkmark.square.fill" : "largecircle.fill.circle") : (item.multiSelect ? "square" : "circle"))
                                                .foregroundStyle(on ? palette.action : palette.muted)
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(option.label).foregroundStyle(palette.text)
                                                if let description = option.description {
                                                    Text(description).font(.inter(.footnote)).foregroundStyle(palette.muted)
                                                }
                                            }
                                            Spacer(minLength: 0)
                                        }
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 8)
                                        .background(palette.canvas, in: .rect(cornerRadius: 12))
                                    }
                                    .buttonStyle(.plain)
                                }
                                TextField("Or answer in your own words", text: Binding(
                                    get: { own[item.id] ?? "" },
                                    set: { value in
                                        own[item.id] = value
                                        if !item.multiSelect, !value.isEmpty { chosen[item.id] = [] }
                                    }
                                ))
                                .font(.inter(.subheadline))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(palette.canvas, in: .rect(cornerRadius: 12))
                            }
                        }
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxHeight: 360)
            HStack(spacing: 8) {
                Spacer()
                Button("Skip") { agent.answer(question, nil) }
                    .buttonStyle(.bordered)
                if !secret {
                    Button("Answer") { agent.answer(question, answers) }
                        .buttonStyle(.borderedProminent)
                        .tint(palette.action)
                        .foregroundStyle(palette.actionText)
                        .disabled(!complete)
                }
            }
            .buttonBorderShape(.capsule)
            .tint(palette.text)
            .font(.inter(.subheadline).weight(.medium))
        }
        .padding(16)
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
    }

    private func choose(_ item: OpenClaw.Question.Item, _ label: String) {
        if quick { return session.agent.answer(question, [item.id: [label]]) }
        var current = chosen[item.id] ?? []
        if item.multiSelect {
            if let i = current.firstIndex(of: label) { current.remove(at: i) } else { current.append(label) }
        } else {
            current = [label]
            own[item.id] = ""
        }
        chosen[item.id] = current
    }
}

/**
 * An agent asking before it acts, ChatGPT's way (the desktop's approval-card):
 * in the composer's place, "Allow Hermes to …?", exactly what will happen, and
 * Deny or Allow once; allowing it for the rest of the chat is behind "…".
 */
private struct ApprovalCard: View {
    @Environment(Session.self) private var session
    @Environment(\.palette) private var palette
    let approval: Agent.Approval

    private static let more = ["session": "Allow for this chat", "always": "Always allow"]

    var body: some View {
        let agent = session.agent
        VStack(alignment: .leading, spacing: 12) {
            Label("Permissions", systemImage: "hand.raised")
                .font(.inter(.caption))
                .foregroundStyle(palette.muted)
            VStack(alignment: .leading, spacing: 6) {
                Text(approval.question)
                    .foregroundStyle(palette.text)
                if let detail = approval.detail, approval.isCommand {
                    Text(detail)
                        .font(.footnote.monospaced())
                        .foregroundStyle(palette.text)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(palette.canvas, in: .rect(cornerRadius: 10))
                }
                if let note = [approval.reason, approval.isCommand ? nil : approval.detail].compactMap(\.self).first {
                    Text(note).font(.inter(.footnote)).foregroundStyle(palette.muted)
                }
            }
            HStack(spacing: 8) {
                Spacer()
                let extra = approval.choices.filter { Self.more[$0] != nil }
                if !extra.isEmpty {
                    Menu {
                        ForEach(extra, id: \.self) { choice in
                            Button(Self.more[choice]!) { agent.answer(approval, choice) }
                        }
                    } label: {
                        Image(systemName: "ellipsis").frame(width: 34, height: 34)
                    }
                    .foregroundStyle(palette.muted)
                }
                Button("Deny") { agent.answer(approval, "deny") }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)
                Button("Allow once") { agent.answer(approval, "once") }
                    .buttonStyle(.borderedProminent)
                    .tint(palette.action)
                    .foregroundStyle(palette.actionText)
                    .keyboardShortcut(.defaultAction)
            }
            .buttonBorderShape(.capsule)
            .tint(palette.text)
            .font(.inter(.subheadline).weight(.medium))
        }
        .padding(16)
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
    }
}

struct ChatHistory: View {
    @Environment(Session.self) private var session
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        let agent = session.agent
        let matches = { (text: String?) in query.isEmpty || (text ?? "").localizedCaseInsensitiveContains(query) }
        let synced = agent.synced.filter { matches($0.title) }
        let linked = Set(agent.synced.filter { $0.provider == agent.selected }.compactMap(\.sessionId))
        let sessions = agent.history.filter { !linked.contains($0.id) && (matches($0.title) || matches($0.preview)) }
        NavigationStack {
            List {
                Section {
                    ForEach(synced) { chat in
                        Button {
                            Task { await agent.open(synced: chat) }
                            dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Text(chat.title).foregroundStyle(palette.text).lineLimit(1)
                                    Spacer()
                                    Text(RelativeTime.short(chat.updatedAt))
                                        .font(.inter(.subheadline))
                                        .foregroundStyle(palette.muted)
                                }
                                Text(chat.device.map { "\(chat.providerName) on \($0)" } ?? chat.providerName)
                                    .font(.inter(.subheadline))
                                    .foregroundStyle(palette.muted)
                                    .lineLimit(1)
                            }
                        }
                        .listRowBackground(palette.canvas)
                        .swipeActions {
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                Task { await agent.delete(synced: chat) }
                            }
                        }
                    }
                }
                if !sessions.isEmpty {
                    Section {
                        ForEach(sessions) { chat in
                            Button {
                                Task { await agent.open(chat) }
                                dismiss()
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack {
                                        Text(chat.title ?? chat.preview ?? "Untitled chat")
                                            .foregroundStyle(palette.text)
                                            .lineLimit(1)
                                        Spacer()
                                        Text(RelativeTime.short(chat.lastActive))
                                            .font(.inter(.subheadline))
                                            .foregroundStyle(palette.muted)
                                    }
                                    if let preview = chat.preview, chat.title != nil {
                                        Text(preview).font(.inter(.subheadline)).foregroundStyle(palette.muted).lineLimit(1)
                                    }
                                }
                            }
                            .listRowBackground(palette.canvas)
                            .swipeActions {
                                Button("Delete", systemImage: "trash", role: .destructive) {
                                    Task { await agent.delete(chat) }
                                }
                            }
                        }
                    } header: {
                        Text("On \(agent.providerName)").sectionHeader()
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(palette.canvas)
            .overlay {
                if synced.isEmpty && sessions.isEmpty {
                    ContentUnavailableView("No chats", systemImage: "bubble.left.and.bubble.right")
                }
            }
            .searchable(text: $query, prompt: "Search chats")
            .navigationTitle("Chats")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
            }
            .task {
                await agent.loadSynced()
                await agent.loadHistory()
            }
        }
    }

}

/**
 * An event or a task about to be given to the agent: what it is in a few
 * lines, and the text the agent receives, folded away until asked for.
 */
private struct ItemContextCard: View {
    @Environment(\.palette) private var palette
    let item: ItemContext
    let onRemove: () -> Void

    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: item.kind.symbol)
                    .foregroundStyle(palette.muted)
                    .frame(width: 20)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(.inter(.subheadline).weight(.medium))
                        .foregroundStyle(palette.text)
                        .lineLimit(2)
                    if !item.summary.isEmpty {
                        Text(item.summary.joined(separator: " · "))
                            .font(.inter(.footnote))
                            .foregroundStyle(palette.muted)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 8)
                Button("Remove", systemImage: "xmark", action: onRemove)
                    .labelStyle(.iconOnly)
                    .font(.inter(.caption).weight(.bold))
                    .foregroundStyle(palette.muted)
                    .frame(width: 32, height: 32)
                    .contentShape(.rect)
                    .buttonStyle(.plain)
            }
            DisclosureGroup("What the agent receives", isExpanded: $expanded) {
                ScrollView {
                    Text(item.text)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(palette.text)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 180)
            }
            .font(.inter(.footnote))
            .foregroundStyle(palette.muted)
            .tint(palette.muted)
        }
        .padding(12)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("agent-item-context")
    }
}
