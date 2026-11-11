import SwiftUI

/**
 * Every chat, as T3 Code lists threads: yours to pick up first (drafts, pinned, active), then
 * what's put away (snoozed, settled) behind its heading. Shelves and their order are the Mac's
 * and the web's (`ChatShelf`).
 */
struct ChatsScreen: View {
    @Environment(\.palette) private var palette
    @Environment(ChatStore.self) private var store
    @Environment(Account.self) private var account
    var open: (String) -> Void
    var openSettings: () -> Void

    @State private var query = ""
    @State private var searching = false
    @AppStorage("chat-agent-filter") private var filter = ""
    @AppStorage("chat-shelf-snoozed") private var showSnoozed = false
    @AppStorage("chat-shelf-settled") private var showSettled = false
    @State private var settledShown = 10
    @State private var dialog: ChatDialog?
    @State private var undo: Chat?
    @State private var showSessions = false

    private struct Agent: Identifiable, Equatable {
        var id: String
        var provider: String
        var name: String
        var count: Int
    }

    /** OpenClaw's agents are each their own: a chat's is read from its session. */
    private func agentId(_ chat: Chat) -> String { chat.openClawAgent.map { "openclaw:\($0)" } ?? chat.provider }

    private var agents: [Agent] {
        let listed = store.chats.filter { !$0.isBlank }
        return Dictionary(grouping: listed, by: agentId).map { id, chats in
            let agent = chats[0].openClawAgent
            let name = agent.flatMap { slug in store.agents.models(of: .openclaw).first { $0.slug == slug }?.name } ?? AgentKind.name(of: chats[0].provider)
            return Agent(id: id, provider: chats[0].provider, name: name, count: chats.count)
        }.sorted { ($0.count, $1.name) > ($1.count, $0.name) }
    }

