import SwiftUI

/** One chat: the conversation under a glass header, and the composer floating over its end. */
struct ChatScreen: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(ChatStore.self) private var store
    let id: String
    var openSettings: () -> Void = {}

    @State private var position = ScrollPosition(edge: .bottom)
    @State private var following = true
    /** The conversation is moving under a finger, or on its way somewhere. */
    @State private var moving = false
    /** How many of the chat's first turns aren't drawn: a long chat opens on its latest, and the rest come as you read back up. */
    @State private var earlier: Int?
    @FocusState private var focused: Bool
    @State private var showQueue = false
    @State private var panel = false
    @State private var showDetails = false
    @State private var showModels = false
    @State private var dialog: ChatDialog?
    @State private var page: WebPage?
    @State private var file: FileLink?
    /** The chat's agent has a browser tab to watch. */
    @State private var hasBrowser = false
    @State private var showBrowser = false
    @State private var finding = false
    @State private var find = ""
    @State private var findAt = 0
    @FocusState private var findFocused: Bool

    var body: some View {
        if let chat = store.chat(id) {
            content(chat)
        } else {
            Color.clear.onAppear { dismiss() }
        }
    }

    /** How many turns a chat opens with, and how many more each step back up brings: drawing a turn costs, and a chat can have hundreds. */
    private static let page = 10

    private func skipped(_ chat: Chat) -> Int {
        if let earlier, earlier < chat.turns.count { return earlier }
        return max(0, chat.turns.count - Self.page)
    }

    /** Draws the chat from this turn on, to go to it. */
    private func reveal(_ turnId: String, in chat: Chat) {
        guard let index = chat.turns.firstIndex(where: { $0.id == turnId }), index < skipped(chat) else { return }
        earlier = index
    }

    private func content(_ chat: Chat) -> some View {
        let skipped = skipped(chat)
        return ScrollView {
            // As wide as the screen with nothing in it yet too: a stack is only as wide as what it holds.
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(chat.turns.enumerated().dropFirst(skipped)), id: \.element.id) { index, turn in
                    Group {
                        if let day = newDay(chat, index) { DayPill(text: day).padding(.bottom, 10) }
                        switch turn.role {
                        case .user: UserTurnView(turn: turn, answered: answered(chat, index), joinsAbove: index > 0 && chat.turns[index - 1].role == .user,
                                                joinsBelow: chat.turns[safe: index + 1]?.role == .user)
                        case .assistant:
                            AssistantTurnView(turn: turn, chat: chat, isLast: index == chat.turns.count - 1,
                                              continued: index > 0 && ["steer", "promoted"].contains(chat.turns[index - 1].intent ?? ""))
                        }
                    }
                    .padding(.bottom, chat.turns[safe: index + 1]?.role == turn.role ? 4 : 12)
                    .background {
                        if store.found?.turnId == turn.id { palette.focus.opacity(0.07).padding(.horizontal, -8).padding(.bottom, 10).clipShape(.rect(cornerRadius: 12)) }
                    }
                    .id(turn.id)
                }
            }
            .scrollTargetLayout()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.top, 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .simultaneousGesture(TapGesture().onEnded { if focused { focused = false } })
        .onScrollPhaseChange { _, phase in moving = phase != .idle }
        // The end is where the bars under the conversation begin: `visibleRect` runs on under them.
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.visibleRect.maxY - geometry.contentInsets.bottom >= geometry.contentSize.height - 48
        } action: { _, atEnd in
            if atEnd {
                following = true
            } else if moving {
                following = false
            } else if following {
                // Left behind by the bars or the keyboard settling, not by a scroll: a long chat opens before they do.
                position.scrollTo(edge: .bottom)
            }
        }
        .onScrollGeometryChange(for: Int.self) { geometry in
            geometry.visibleRect.minY + geometry.contentInsets.top < 1500 ? skipped : -1
        } action: { _, near in
            if near > 0 { earlier = max(0, near - Self.page) }
        }
        .onChange(of: chat.turns.last?.items) { if following { position.scrollTo(edge: .bottom) } }
        .background { Wallpaper() }
        .overlay { placeholder(chat) }
        .safeAreaBar(edge: .bottom) {
            bottom(chat).onGeometryChange(for: CGFloat.self) { $0.size.height } action: { _ in
                // What the agent asks takes the composer's place, taller: the end stays in view.
                if following { position.scrollTo(edge: .bottom) }
            }
        }
        // While ＋'s panel is open it stands where the keyboard was, and the keyboard passes over it.
        .ignoresSafeArea(panel ? .keyboard : [], edges: .bottom)
        .safeAreaBar(edge: .top) { if finding { findBar(chat) } }
        .navigationTitle(chat.isBlank ? "New chat" : chat.title)
        .toolbarTitleDisplayMode(.inline)
        .toolbar(removing: .title)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { header(chat) }
                .sharedBackgroundVisibility(.hidden)
            if !chat.isBlank {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu("More", systemImage: "ellipsis") {
                        Button("Chat details", systemImage: "info.circle") { showDetails = true }
                        Button("Find in chat", systemImage: "magnifyingglass") {
                            finding = true
                            findFocused = true
                        }
                        Divider()
                        ChatMenu(chat: chat, dialog: $dialog) { _ in dismiss() }
                    }
                    .tint(palette.text)
                }
            }
        }
        .chatDialogs($dialog) { _ in dismiss() }
        .sheet(isPresented: $showQueue) { QueueSheet(chat: chat) }
        .sheet(isPresented: $showDetails) { ChatDetails(chat: chat, open: { open($0, in: chat) }, openFile: { file = FileLink(chatId: chat.id, href: $0) }) }
        .navigationDestination(item: $file) { FileScreen(link: $0) }
        .sheet(isPresented: $showModels) { ModelSheet(chat: chat) }
        .sheet(item: $page) { SafariView(url: $0.url).ignoresSafeArea() }
        .fullScreenCover(isPresented: $showBrowser) {
            if let source = BrowserSource(chat, agents: store.agents) {
                BrowserScreen(source: source, agent: store.agents.name(of: chat.provider, agent: store.agents.agent(of: chat)),
                              working: store.runs[chat.id] != nil, activity: BrowserSource.activity(in: chat, demo: store.agents.demo))
            }
        }
        .environment(\.chatText, ChatTextActions(open: { open($0, in: chat) }, quote: canWrite(chat) ? { quote($0, from: $1) } : nil,
                                                  image: store.readsFiles(chat) ? { href in (try? await store.file(href, in: chat)).flatMap { UIImage(data: $0.data) } } : nil))
        .environment(\.chatFind, finding ? find : "")
        .task(id: id) {
            store.watched = id
            await store.sync?.load(id)
            // What the agent wrote or asks in this chat's session without this iPhone: a scheduled run, another device's turn.
            Task { await store.catchUp(id) }
            if let found = store.found, found.chatId == id, let chat = store.chat(id) {
                following = false
                reveal(found.turnId, in: chat)
                try? await Task.sleep(for: .milliseconds(250))
                withAnimation { position.scrollTo(id: found.turnId, anchor: .center) }
            }
        }
        // When the chat opens, and when its agent browses again: not on a timer.
        .task(id: "\(id) \(BrowserSource.activity(in: chat, demo: store.agents.demo))") {
            guard let source = BrowserSource(chat, agents: store.agents) else { return hasBrowser = false }
            do { hasBrowser = try await source.hasTab() } catch {}
        }
        .onDisappear {
            if store.watched == id { store.watched = nil }
            if store.found?.chatId == id { store.found = nil }
        }
    }

    /** WhatsApp's header: the chat's name, and what the agent is doing as "online" or "typing…" would be. Tap for details. */
    private func header(_ chat: Chat) -> some View {
        let (status, busy) = status(chat)
        return Button { if !chat.isBlank { showDetails = true } } label: {
            VStack(alignment: .leading, spacing: 0) {
                Text(chat.isBlank ? "New chat" : chat.title).font(.ui(16, .semibold)).foregroundStyle(palette.text).lineLimit(1)
                Text(status).font(.ui(12)).foregroundStyle(busy ? palette.action : palette.muted).lineLimit(1)
                    .contentTransition(.opacity)
            }
            .padding(.leading, 4)
            .frame(width: 210, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityHint(chat.isBlank ? "" : "Shows the chat's details")
        .accessibilityIdentifier("Chat details")
        .animation(.easeOut(duration: 0.2), value: status)
    }

    private func status(_ chat: Chat) -> (String, Bool) {
        if !store.approvals(in: chat.id).isEmpty { return ("needs your approval", true) }
        if !store.questions(in: chat.id).isEmpty { return ("has a question", true) }
        if let run = store.runs[chat.id] {
            if store.isCompacting(chat.id) { return ("compacting context…", true) }
            if let waiting = run.waitingLabel { return (waiting.prefix(1).lowercased() + waiting.dropFirst(), true) }
            return ("working…", true)
        }
        var parts = [AgentKind.name(of: chat.provider)]
        let name = store.agents.name(of: chat.provider, agent: store.agents.agent(of: chat))
        if name != parts[0] { parts.insert(name, at: 0) }
        if let device = chat.device?.name, !device.isEmpty { parts.append(device) }
        return (parts.joined(separator: " · "), false)
    }

    /** The day a turn starts, when the one before was on another. */
    private func newDay(_ chat: Chat, _ index: Int) -> String? {
        guard let at = chat.turns[index].startedAt ?? chat.turns[index].finishedAt else { return nil }
        let before = chat.turns[..<index].last { $0.startedAt != nil }?.startedAt
        if let before, Calendar.current.isDate(Date(ms: before), inSameDayAs: Date(ms: at)) { return nil }
        return ChatText.day(at)
    }

    private func answered(_ chat: Chat, _ index: Int) -> Int {
        guard let reply = chat.turns[(index + 1)...].first(where: { $0.role == .assistant }) else { return 0 }
        return reply.finishedAt != nil ? 2 : 1
    }

    /** This iPhone can go on with the chat: it isn't a Mac's own, and its agent is connected here. */
    private func canWrite(_ chat: Chat) -> Bool {
        !chat.isElsewhere && store.agents.isUsable(chat.provider)
    }

    // MARK: Around the conversation

    @ViewBuilder
    private func placeholder(_ chat: Chat) -> some View {
        if !chat.loaded || store.hydrating == chat.id {
            VStack(spacing: 10) {
                ProgressView()
                if store.hydrating == chat.id {
                    Text("Loading this session from \(AgentKind.name(of: chat.provider))…").font(.ui(14)).foregroundStyle(palette.muted)
                }
            }
        } else if chat.isBlank {
            VStack(spacing: 10) {
                Text("What can I help with?")
                    .font(.ui(26, .medium))
                    .tracking(-0.5)
                    .foregroundStyle(palette.text)
                Button { showModels = true } label: {
                    HStack(spacing: 6) {
                        AgentAvatar(provider: chat.provider, agent: store.agents.agent(of: chat), size: 18)
                        Text("with \(store.agents.name(of: chat.provider, agent: store.agents.agent(of: chat)))").font(.ui(14))
                        Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold))
                    }
                    .foregroundStyle(palette.muted)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 32)
            .padding(.bottom, 80)
        }
    }

    private func bottom(_ chat: Chat) -> some View {
        let approvals = store.approvals(in: chat.id)
        let questions = store.questions(in: chat.id)
        return VStack(spacing: 0) {
            WorkingControl(chat: chat, following: following || chat.turns.isEmpty, browser: hasBrowser ? { showBrowser = true } : nil) {
                Haptics.tap()
                withAnimation(.easeOut(duration: 0.25)) { position.scrollTo(edge: .bottom) }
            } showQueue: { showQueue = true }
            .padding(.bottom, 4)
            if let approval = approvals.first {
                ApprovalCard(chat: chat, approval: approval, count: (1, approvals.count))
            } else if let question = questions.first {
                QuestionCard(chat: chat, question: question, count: (1, questions.count)).id(question.id)
            } else if canWrite(chat) {
                Composer(chat: chat, focused: $focused, panel: $panel) {
                    // Sent: the keyboard gives the screen back to the answer.
                    focused = false
                    following = true
                    position.scrollTo(edge: .bottom)
                }
            } else {
                readOnly(chat)
            }
        }
    }

    /** Why this chat only reads here, and where it goes on. */
    private func readOnly(_ chat: Chat) -> some View {
        let name = AgentKind.name(of: chat.provider)
        return VStack(spacing: 10) {
            if chat.isElsewhere {
                Text("This chat ran in \(name) on \(chat.device?.name ?? "a Mac"). Continue it there.")
            } else if let kind = AgentKind(rawValue: chat.provider) {
                Text(store.agents.isEnabled(kind) ? "\(name) isn't connected on this iPhone." : "\(name) is turned off on this iPhone.")
                Button("Open Settings", action: openSettings)
                    .font(.ui(14, .semibold))
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .tint(palette.text)
            } else {
                Text("This chat runs on \(name), which this iPhone can't reach.")
            }
        }
        .font(.ui(14))
        .foregroundStyle(palette.muted)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 28)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity)
    }

    // MARK: Links and quotes

    private func open(_ url: URL, in chat: Chat) {
        if ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            store.openTab(.page(url: url.absoluteString), title: url.host()?.replacingOccurrences(of: "www.", with: "") ?? url.absoluteString, in: chat.id)
            page = WebPage(url: url)
        } else if ChatText.isFileLink(url.absoluteString) {
            let href = url.absoluteString.removingPercentEncoding ?? url.absoluteString
            if store.readsFiles(chat) {
                store.openTab(.file(href: href), title: (href as NSString).lastPathComponent, in: chat.id)
                file = FileLink(chatId: chat.id, href: href)
            } else {
                store.notice = "This file is where \(AgentKind.name(of: chat.provider)) runs\(chat.device.map { ", on \($0.name)" } ?? "")."
            }
        } else {
            openURL(url)
        }
    }

    private func quote(_ text: String, from: String?) {
        let quoted = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(4000))
        guard !quoted.isEmpty, store.citations[id]?.contains(where: { $0.text == quoted }) != true else { return focused = true }
        withAnimation(.easeOut(duration: 0.18)) { store.citations[id, default: []].append(ChatCitation(text: quoted, from: from)) }
        focused = true
    }

    // MARK: Find

    private func matches(_ chat: Chat) -> [String] {
        let needle = find.trimmingCharacters(in: .whitespaces)
        guard needle.count > 1 else { return [] }
        return chat.turns.filter { turn in
            let text = turn.text + " " + turn.items.map { $0.text ?? $0.step?.title ?? "" }.joined(separator: " ")
            return text.range(of: needle, options: [.caseInsensitive, .diacriticInsensitive]) != nil
        }.map(\.id)
    }

    private func show(_ turnId: String, in chat: Chat, animated: Bool) {
        store.found = ChatStore.Found(chatId: chat.id, turnId: turnId)
        following = false
        reveal(turnId, in: chat)
        // After the turn is drawn, when it wasn't yet.
        Task { withAnimation(animated ? .default : nil) { position.scrollTo(id: turnId, anchor: .center) } }
    }

    private func findBar(_ chat: Chat) -> some View {
        let found = matches(chat)
        let go = { (step: Int) in
            guard !found.isEmpty else { return }
            findAt = (findAt + step + found.count) % found.count
            show(found[findAt], in: chat, animated: true)
        }
        return HStack(spacing: 4) {
            Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundStyle(palette.muted)
            TextField("Find in chat", text: $find)
                .font(.ui(15))
                .focused($findFocused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onSubmit {
                    go(1)
                    findFocused = true
                }
            if find.trimmingCharacters(in: .whitespaces).count > 1 {
                Text(found.isEmpty ? "No results" : "\(min(findAt, found.count - 1) + 1)/\(found.count)")
                    .font(.ui(13)).monospacedDigit().foregroundStyle(palette.muted)
            }
            Button("Previous", systemImage: "chevron.up") { go(-1) }.disabled(found.isEmpty)
            Button("Next", systemImage: "chevron.down") { go(1) }.disabled(found.isEmpty)
            Button("Done") {
                finding = false
                find = ""
                store.found = nil
            }
            .font(.ui(15, .semibold))
            .padding(.leading, 4)
        }
        .labelStyle(.iconOnly)
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(palette.text)
        .padding(.leading, 14)
        .padding(.trailing, 12)
        .frame(height: 44)
        .glassEffect(.regular, in: .capsule)
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
        .onChange(of: find) {
            findAt = 0
            let found = matches(chat)
            if let first = found.first { show(first, in: chat, animated: false) } else { store.found = nil }
        }
    }
}

/** The day between messages, as WhatsApp marks it. */
private struct DayPill: View {
    @Environment(\.palette) private var palette
    @Environment(\.colorScheme) private var scheme
    let text: String

    var body: some View {
        Text(text)
            .font(.ui(12, .semibold))
            .foregroundStyle(palette.muted)
            .padding(.horizontal, 10)
            .frame(height: 24)
            .background(palette.incoming(scheme), in: .capsule)
            .frame(maxWidth: .infinity)
            .accessibilityAddTraits(.isHeader)
    }
}
