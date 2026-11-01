import SwiftUI

/** Where the user is: a mailbox and a folder in it. */
struct Place: Hashable {
    /** The mailbox's address ("" until there's one). */
    var scope = ""
    var folder: Folder = .inbox
}

/**
 * The app's frame, Linear's: the mail list with a glass bar under it (the
 * mailbox's picture to switch, Inbox, Drafts, Search, and ⌃⌄ for every other
 * place, PlacesBar.swift), and the
 * agent on its own button beside the bar. The agent and search open as sheets.
 */
struct HomeView: View {
    @Environment(MailStore.self) private var store
    @Environment(Session.self) private var session
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var messageTransition
    @Namespace private var searchTransition

    @State private var place = Place()
    @State private var path: [String] = []
    @State private var menuOpen = false
    @State private var selecting = false
    @State private var draft: Draft?
    @State private var settingsOpen = false
    @State private var agentOpen = false
    @State private var searchOpen = false
    @State private var query = ""
    @State private var searchPath: [String] = []

    /** An agent here, or the account's chats to read (Claude and Codex ones too). */
    private var showsAgent: Bool { session.agent.isOn || session.user != nil }

    private var menuAnimation: Animation? { reduceMotion ? nil : .smooth(duration: 0.25) }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            mail
            if menuOpen {
                // Tapping outside closes it, as Linear's does.
                Color.black.opacity(0.25)
                    .ignoresSafeArea()
                    .onTapGesture { setMenu(open: false) }
                    .transition(.opacity)
                PlacesPanel(
                    place: place,
                    onSelect: { select($0) },
                    onSearch: { setMenu(open: false); searchOpen = true },
                    onSettings: { setMenu(open: false); settingsOpen = true }
                )
                .frame(maxHeight: 560)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 20)
                .padding(.bottom, 76)
                .transition(.scale(scale: 0.9, anchor: .bottomLeading).combined(with: .opacity))
            }
        }
        .onChange(of: store.shownMailboxes.map(\.email), initial: true) { _, shown in
            // The first mailbox, or the mailbox shown was turned off or removed: fall back to what's left.
            if !shown.contains(place.scope) { place = Place(scope: shown.first ?? "") }
        }
        .onChange(of: session.opening, initial: true) { _, _ in openNotification() }
        .onChange(of: store.sync?.loadingCache) { _, loading in
            if loading == false { openNotification() }
        }
        .sheet(item: $draft) { draft in
            ComposeView(draft: store.recover(draft))
        }
        .sheet(isPresented: $settingsOpen) {
            SettingsView()
        }
        .sheet(isPresented: $agentOpen) {
            NavigationStack {
                AgentView(sheet: true, onSettings: { agentOpen = false; settingsOpen = true })
            }
        }
        .sheet(isPresented: $searchOpen) { search }
    }

    /** The mail: the list (and the reader), with the bar under the list. */
    private var mail: some View {
        NavigationStack(path: $path) {
            ThreadListView(
                place: place,
                messageTransition: messageTransition,
                selecting: $selecting,
                onTitle: { setMenu(open: true) },
                onCompose: { compose() },
                onSettings: { settingsOpen = true },
                onResume: { draft = $0 }
            )
            // On the list, so it goes with it when a conversation opens.
            .safeAreaInset(edge: .bottom, spacing: 8) {
                VStack(spacing: 12) {
                    if let action = store.undoAction {
                        HStack {
                            Text(action.title).font(.inter(.subheadline)).lineLimit(2)
                            Spacer(minLength: 12)
                            Button("Undo") { store.undo() }.fontWeight(.semibold)
                                .accessibilityHint("Restores the conversations to their previous folders")
                        }
                        .foregroundStyle(palette.text)
                        .padding(16)
                        .background(palette.raised, in: .rect(cornerRadius: 18))
                        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(palette.border))
                        .padding(.horizontal, 16)
                        .id(action.id)
                    }
                    // Selecting, the list's actions take the bar's place.
                    if !selecting {
                        PlacesBar(
                            place: place,
                            menuOpen: menuOpen,
                            showsAgent: showsAgent,
                            onSelect: { select(Place(scope: place.scope, folder: $0)) },
                            onMailbox: { switchMailbox($0) },
                            onSearch: { searchOpen = true },
                            onMenu: { setMenu(open: !menuOpen) },
                            onAgent: { agentOpen = true }
                        )
                    }
                }
            }
            .navigationDestination(for: String.self) { id in
                let reader = ThreadView(threadID: id, place: place, path: $path, draft: $draft)
                if reduceMotion {
                    reader
                } else {
                    reader.navigationTransition(.zoom(sourceID: id, in: messageTransition))
                }
            }
        }
    }

    /** Search: what it finds in the mailbox the mail shows. */
    private var search: some View {
        NavigationStack(path: $searchPath) {
            ThreadListView(
                place: place,
                messageTransition: searchTransition,
                query: query,
                searchTab: true,
                selecting: .constant(false),
                onTitle: {},
                onCompose: { searchOpen = false; compose() },
                onSettings: { searchOpen = false; settingsOpen = true },
                onResume: { searchOpen = false; draft = $0 }
            )
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") { searchOpen = false }
                }
            }
            .navigationDestination(for: String.self) { id in
                let reader = ThreadView(threadID: id, place: place, path: $searchPath, draft: $draft)
                if reduceMotion {
                    reader
                } else {
                    reader.navigationTransition(.zoom(sourceID: id, in: searchTransition))
                }
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search")
    }

    private func select(_ next: Place) {
        place = next
        path = []
        setMenu(open: false)
    }

    /** Another mailbox, at the same folder where it has one. */
    private func switchMailbox(_ mailbox: Mailbox) {
        select(Place(scope: mailbox.email, folder: mailbox.folders.contains(place.folder) ? place.folder : .inbox))
    }

    private func compose(to: String = "") {
        let mailbox = store.mailbox(place.scope) ?? store.shownMailboxes.first
        guard let mailbox else { return }
        setMenu(open: false)
        draft = .new(from: mailbox, to: to)
    }

    private func openNotification() {
        guard let destination = session.opening else { return }
        Task {
            await session.prepareNotification(destination)
            guard session.opening == destination else { return }
            session.opening = nil
            guard destination.userId == nil || destination.userId == session.user?.id else { return }
            if let email = destination.email, let mailbox = store.mailboxes.first(where: { $0.email.lowercased() == email.lowercased() }) {
                place = Place(scope: mailbox.email)
            }
            setMenu(open: false)
            agentOpen = false
            searchOpen = false
            if let thread = destination.thread, let loaded = store.thread(thread),
               destination.email == nil || loaded.mailbox.lowercased() == destination.email?.lowercased() {
                path = [thread]
            } else { path = [] }
        }
    }

    private func setMenu(open: Bool) {
        withAnimation(menuAnimation) { menuOpen = open }
    }
}

/** iOS 27 lets navigation give space back to the mail while scrolling. */
extension View {
    @ViewBuilder
    func minimizingNavigationBar(enabled: Bool = true) -> some View {
        if #available(iOS 27.0, *) {
            toolbarMinimizationBehavior(enabled ? .onScrollDown : .never, for: .navigationBar)
        } else {
            self
        }
    }
}