    private var listed: [Chat] {
        store.chats.filter { !$0.isBlank && (filter.isEmpty || agentId($0) == filter) }
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            list(now: Int((context.date.timeIntervalSince1970 * 1000).rounded()))
        }
        .background(palette.canvas)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                HStack(spacing: 5) {
                    Text("Otter").foregroundStyle(palette.text)
                    Text("Agents").foregroundStyle(palette.muted)
                }
                .font(.ui(21, .medium))
                .tracking(-0.5)
                .fixedSize()
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
            }
            .sharedBackgroundVisibility(.hidden)
            ToolbarItem(placement: .topBarTrailing) {
                if searching {
                    Button("Close search", systemImage: "xmark") {
                        searching = false
                        query = ""
                    }
                } else {
                    Button("Search chats", systemImage: "magnifyingglass") { searching = true }
                }
            }
        }
        .safeAreaBar(edge: .top) {
            if searching { SearchField(prompt: "Search chats", text: $query).padding(.horizontal, 16).padding(.bottom, 6) }
        }
        .animation(.easeOut(duration: 0.18), value: searching)
        .toolbarTitleDisplayMode(.inline)
        .chatDialogs($dialog)
        .sheet(isPresented: $showSessions) { SessionsSheet(open: open) }
        .overlay(alignment: .bottom) {
            if let undo {
                Toast(text: "Settled chat", action: ("Undo", {
                    Task { await store.shelve(undo.id) }
                    self.undo = nil
                }))
                .padding(.bottom, 84)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: undo.id) {
                    try? await Task.sleep(for: .seconds(5))
                    withAnimation { self.undo = nil }
                }
            }
        }
        .animation(.easeOut(duration: 0.2), value: undo?.id)
        .refreshable { await account.refresh() }
    }

    @ViewBuilder
    private func list(now: Int) -> some View {
        let needle = query.trimmingCharacters(in: .whitespaces)
        List {
            if !needle.isEmpty {
                results(needle, now: now)
            } else {
                let shelves = ChatShelf.shelve(listed, working: store.working, needsYou: store.needsYou, now: now)
                if agents.count > 1 || !filter.isEmpty || !store.agents.usable.isEmpty { filters.plainRow(palette) }
                let drafts = store.chats.filter { $0.isBlank && store.hasDraft($0.id) }.sorted { $0.createdAt > $1.createdAt }
                if !drafts.isEmpty {
                    ShelfHeader(title: "Unsent", count: nil, open: nil).plainRow(palette)
                    ForEach(drafts) { draft(_: $0) }
                }
                ForEach(shelves[.pinned] ?? []) { card($0, shelf: .pinned, now: now) }
                ForEach(shelves[.active] ?? []) { card($0, shelf: .active, now: now) }
                let snoozed = shelves[.snoozed] ?? []
                if !snoozed.isEmpty {
                    ShelfHeader(title: "Snoozed", count: snoozed.count, open: $showSnoozed).plainRow(palette)
                    if showSnoozed { ForEach(snoozed) { slim($0, shelf: .snoozed, now: now) } }
                }
                let settled = shelves[.settled] ?? []
                if !settled.isEmpty {
                    ShelfHeader(title: "Settled", count: settled.count, open: $showSettled).plainRow(palette)
                    if showSettled {
                        ForEach(settled.prefix(settledShown)) { slim($0, shelf: .settled, now: now) }
                        if settled.count > settledShown {
                            Button { settledShown += 25 } label: {
                                Text("Show more (\(settled.count - settledShown) settled hidden)")
                                    .font(.ui(13, .medium))
                                    .foregroundStyle(palette.muted)
                                    .frame(maxWidth: .infinity, minHeight: 36)
                                    .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(palette.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])) }
                                    .padding(.horizontal, 16)
                                    .padding(.top, 8)
                            }
                            .buttonStyle(.plain)
                            .plainRow(palette)
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .contentMargins(.bottom, 96, for: .scrollContent)
        .environment(\.defaultMinListRowHeight, 1)
        .overlay { if needle.isEmpty, listed.isEmpty, !store.chats.contains(where: { $0.isBlank && store.hasDraft($0.id) }) { empty } }
        .animation(.easeOut(duration: 0.2), value: showSnoozed)
        .animation(.easeOut(duration: 0.2), value: showSettled)
    }

    private var filters: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                Menu {
                    Picker("Agent", selection: $filter) {
                        Text("All agents").tag("")
                        ForEach(agents) { agent in Text("\(agent.name) (\(agent.count))").tag(agent.id) }
                    }
                } label: {
                    let chosen = agents.first { $0.id == filter }
                    Chip(text: chosen?.name ?? "All agents", selected: chosen != nil, avatar: chosen?.provider,
                         agent: chosen.flatMap { $0.id.hasPrefix("openclaw:") ? String($0.id.dropFirst(9)) : nil })
                }
                if !filter.isEmpty {
                    Button("Show all agents", systemImage: "xmark.circle.fill") { filter = "" }
                        .labelStyle(.iconOnly)
                        .font(.system(size: 18))
                        .foregroundStyle(palette.muted)
                }
                if !store.agents.demo, !store.agents.usable.isEmpty {
                    Button { showSessions = true } label: { Chip(text: "On your agents", selected: false, avatar: nil, chevron: false) }
                        .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 2)
            .padding(.bottom, 10)
        }
        .scrollIndicators(.hidden)
    }

    private var empty: some View {
        VStack(spacing: 8) {
            if !store.ready, account.user != nil {
                ProgressView()
            } else if !filter.isEmpty {
                Text("No chats match").font(.ui(21, .semibold)).foregroundStyle(palette.text)
                Button("Show all agents") { filter = "" }.font(.ui(16)).foregroundStyle(palette.muted)
            } else if store.agents.usable.isEmpty, !store.agents.demo {
                Text("Connect an agent").font(.ui(21, .semibold)).foregroundStyle(palette.text)
                Text("Chats run on your agents: Otter's own, Hermes, OpenClaw or varys.")
                    .font(.ui(16)).foregroundStyle(palette.muted).multilineTextAlignment(.center)
                Button("Open Settings", action: openSettings)
                    .font(.ui(15, .semibold))
                    .foregroundStyle(palette.actionText)
                    .padding(.horizontal, 20)
                    .frame(height: 42)
                    .background(palette.action, in: .capsule)
                    .padding(.top, 8)
            } else {
                Text("No chats yet").font(.ui(21, .semibold)).foregroundStyle(palette.text)
                Text("Chats you start show up here.").font(.ui(16)).foregroundStyle(palette.muted)
            }
        }
        .frame(maxWidth: 430)
        .padding(.horizontal, 32)
        .padding(.bottom, 60)
    }

    // MARK: Rows

    private func card(_ chat: Chat, shelf: ChatShelf, now: Int) -> some View {
        Button { open(chat.id) } label: { ChatRow(chat: chat, now: now) }
            .buttonStyle(.plain)
            .plainRow(palette)
            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                Button("Settle", systemImage: "checkmark") { settle(chat) }.tint(palette.action)
                snooze(chat)
            }
            .swipeActions(edge: .leading) {
                Button(chat.pinnedAt == nil ? "Pin" : "Unpin", systemImage: chat.pinnedAt == nil ? "pin" : "pin.slash") {
                    Task { await store.pin(chat.id, chat.pinnedAt == nil) }
                }
                .tint(palette.muted)
            }
            .contextMenu { ChatMenu(chat: chat, dialog: $dialog) { undo = $0 } }
    }

    private func slim(_ chat: Chat, shelf: ChatShelf, now: Int) -> some View {
        Button { open(chat.id) } label: { SlimChatRow(chat: chat, snoozed: shelf == .snoozed, now: now) }
            .buttonStyle(.plain)
            .plainRow(palette)
            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                Button(shelf == .snoozed ? "Wake" : "Unsettle", systemImage: shelf == .snoozed ? "clock" : "arrow.uturn.backward") {
                    Task { await store.shelve(chat.id) }
                }
                .tint(palette.action)
            }
            .contextMenu { ChatMenu(chat: chat, dialog: $dialog) { undo = $0 } }
    }

    private func draft(_ chat: Chat) -> some View {
        Button { open(chat.id) } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                AgentAvatar(provider: chat.provider, agent: store.agents.agent(of: chat), size: 20).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 4 }
                Text(store.drafts[chat.id] ?? store.mail[chat.id]?.first?.subject ?? "").font(.ui(16, .medium)).foregroundStyle(palette.text).lineLimit(2)
                Spacer(minLength: 8)
                Label("Draft", systemImage: "square.and.pencil").font(.ui(13, .bold)).foregroundStyle(palette.warning)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .contentShape(.rect)
            .overlay(alignment: .bottom) { Rectangle().fill(palette.hairline).frame(height: 1).padding(.leading, 18) }
        }
        .buttonStyle(.plain)
        .plainRow(palette)
        .accessibilityLabel("Unsent draft: \(store.drafts[chat.id] ?? store.mail[chat.id]?.first?.subject ?? "")")
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button("Discard", systemImage: "trash", role: .destructive) { store.discardDraft(chat.id) }
        }
        .contextMenu { Button("Discard draft", systemImage: "trash", role: .destructive) { store.discardDraft(chat.id) } }
    }

    private func snooze(_ chat: Chat) -> some View {
        Menu {
            ForEach(ChatShelf.snoozePresets()) { preset in
                Button { Task { await store.shelve(chat.id, snoozedUntil: preset.until) } } label: {
                    Text(preset.label)
                    Text(preset.when)
                }
            }
        } label: {
            Label("Snooze", systemImage: "clock")
        }
        .tint(palette.muted)
    }

    private func settle(_ chat: Chat) {
        Haptics.impact()
        Task { await store.shelve(chat.id, settledAt: .now) }
        withAnimation { undo = chat }
    }

    // MARK: Search

    /** Titles first, the best word matches on top; then chats one of whose messages says it. */
    @ViewBuilder
    private func results(_ needle: String, now: Int) -> some View {
        let words = needle.lowercased().split(separator: " ").map(String.init)
        let titled = listed.filter { chat in words.allSatisfy { chat.title.lowercased().contains($0) } }
            .sorted { ($0.title.lowercased().hasPrefix(words[0]) ? 1 : 0, $0.updatedAt) > ($1.title.lowercased().hasPrefix(words[0]) ? 1 : 0, $1.updatedAt) }
        let said: [(Chat, ChatTurn, String)] = needle.count < 3 ? [] : listed.filter { chat in !titled.contains { $0.id == chat.id } }.compactMap { chat in
            for turn in chat.turns.reversed() {
                let text = turn.role == .user ? turn.text : turn.items.compactMap(\.text).joined(separator: " ")
                if let range = text.range(of: needle, options: [.caseInsensitive, .diacriticInsensitive]) {
                    let start = text.index(range.lowerBound, offsetBy: -30, limitedBy: text.startIndex) ?? text.startIndex
                    let snippet = (start > text.startIndex ? "…" : "") + text[start...].prefix(120).replacingOccurrences(of: "\n", with: " ")
                    return (chat, turn, snippet)
                }
            }
            return nil
        }
        ForEach(titled) { chat in
            Button { open(chat.id) } label: { ChatRow(chat: chat, now: now) }.buttonStyle(.plain).plainRow(palette)
        }
        ForEach(said, id: \.0.id) { chat, turn, snippet in
            Button {
                store.found = ChatStore.Found(chatId: chat.id, turnId: turn.id)
                open(chat.id)
            } label: {
                ChatRow(chat: chat, now: now, excerpt: "\(turn.role == .user ? "You" : "Agent"): \(snippet)")
            }
            .buttonStyle(.plain)
            .plainRow(palette)
        }
        if titled.isEmpty, said.isEmpty {
            VStack(spacing: 6) {
                Text("No results").font(.ui(21, .semibold)).foregroundStyle(palette.text)
                Text("No chats matching “\(needle)”").font(.ui(16)).foregroundStyle(palette.muted)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 80)
            .plainRow(palette)
        }
    }
}

