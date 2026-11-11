import SwiftUI

/**
 * Every chat, laid out as WhatsApp's Chats: a large title, the search under it, chips for the
 * shelves (Active, Snoozed, Settled) where WhatsApp has All and Unread, then a row a chat with its
 * last message or what it's doing. ⋯ narrows the list to one agent, and selects several chats to
 * settle, mark read or delete at once.
 */
struct ChatsScreen: View {
    @Environment(\.palette) private var palette
    @Environment(ChatStore.self) private var store
    @Environment(Account.self) private var account
    var open: (String) -> Void
    var openSettings: () -> Void
    @Binding var selecting: Bool

    @State private var query = ""
    @State private var searching = false
    @AppStorage("chat-agent-filter") private var filter = ""
    /** Which shelf the list shows: active (with drafts and pinned on top), snoozed or settled. */
    @AppStorage("chat-shelf") private var shelf = "active"
    @State private var settledShown = 25
    @State private var selected: Set<String> = []
    @State private var dialog: ChatDialog?
    @State private var undo: [Chat] = []
    @State private var showSessions = false
    @State private var deleting = false

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

    private func isUnread(_ chat: Chat) -> Bool { store.unseen.contains(chat.id) || store.needsYou.contains(chat.id) }

    private var listed: [Chat] {
        store.chats.filter { !$0.isBlank && (filter.isEmpty || agentId($0) == filter) }
    }

