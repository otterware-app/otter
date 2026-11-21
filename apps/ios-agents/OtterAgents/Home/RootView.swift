import SwiftUI

enum Route: Hashable {
    case chat(String)
    /** An agent's page, by its id. */
    case agent(String)
    case account
    case chatSettings
    case licenses
    case task(String)
}

/**
 * The app's frame, as Claude's phone app: each tab its own stack, and under each tab's first
 * screen the bar to ask an agent and the tabs (`BottomBar`), so they leave with it as a chat
 * opens. They leave too while chats are being selected.
 */
struct RootView: View {
    /** A card over the bar: a tab's recents (touch and hold it), the agents to ask, or chats you started writing. */
    enum Card: Equatable {
        case recents(Place)
        case agents
        case drafts
    }

    enum Place: Hashable, CaseIterable {
        case chats, scheduled, settings

        var symbol: String {
            switch self {
            case .chats: "bubble.left.and.bubble.right.fill"
            case .scheduled: "clock.fill"
            case .settings: "gearshape.fill"
            }
        }

        var name: String {
            switch self {
            case .chats: "Chats"
            case .scheduled: "Scheduled"
            case .settings: "Settings"
            }
        }
    }

    @Environment(\.palette) private var palette
    @Environment(ChatStore.self) private var store
    @Environment(ScheduledStore.self) private var scheduled
    @Environment(Account.self) private var account
    @State private var place = Place.chats
    @State private var paths: [Place: [Route]] = [:]
    @State private var newTask = false
    @State private var selecting = false
    @State private var card: Card?
    /** A chat that finished while you were elsewhere, as Claude's "Completed". */
    @State private var finished: String?

    var body: some View {
        TabView(selection: $place) {
            Tab(value: Place.chats) {
                stack(.chats) {
                    ChatsScreen(open: { open(.chat($0), in: .chats) }, openSettings: { place = .settings }, selecting: $selecting)
                }
            }
            Tab(value: Place.scheduled) {
                stack(.scheduled) {
                    ScheduledScreen(open: { open(.task($0), in: .scheduled) }, openSettings: { place = .settings }, newTask: scheduled.creators.isEmpty ? nil : { newTask = true })
                }
            }
            Tab(value: Place.settings) {
                stack(.settings) { SettingsScreen(path: path(.settings)) }
            }
        }
        .tint(palette.text)
        .overlay { recentsOverlay }
        .onChange(of: store.working) { before, now in
            let open = paths[place]?.last
            if let done = before.subtracting(now).first(where: { open != .chat($0) && store.chat($0) != nil }) {
                withAnimation(.easeOut(duration: 0.2)) { finished = done }
            }
        }
        .overlay(alignment: .top) {
            if let notice = store.notice {
                Toast(text: notice, symbol: "info.circle")
                    .padding(.top, 6)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task(id: notice) {
                        try? await Task.sleep(for: .seconds(3.5))
                        withAnimation { store.notice = nil }
                    }
                    .onTapGesture { store.notice = nil }
            }
        }
        .animation(.easeOut(duration: 0.2), value: store.notice)
        .sheet(isPresented: $newTask) { TaskEditor { open(.task($0), in: .scheduled) } }
        .onChange(of: account.opening, initial: true) { _, chat in
            guard let chat else { return }
            account.opening = nil
            place = .chats
            paths[.chats] = [.chat(chat)]
        }
    }