private extension View {
    func plainRow(_ palette: Palette) -> some View {
        listRowInsets(EdgeInsets()).listRowSeparator(.hidden).listRowBackground(palette.canvas)
    }
}

/** The search field under the title, with the keyboard up as it arrives. */
struct SearchField: View {
    @Environment(\.palette) private var palette
    let prompt: String
    @Binding var text: String
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .medium)).foregroundStyle(palette.muted)
            TextField(prompt, text: $text)
                .font(.ui(16))
                .foregroundStyle(palette.text)
                .focused($focused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
        }
        .padding(.horizontal, 14)
        .frame(height: 44)
        .glassEffect(.regular, in: .capsule)
        .onAppear { focused = true }
    }
}

struct Chip: View {
    @Environment(\.palette) private var palette
    let text: String
    var selected = false
    var avatar: String?
    var agent: String?
    var chevron = true

    var body: some View {
        HStack(spacing: 6) {
            if let avatar { AgentAvatar(provider: avatar, agent: agent, size: 14) }
            Text(text).font(.ui(14, .medium)).lineLimit(1)
            if chevron { Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)) }
        }
        .foregroundStyle(selected ? palette.text : palette.muted)
        .padding(.horizontal, 12)
        .frame(minHeight: 30)
        .frame(maxWidth: 200)
        .glassEffect(selected ? .regular.tint(palette.text.opacity(0.12)).interactive() : .regular.interactive(), in: .rect(cornerRadius: 14))
    }
}