    private var showsAgent: Bool { agents.count > 1 && filter.isEmpty }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            list(now: Int((context.date.timeIntervalSince1970 * 1000).rounded()))
        }
        .background(palette.canvas)
        .navigationTitle(selecting ? (selected.isEmpty ? "Select chats" : "\(selected.count) selected") : "Chats")
        .toolbarTitleDisplayMode(.inline)
        .toolbar {
            if selecting {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done", systemImage: "checkmark") { endSelecting() }
                        .buttonStyle(.glassProminent)
                        .tint(palette.action)
                }
            } else {
                // T3 Code's header: the app's name, small, and search; the rest behind ⋯.
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
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if searching {
                        Button("Close search", systemImage: "xmark") {
                            searching = false
                            query = ""
                        }
                    } else {
                        Button("Search chats", systemImage: "magnifyingglass") { searching = true }
                    }
                    menu
                }
            }
        }
        .toolbar(removing: selecting ? nil : .title)
        .safeAreaBar(edge: .top) {
            if searching { SearchField(prompt: "Search chats", text: $query).padding(.horizontal, 16).padding(.bottom, 6) }
        }
        .animation(.easeOut(duration: 0.18), value: searching)
        .chatDialogs($dialog)
        .confirmationDialog("Delete \(selected.count) chat\(selected.count == 1 ? "" : "s")?", isPresented: $deleting, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                for id in selected { store.delete(id) }
                endSelecting()
            }
        } message: {
            Text("They're deleted on every device.")
        }
        .sheet(isPresented: $showSessions) { SessionsSheet(open: open) }
        .overlay(alignment: .bottom) {
            if selecting {
                selectionBar.transition(.move(edge: .bottom).combined(with: .opacity))
            } else if !undo.isEmpty {
                Toast(text: undo.count == 1 ? "Settled chat" : "Settled \(undo.count) chats", action: ("Undo", {
                    let chats = undo
                    Task { for chat in chats { await store.shelve(chat.id) } }
                    undo = []
                }))
                .padding(.bottom, 8)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: undo.map(\.id)) {
                    try? await Task.sleep(for: .seconds(5))
                    withAnimation { undo = [] }
                }
            }
        }
        .animation(.easeOut(duration: 0.2), value: undo.map(\.id))
        .animation(.easeOut(duration: 0.2), value: selecting)
        .refreshable { await account.refresh() }
    }

    private var menu: some View {
        Menu("More", systemImage: "ellipsis") {
            Button("Select chats", systemImage: "checkmark.circle") { withAnimation(.easeOut(duration: 0.2)) { selecting = true } }
            if !store.unseen.isEmpty {
                Button("Read all", systemImage: "checkmark.message") { store.markSeen(store.unseen) }
            }
            if agents.count > 1 || !filter.isEmpty {
                Picker(selection: $filter) {
                    Text("All agents").tag("")
                    ForEach(agents) { agent in Text("\(agent.name) (\(agent.count))").tag(agent.id) }
                } label: {
                    Label("Agent", systemImage: "person.2")
                }
                .pickerStyle(.menu)
            }
            if !store.agents.demo, !store.agents.usable.isEmpty {
                Button("On your agents", systemImage: "tray.full") { showSessions = true }
            }
        }
    }

    @ViewBuilder
    private func list(now: Int) -> some View {
        let needle = query.trimmingCharacters(in: .whitespaces)
        let shelves = ChatShelf.shelve(listed, working: store.working, needsYou: store.needsYou, now: now)
        let shown = rows(shelves)
        List {
            if !needle.isEmpty {
                results(needle, now: now)
            } else {
                if !selecting { filters(shelves).plainRow(palette) }
                if shelf == "active", filter.isEmpty, !selecting {
                    ForEach(store.chats.filter { $0.isBlank && store.hasDraft($0.id) }.sorted { $0.createdAt > $1.createdAt }) { draft($0) }
                }
                ForEach(shelf == "settled" ? Array(shown.prefix(settledShown)) : shown) { row($0, now: now) }
                if shelf == "settled", shown.count > settledShown {
                    Button("Show \(shown.count - settledShown) more") { settledShown += 25 }
                        .font(.ui(15, .medium))
                        .foregroundStyle(palette.action)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .plainRow(palette)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 1)
        .overlay {
            if needle.isEmpty, shown.isEmpty, shelf != "active" || !store.chats.contains(where: { $0.isBlank && store.hasDraft($0.id) }) { empty }
        }
        .animation(.easeOut(duration: 0.2), value: shelf)
    }

    private func rows(_ shelves: [ChatShelf: [Chat]]) -> [Chat] {
        switch shelf {
        case "snoozed": shelves[.snoozed] ?? []
        case "settled": shelves[.settled] ?? []
        default: (shelves[.pinned] ?? []) + (shelves[.active] ?? [])
        }
    }

    /** The shelves as WhatsApp's chips: Active with how many want you, the others with how many they hold. */
    private func filters(_ shelves: [ChatShelf: [Chat]]) -> some View {
        let active = (shelves[.pinned] ?? []) + (shelves[.active] ?? [])
        return ScrollView(.horizontal) {
            HStack(spacing: 8) {
                FilterChip(text: "Active", count: active.count { isUnread($0) }, selected: shelf == "active") { shelf = "active" }
                FilterChip(text: "Snoozed", count: shelves[.snoozed]?.count ?? 0, selected: shelf == "snoozed") { shelf = "snoozed" }
                FilterChip(text: "Settled", count: shelves[.settled]?.count ?? 0, selected: shelf == "settled") { shelf = "settled" }
                if let agent = agents.first(where: { $0.id == filter }) {
                    FilterChip(text: agent.name, selected: true, avatar: agent.provider,
                               agent: agent.id.hasPrefix("openclaw:") ? String(agent.id.dropFirst(9)) : nil, removable: true) { filter = "" }
                }
            }
            .padding(.horizontal, 16)
        }
        .scrollIndicators(.hidden)
    }

    private var empty: some View {
        VStack(spacing: 8) {
            if !store.ready, account.user != nil {
                ProgressView()
            } else if shelf == "snoozed" {
                Text("Nothing snoozed").font(.ui(21, .semibold)).foregroundStyle(palette.text)
                Text("Snooze a chat to put it away until later.").font(.ui(16)).foregroundStyle(palette.muted)
            } else if shelf == "settled" {
                Text("Nothing settled").font(.ui(21, .semibold)).foregroundStyle(palette.text)
                Text("Settled chats come back when there's news in them.").font(.ui(16)).foregroundStyle(palette.muted)
            } else if !filter.isEmpty {
                Text("No active chats").font(.ui(21, .semibold)).foregroundStyle(palette.text)
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
        .padding(.top, 120)
        .frame(maxHeight: .infinity, alignment: .top)
    }

    // MARK: Rows

    private func row(_ chat: Chat, now: Int) -> some View {
        let picked = selected.contains(chat.id)
        let unread = store.unseen.contains(chat.id)
        return Button {
            if selecting {
                Haptics.tap()
                if picked { selected.remove(chat.id) } else { selected.insert(chat.id) }
            } else {
                open(chat.id)
            }
        } label: {
            HStack(spacing: 0) {
                if selecting {
                    Image(systemName: picked ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 24))
                        .foregroundStyle(picked ? palette.action : palette.muted.opacity(0.6))
                        .frame(width: 40, alignment: .leading)
                        .padding(.leading, 16)
                        .transition(.move(edge: .leading).combined(with: .opacity))
                }
                ChatRow(chat: chat, now: now, showAgent: showsAgent)
            }
            .background(picked ? palette.text.opacity(0.05) : .clear)
        }
        .buttonStyle(.plain)
        .plainRow(palette)
        .accessibilityAddTraits(picked ? .isSelected : [])
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            if selecting {
            } else if shelf == "active" {
                Button("Settle", systemImage: "archivebox") { settle([chat]) }.tint(palette.action)
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
            } else {
                Button(shelf == "snoozed" ? "Wake" : "Unsettle", systemImage: shelf == "snoozed" ? "bell" : "arrow.uturn.backward") {
                    Task { await store.shelve(chat.id) }
                }
                .tint(palette.action)
            }
        }
        .swipeActions(edge: .leading) {
            if !selecting {
                Button(unread ? "Read" : "Unread", systemImage: unread ? "checkmark.message" : "message.badge") {
                    if unread { store.markSeen([chat.id]) } else { store.markUnseen(chat.id) }
                }
                .tint(palette.focus)
                Button(chat.pinnedAt == nil ? "Pin" : "Unpin", systemImage: chat.pinnedAt == nil ? "pin" : "pin.slash") {
                    Task { await store.pin(chat.id, chat.pinnedAt == nil) }
                }
                .tint(palette.muted)
            }
        }
        .contextMenu {
            if !selecting {
                if unread {
                    Button("Mark as read", systemImage: "checkmark.message") { store.markSeen([chat.id]) }
                } else {
                    Button("Mark as unread", systemImage: "message.badge") { store.markUnseen(chat.id) }
                }
                ChatMenu(chat: chat, dialog: $dialog) { settled in withAnimation { undo = [settled] } }
            }
        } preview: {
            ChatPreview(chat: chat).environment(\.palette, palette)
        }
        // WhatsApp's menu: icons in the text's color, only Delete in red.
        .tint(palette.text)
    }

    private func draft(_ chat: Chat) -> some View {
        Button { open(chat.id) } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text("New chat").font(.ui(16, .semibold)).foregroundStyle(palette.text)
                Text("\(Text("Draft:").foregroundStyle(palette.action)) \(store.drafts[chat.id] ?? store.mail[chat.id]?.first?.subject ?? "")")
                    .font(.ui(15)).foregroundStyle(palette.muted).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 12)
            .overlay(alignment: .bottom) { RowLine() }
            .padding(.horizontal, 16)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .plainRow(palette)
        .accessibilityLabel("Unsent draft: \(store.drafts[chat.id] ?? store.mail[chat.id]?.first?.subject ?? "")")
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button("Discard", systemImage: "trash", role: .destructive) { store.discardDraft(chat.id) }
        }
        .contextMenu { Button("Discard draft", systemImage: "trash", role: .destructive) { store.discardDraft(chat.id) } }
        .tint(palette.text)
    }

    private var selectionBar: some View {
        let chats = store.chats.filter { selected.contains($0.id) }
        return GlassEffectContainer(spacing: 12) {
            HStack {
                Button("Settle") {
                    settle(chats)
                    endSelecting()
                }
                .frame(width: 110, height: 50)
                .glassEffect(.regular.interactive(), in: .capsule)
                Spacer()
                Button("Read") {
                    store.markSeen(selected)
                    endSelecting()
                }
                .disabled(!chats.contains { store.unseen.contains($0.id) })
                .frame(width: 90, height: 50)
                .glassEffect(.regular.interactive(), in: .capsule)
                Spacer()
                Button("Delete…") { deleting = true }
                    .foregroundStyle(palette.error)
                    .frame(width: 110, height: 50)
                    .glassEffect(.regular.interactive(), in: .capsule)
            }
        }
        .font(.ui(17, .medium))
        .foregroundStyle(palette.text)
        .disabled(selected.isEmpty)
        .padding(.horizontal, 20)
        .padding(.bottom, 4)
    }

    private func endSelecting() {
        selected = []
        withAnimation(.easeOut(duration: 0.2)) { selecting = false }
    }

    private func settle(_ chats: [Chat]) {
        Haptics.impact()
        Task { for chat in chats { await store.shelve(chat.id, settledAt: .now) } }
        withAnimation { undo = chats }
    }

    // MARK: Search

    /** Titles first, the best word matches on top; then chats one of whose messages says it. */
    @ViewBuilder
    private func results(_ needle: String, now: Int) -> some View {
        let words = needle.lowercased().split(separator: " ").map(String.init)
        let all = store.chats.filter { !$0.isBlank }
        let titled = all.filter { chat in words.allSatisfy { chat.title.lowercased().contains($0) } }
            .sorted { ($0.title.lowercased().hasPrefix(words[0]) ? 1 : 0, $0.updatedAt) > ($1.title.lowercased().hasPrefix(words[0]) ? 1 : 0, $1.updatedAt) }
        let said: [(Chat, ChatTurn, String)] = needle.count < 3 ? [] : all.filter { chat in !titled.contains { $0.id == chat.id } }.compactMap { chat in
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
        if !titled.isEmpty { SectionTitle(text: "Chats").plainRow(palette) }
        ForEach(titled) { chat in
            Button { open(chat.id) } label: { ChatRow(chat: chat, now: now, showAgent: showsAgent) }.buttonStyle(.plain).plainRow(palette)
        }
        if !said.isEmpty { SectionTitle(text: "Messages").plainRow(palette) }
        ForEach(said, id: \.0.id) { chat, turn, snippet in
            Button {
                store.found = ChatStore.Found(chatId: chat.id, turnId: turn.id)
                open(chat.id)
            } label: {
                ChatRow(chat: chat, now: now, showAgent: showsAgent, excerpt: "\(turn.role == .user ? "You" : "Agent"): \(snippet)")
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

private struct SectionTitle: View {
    @Environment(\.palette) private var palette
    let text: String

    var body: some View {
        Text(text).font(.ui(15, .semibold)).foregroundStyle(palette.text)
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/** WhatsApp's filter chips: All, Unread 12, Favorites, Groups. */
private struct FilterChip: View {
    @Environment(\.palette) private var palette
    let text: String
    var count = 0
    let selected: Bool
    var avatar: String?
    var agent: String?
    var removable = false
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            HStack(spacing: 5) {
                if let avatar { AgentAvatar(provider: avatar, agent: agent, size: 14) }
                Text(text).font(.ui(14, .medium)).lineLimit(1)
                if count > 0 { Text("\(count)").font(.ui(14)).monospacedDigit().opacity(0.6) }
                if removable { Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).opacity(0.6) }
            }
            .foregroundStyle(selected ? palette.text : palette.muted)
            .padding(.horizontal, 12)
            .frame(height: 32)
            .background(selected ? palette.action.opacity(0.16) : palette.text.opacity(0.06), in: .capsule)
            .frame(minHeight: 44)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(removable ? "\(text), show all agents" : count > 0 ? "\(text) (\(count))" : text)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/** WhatsApp's line between chats, from where the text starts to the edge's margin. */
private struct RowLine: View {
    @Environment(\.palette) private var palette
    @Environment(\.displayScale) private var scale

    var body: some View {
        Rectangle().fill(palette.muted.opacity(0.2)).frame(height: 1 / scale)
    }
}

/**
 * A chat as WhatsApp lists one, without the big picture: you talk to one or two agents across
 * many chats, so the words lead. The agent's mark is small, and only when there are several.
 */
struct ChatRow: View {
    @Environment(\.palette) private var palette
    @Environment(ChatStore.self) private var store
    let chat: Chat
    let now: Int
    var showAgent = false
    var excerpt: String?
    /** Snoozed: when it wakes, for the time. */
    var wakes = false

    /**
     * What a chat is doing, the most pressing first: what blocks the agent on you, then what went
     * wrong, then what runs, then what's new, then what's left. Pinned, snoozed, settled and
     * "on a Mac" sit on top of any of these.
     */
    private enum RowState {
        case approval(String)
        case question(String)
        case failed(String)
        case lost
        case compacting(queued: Int)
        case waiting(String, queued: Int)
        case working(since: Int?, queued: Int)
        case draft(String)
        case idle
    }

    private var state: RowState {
        if let approval = store.approvals(in: chat.id).first { return .approval(approval.title) }
        if let question = store.questions(in: chat.id).first { return .question(question.items.first?.question ?? "") }
        if let run = store.runs[chat.id] {
            let queued = store.queued(in: chat.id).count
            if store.isCompacting(chat.id) { return .compacting(queued: queued) }
            if let waiting = run.waitingLabel { return .waiting(waiting, queued: queued) }
            return .working(since: chat.turns.last { $0.role == .user }?.startedAt, queued: queued)
        }
        if chat.loaded, let last = chat.turns.last, let error = last.error, error != "Stopped." { return .failed(error) }
        if store.isDetached(chat) { return .lost }
        if let draft = store.drafts[chat.id], store.hasDraft(chat.id) { return .draft(draft) }
        return .idle
    }

    private var unread: Bool { store.unseen.contains(chat.id) }

    var body: some View {
        let state = state
        // T3 Code's row: the title, and one quiet line under it; what needs you stands out by color.
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(chat.title).font(.ui(17, unread ? .semibold : .regular)).foregroundStyle(palette.text).lineLimit(1)
                Spacer(minLength: 8)
                if showAgent { AgentAvatar(provider: chat.provider, agent: chat.openClawAgent, size: 14) }
                time(state)
            }
            preview(state).font(.ui(14)).lineLimit(1).padding(.trailing, 30).frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .trailing) { badges(state) }
        }
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { RowLine() }
        .padding(.horizontal, 16)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }

    /** When, as WhatsApp's time: how long it's been at it while it runs, when it wakes while snoozed, else its last message. */
    @ViewBuilder
    private func time(_ state: RowState) -> some View {
        switch state {
        case .working(let since?, _):
            TimelineView(.periodic(from: .now, by: 1)) { context in
                Text(ChatText.duration(max(0, Int(context.date.timeIntervalSince1970 * 1000) - since)))
                    .font(.ui(13, .medium)).monospacedDigit().foregroundStyle(palette.action)
            }
        case .approval, .question:
            Text(ChatText.day(chat.updatedAt, now: Date(ms: now), today: nil)).font(.ui(13, .medium)).monospacedDigit().foregroundStyle(palette.warning)
        case .failed:
            Text(ChatText.day(chat.updatedAt, now: Date(ms: now), today: nil)).font(.ui(13)).monospacedDigit().foregroundStyle(palette.error)
        default:
            if let until = chat.snoozedUntil, until > now {
                Label(ChatShelf.wakesIn(until, now), systemImage: "bell").font(.ui(13)).monospacedDigit().foregroundStyle(palette.muted)
                    .accessibilityLabel("Wakes in \(ChatShelf.wakesIn(until, now))")
            } else {
                Text(ChatText.day(chat.settledAt ?? chat.updatedAt, now: Date(ms: now), today: nil))
                    .font(.ui(13, unread ? .medium : .regular)).monospacedDigit()
                    .foregroundStyle(unread ? palette.action : palette.muted)
            }
        }
    }

    @ViewBuilder
    private func preview(_ state: RowState) -> some View {
        if let excerpt {
            Text(excerpt).foregroundStyle(palette.muted)
        } else {
            switch state {
            case .approval(let title):
                Text("\(Image(systemName: "exclamationmark.shield.fill")) \(title.isEmpty ? "Needs your approval" : "Approve: \(title)")").foregroundStyle(palette.warning)
            case .question(let question):
                Text("\(Image(systemName: "questionmark.bubble.fill")) \(question.isEmpty ? "Has a question for you" : question)").foregroundStyle(Status.input)
            case .failed(let error):
                Text("\(Image(systemName: "exclamationmark.circle.fill")) \(error)").foregroundStyle(palette.error)
            case .lost:
                Text("\(Image(systemName: "bolt.horizontal")) Lost \(AgentKind.name(of: chat.provider)) mid-reply").foregroundStyle(palette.muted)
            case .compacting(let queued):
                running("compacting context…", queued: queued)
            case .waiting(let label, let queued):
                running(label.prefix(1).lowercased() + label.dropFirst(), queued: queued)
            case .working(_, let queued):
                running("working…", queued: queued)
            case .draft(let draft):
                Text("\(Text("Draft:").foregroundStyle(palette.action)) \(draft.replacingOccurrences(of: "\n", with: " "))").foregroundStyle(palette.muted)
            case .idle:
                if let last = lastMessage {
                    lastLine(last)
                } else {
                    Text(detail).foregroundStyle(palette.muted)
                }
            }
        }
    }

    /** What runs, in the accent, as WhatsApp's "typing…": with what you've queued behind it. */
    private func running(_ text: String, queued: Int) -> some View {
        Text("\(text)\(queued > 0 ? Text(" · \(queued) queued").foregroundStyle(palette.muted) : Text(""))").foregroundStyle(palette.action)
    }

    /** The last message: yours with its ticks, the agent's (in full color while unread), or what came on its own. */
    private func lastLine(_ last: (text: String, turn: ChatTurn, answered: Bool)) -> Text {
        let color = unread ? palette.text : palette.muted
        if last.turn.role == .user {
            return Text("\(Text(last.answered ? "✓✓" : "✓").foregroundStyle(last.answered ? palette.focus : palette.muted)) \(last.text)").foregroundStyle(color)
        }
        if last.turn.error == "Stopped." {
            return Text("\(Image(systemName: "stop.circle")) Stopped").foregroundStyle(palette.muted)
        }
        switch last.turn.delivered {
        case .automation(_, let name, _):
            return Text("\(Image(systemName: "clock")) \(name.flatMap { $0 == chat.title ? nil : "\($0): " } ?? "")\(last.text)").foregroundStyle(color)
        case .message:
            return Text("\(Image(systemName: "paperplane")) \(last.text)").foregroundStyle(color)
        case nil:
            return Text(last.text).foregroundStyle(color)
        }
    }

    @ViewBuilder
    private func badges(_ state: RowState) -> some View {
        HStack(spacing: 6) {
            if chat.isElsewhere {
                Image(systemName: "laptopcomputer").font(.system(size: 11)).foregroundStyle(palette.muted.opacity(0.7))
                    .accessibilityLabel("On \(chat.device?.name ?? "a Mac")")
            }
            if chat.pinnedAt != nil {
                Image(systemName: "pin.fill").font(.system(size: 11)).rotationEffect(.degrees(45)).foregroundStyle(palette.muted.opacity(0.7))
                    .accessibilityLabel("Pinned")
            }
            switch state {
            case .approval, .question:
                badge("exclamationmark", palette.warning).accessibilityLabel("Needs you")
            case .failed where unread:
                badge("exclamationmark", palette.error).accessibilityLabel("Failed")
            case .working, .waiting, .compacting:
                ProgressView().controlSize(.mini).tint(palette.action)
            default:
                if unread { Circle().fill(palette.action).frame(width: 10, height: 10).accessibilityLabel("Unread") }
            }
        }
    }

    private func badge(_ symbol: String, _ color: Color) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 11, weight: .heavy))
            .foregroundStyle(.white)
            .frame(width: 20, height: 20)
            .background(color, in: .circle)
    }

    /** The chat's last words, the turn that said them, and (yours) whether it was answered. */
    private var lastMessage: (text: String, turn: ChatTurn, answered: Bool)? {
        guard chat.loaded else { return nil }
        for (index, turn) in chat.turns.enumerated().reversed() {
            let text = turn.role == .user ? turn.text : turn.answer
            let flat = Self.flatten(text)
            if !flat.isEmpty || turn.error == "Stopped." { return (flat, turn, index < chat.turns.count - 1) }
        }
        return nil
    }

    /** A message on one line: Markdown's marks gone, a list's items joined by " · ". */
    static func flatten(_ text: String) -> String {
        var out = ""
        for line in text.split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            let item = trimmed.range(of: #"^([-*+]|\d+[.)])\s+"#, options: .regularExpression)
            let words = trimmed.replacingOccurrences(of: #"^(#+|[-*+]|\d+[.)]|>)\s+"#, with: "", options: .regularExpression)
            guard !words.isEmpty else { continue }
            if !out.isEmpty { out += item != nil ? " · " : " " }
            out += words
        }
        return out.replacingOccurrences(of: "**", with: "").replacingOccurrences(of: "`", with: "")
            .replacingOccurrences(of: #":\s·\s"#, with: ": ", options: .regularExpression)
    }

    /** What the chat used and made, else who runs it and where. */
    private var detail: String {
        let summary = ChatShelf.tabsSummary(chat.tabs)
        let agent = chat.openClawAgent.flatMap { slug in store.agents.models(of: .openclaw).first { $0.slug == slug }?.name } ?? AgentKind.name(of: chat.provider)
        let place = chat.device.map { "On \($0.name)" }
        return [summary.isEmpty ? agent : summary, place].compactMap(\.self).joined(separator: " · ")
    }
}

/** What touch and hold shows over the list: the chat's last messages on its wallpaper, as WhatsApp's preview does. */
struct ChatPreview: View {
    @Environment(\.palette) private var palette
    @Environment(\.colorScheme) private var scheme
    let chat: Chat

    var body: some View {
        VStack(spacing: 0) {
            Text(chat.title).font(.ui(15, .semibold)).foregroundStyle(palette.text).lineLimit(1)
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(palette.canvas)
            VStack(spacing: 6) {
                Spacer(minLength: 0)
                ForEach(chat.turns.suffix(4)) { turn in
                    let mine = turn.role == .user
                    let text = (mine ? turn.text : turn.answer).trimmingCharacters(in: .whitespacesAndNewlines)
                    if !text.isEmpty {
                        Text((try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text))
                            .font(.ui(14))
                            .foregroundStyle(palette.text)
                            .lineLimit(6)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(mine ? palette.outgoing(scheme) : palette.incoming(scheme), in: .rect(cornerRadius: 18))
                            .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
                            .padding(mine ? .leading : .trailing, 36)
                    }
                }
                if !chat.loaded || chat.turns.isEmpty {
                    Text("Open the chat to read it").font(.ui(13)).foregroundStyle(palette.muted).frame(maxWidth: .infinity)
                }
            }
            .padding(12)
            .frame(maxHeight: .infinity)
            .background { Wallpaper() }
            .clipped()
        }
        .frame(width: 320, height: 380)
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