    @ViewBuilder
    private var recentsOverlay: some View {
        if let card {
            ZStack(alignment: alignment(of: card)) {
                Color.black.opacity(0.08)
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation(.easeOut(duration: 0.18)) { self.card = nil } }
                cardView(card)
                    .padding(.horizontal, 16)
                    // A tab's over the ask bar, the tabs left in view under it; the bar's own over the bar.
                    .padding(.bottom, BottomBar.tabsHeight + (card == .agents || card == .drafts ? 60 : 4))
                    .transition(.scale(scale: 0.6, anchor: .bottom).combined(with: .opacity))
            }
        } else if let finished, let chat = store.chat(finished) {
            Button {
                self.finished = nil
                place = .chats
                paths[.chats] = [.chat(chat.id)]
            } label: {
                Toast(text: "\(chat.title) · Done", symbol: "checkmark.circle")
            }
            .buttonStyle(.plain)
            .frame(maxHeight: .infinity, alignment: .bottom)
            .padding(.bottom, BottomBar.tabsHeight + 76)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .task(id: finished) {
                try? await Task.sleep(for: .seconds(4))
                withAnimation { self.finished = nil }
            }
        }
    }

    private func alignment(of card: Card) -> Alignment {
        switch card {
        case .agents, .recents(.chats): .bottomLeading
        case .recents(.scheduled): .bottom
        case .drafts, .recents(.settings): .bottomTrailing
        }
    }

    @ViewBuilder
    private func cardView(_ card: Card) -> some View {
        let close = { withAnimation(.easeOut(duration: 0.18)) { self.card = nil } }
        switch card {
        case .recents(let tab):
            TabRecentsCard(items: recentItems(tab), new: recentsNew(tab)) { picked in
                close()
                pickRecent(picked, in: tab)
            }
        case .agents:
            let starting = store.agents.starting?.id
            TabRecentsCard(items: store.agents.usable.filter(\.canStartChat).map {
                RecentItem(id: $0.id, title: $0.name, agent: $0.id, status: $0.id == starting ? .chosen : .none)
            }, new: "Your agents", newSymbol: "gearshape") { picked in
                close()
                if let picked, let agent = store.agents.agent(picked) {
                    Haptics.tap()
                    store.agents.select(agent)
                } else {
                    place = .settings
                    paths[.settings] = []
                }
            }
        case .drafts:
            TabRecentsCard(items: store.chats.filter { store.hasDraft($0.id) }.sorted { $0.updatedAt > $1.updatedAt }.prefix(5).map { chat in
                let words = store.drafts[chat.id]?.split(whereSeparator: \.isNewline).first.map(String.init)
                return RecentItem(id: chat.id, title: chat.isBlank ? words ?? "New chat" : chat.title, agent: chat.provider)
            }, new: "New chat") { picked in
                close()
                if let picked {
                    place = .chats
                    paths[.chats] = [.chat(picked)]
                } else {
                    ask()
                }
            }
        }
    }

    private func recentItems(_ tab: Place) -> [RecentItem] {
        switch tab {
        case .chats:
            store.chats.filter { !$0.isBlank }.sorted { $0.updatedAt > $1.updatedAt }.prefix(5).map { chat in
                RecentItem(id: chat.id, title: chat.title, agent: chat.provider,
                           status: store.working.contains(chat.id) ? .working : store.unseen.contains(chat.id) || store.needsYou.contains(chat.id) ? .unread : .none)
            }
        case .scheduled:
            scheduled.tasks.sorted { ($0.lastRun?.at ?? 0) > ($1.lastRun?.at ?? 0) }.prefix(5).map { task in
                RecentItem(id: task.id, title: task.name, agent: task.provider, status: task.running ? .working : task.failed ? .failed : .none)
            }
        case .settings:
            store.agents.runnable.prefix(5).map { RecentItem(id: $0.id, title: $0.name, agent: $0.id) }
        }
    }

    private func recentsNew(_ tab: Place) -> String? {
        switch tab {
        case .chats: "New chat"
        case .scheduled: scheduled.creators.isEmpty ? nil : "New task"
        case .settings: nil
        }
    }

    private func pickRecent(_ id: String?, in tab: Place) {
        place = tab
        switch (tab, id) {
        case (.chats, nil): ask()
        case (.chats, let id?): paths[.chats] = [.chat(id)]
        case (.scheduled, nil): newTask = true
        case (.scheduled, let id?): paths[.scheduled] = [.task(id)]
        case (.settings, let id?): paths[.settings] = [.agent(id)]
        case (.settings, nil): break
        }
    }

    private func path(_ place: Place) -> Binding<[Route]> {
        Binding(get: { paths[place] ?? [] }, set: { paths[place] = $0 })
    }

    private func open(_ route: Route, in place: Place) { paths[place, default: []].append(route) }

    private func ask() {
        Haptics.tap()
        place = .chats
        paths[.chats] = [.chat(store.newChat())]
    }

    private var badges: [Place: String] {
        var badges: [Place: String] = [:]
        let unread = store.unseen.union(store.needsYou).count
        if unread > 0 { badges[.chats] = "\(unread)" }
        if scheduled.failing { badges[.scheduled] = "!" }
        return badges
    }

    private func stack(_ place: Place, @ViewBuilder root: () -> some View) -> some View {
        NavigationStack(path: path(place)) {
            root()
                .topBarBacking()
                // A bar, so what's above softens under it as under the navigation bar.
                .safeAreaBar(edge: .bottom, spacing: 0) {
                    if !selecting {
                        BottomBar(place: $place, badges: badges, ask: ask) { card in
                            withAnimation(.spring(duration: 0.3, bounce: 0.2)) { self.card = card }
                        }
                    }
                }
                .toolbarVisibility(.hidden, for: .tabBar)
                .navigationDestination(for: Route.self) { route in destination(route, in: place).toolbarVisibility(.hidden, for: .tabBar) }
        }
    }

    @ViewBuilder
    private func destination(_ route: Route, in place: Place) -> some View {
        switch route {
        case .chat(let id): ChatScreen(id: id) {
            paths[place] = []
            self.place = .settings
        }
        case .agent(let id): AgentSettings(id: id)
        case .account: AccountSettings()
        case .chatSettings: ChatSettings()
        case .licenses: LicensesView()
        case .task(let id): TaskScreen(id: id) { open(.chat($0), in: place) }
        }
    }
}