private struct ShelfHeader: View {
    @Environment(\.palette) private var palette
    let title: String
    let count: Int?
    let open: Binding<Bool>?

    var body: some View {
        Button {
            Haptics.tap()
            open?.wrappedValue.toggle()
        } label: {
            HStack(spacing: 9) {
                Text(open?.wrappedValue == false ? "\(title)\(count.map { " (\($0))" } ?? "")" : title)
                    .font(.ui(13, .medium))
                    .foregroundStyle(palette.tertiary)
                Rectangle().fill(palette.hairline).frame(height: 1)
                if let open {
                    Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(palette.tertiary)
                        .rotationEffect(.degrees(open.wrappedValue ? 180 : 0))
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 14)
            .padding(.bottom, 5)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(open == nil)
    }
}

/** A chat as the list shows it: who runs it and what it's called, then what it's doing or what it made. */
struct ChatRow: View {
    @Environment(\.palette) private var palette
    @Environment(ChatStore.self) private var store
    let chat: Chat
    let now: Int
    var excerpt: String?

    private enum State {
        case approval, question, working, waiting, failed, unseen
    }

    private var state: State? {
        if !store.approvals(in: chat.id).isEmpty { return .approval }
        if !store.questions(in: chat.id).isEmpty { return .question }
        if let run = store.runs[chat.id] { return run.waiting == nil ? .working : .waiting }
        if chat.loaded, let last = chat.turns.last, last.error != nil, last.error != "Stopped." { return .failed }
        if store.unseen.contains(chat.id) { return .unseen }
        return nil
    }

    private var running: Bool { state == .working || state == .waiting }

    /** What the chat used and made, else who runs it and where. */
    private var detail: String {
        let summary = ChatShelf.tabsSummary(chat.tabs)
        let agent = chat.openClawAgent.flatMap { slug in store.agents.models(of: .openclaw).first { $0.slug == slug }?.name } ?? AgentKind.name(of: chat.provider)
        let place = chat.device.map { "On \($0.name)" }
        return [summary.isEmpty ? agent : summary, place].compactMap(\.self).joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top, spacing: 8) {
                AgentAvatar(provider: chat.provider, agent: chat.openClawAgent, size: 20).padding(.top, 1.5)
                Text(chat.title)
                    .font(.ui(16, running ? .regular : .medium))
                    .foregroundStyle(palette.text)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                trailing.padding(.top, 3)
            }
            Text(excerpt ?? detail)
                .font(.ui(13))
                .foregroundStyle(palette.tertiary)
                .lineLimit(excerpt == nil ? 1 : 2)
                .padding(.leading, 28)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .opacity(running ? 0.62 : 1)
        .contentShape(.rect)
        .overlay(alignment: .bottom) { Rectangle().fill(palette.hairline).frame(height: 1).padding(.leading, 18) }
    }

    @ViewBuilder
    private var trailing: some View {
        switch state {
        case .approval: status("Approval", "exclamationmark.shield", palette.warning)
        case .question: status("Input", "questionmark.bubble", Status.input)
        case .working:
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let started = chat.turns.last { $0.role == .user }?.startedAt
                let elapsed = started.map { " \(ChatText.duration(max(0, Int(context.date.timeIntervalSince1970 * 1000) - $0)))" } ?? ""
                status("Working\(elapsed)", "circle.dashed", Status.working)
            }
        case .waiting: status("Waiting", "circle.dashed.inset.filled", palette.muted)
        case .failed: status("Failed", "exclamationmark.circle", palette.error)
        case .unseen: status("Done", "checkmark.circle", Status.done)
        case nil:
            if chat.pinnedAt != nil {
                Image(systemName: "pin").font(.system(size: 11)).foregroundStyle(palette.muted).accessibilityLabel("Pinned")
            } else {
                Text(ChatShelf.shortAgo(ChatShelf.returnedAt(chat, now), now)).font(.ui(13)).monospacedDigit().foregroundStyle(palette.tertiary)
            }
        }
    }

    private func status(_ text: String, _ symbol: String, _ color: Color) -> some View {
        HStack(spacing: 4) {
            Image(systemName: symbol).font(.system(size: 12, weight: .semibold))
            Text(text).font(.ui(13, .bold)).monospacedDigit()
        }
        .foregroundStyle(color)
        .fixedSize()
    }
}

/** A chat put away: one line, receded. */
struct SlimChatRow: View {
    @Environment(\.palette) private var palette
    let chat: Chat
    let snoozed: Bool
    let now: Int

    var body: some View {
        HStack(spacing: 8) {
            AgentAvatar(provider: chat.provider, agent: chat.openClawAgent, size: 20).opacity(0.45)
            Text(chat.title).font(.ui(16)).foregroundStyle(palette.muted).lineLimit(1)
            Spacer(minLength: 8)
            if snoozed, let until = chat.snoozedUntil {
                Label(ChatShelf.wakesIn(until, now), systemImage: "clock").font(.mono(13)).foregroundStyle(palette.tertiary)
            } else {
                Text(ChatShelf.shortAgo(chat.settledAt ?? chat.updatedAt, now)).font(.mono(13)).foregroundStyle(palette.tertiary)
            }
        }
        .padding(.horizontal, 18)
        .frame(minHeight: 44)
        .contentShape(.rect)
    }
}

/** Sessions the agents keep that aren't chats here yet (started in their own apps): open one to go on with it. */
struct SessionsSheet: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(ChatStore.self) private var store
    var open: (String) -> Void
    @State private var sessions: [AgentKind: [Hermes.Session]] = [:]
    @State private var loading = true
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List {
                ForEach(store.agents.usable) { kind in
                    let known = Set(store.chats.filter { $0.provider == kind.rawValue }.compactMap(\.sessionId))
                    let rows = (sessions[kind] ?? []).filter { session in
                        !known.contains(session.id) && (query.isEmpty || (session.title ?? session.preview ?? "").localizedCaseInsensitiveContains(query))
                    }
                    if !rows.isEmpty {
                        Section {
                            ForEach(rows) { session in
                                Button {
                                    let id = store.open(session: session, of: kind)
                                    dismiss()
                                    open(id)
                                } label: {
                                    VStack(alignment: .leading, spacing: 3) {
                                        HStack {
                                            Text(session.title ?? session.preview ?? "Untitled chat").font(.ui(16, .medium)).foregroundStyle(palette.text).lineLimit(1)
                                            Spacer()
                                            Text(ChatShelf.shortAgo(Int(session.lastActive.timeIntervalSince1970 * 1000), .now))
                                                .font(.ui(13)).foregroundStyle(palette.tertiary)
                                        }
                                        if let preview = session.preview, session.title != nil {
                                            Text(preview).font(.ui(13)).foregroundStyle(palette.muted).lineLimit(1)
                                        }
                                    }
                                }
                                .listRowBackground(Color.clear)
                            }
                        } header: {
                            Label { Text("On \(kind.name)") } icon: { AgentAvatar(provider: kind.rawValue, size: 15) }
                                .font(.ui(14, .medium))
                        }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .overlay {
                if loading { ProgressView() }
                else if sessions.values.allSatisfy(\.isEmpty) {
                    ContentUnavailableView("No other sessions", systemImage: "bubble.left.and.bubble.right",
                                           description: Text("Chats your agents keep that aren't here yet show up in this list."))
                }
            }
            .searchable(text: $query, prompt: "Search sessions")
            .navigationTitle("On your agents")
            .toolbarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close", systemImage: "xmark") { dismiss() } } }
            .task {
                for kind in store.agents.usable {
                    sessions[kind] = (try? await store.runner.sessions(of: kind)) ?? []
                }
                loading = false
            }
        }
        .presentationDragIndicator(.visible)
    }
}
