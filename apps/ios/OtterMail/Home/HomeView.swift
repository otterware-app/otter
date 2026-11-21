import SwiftUI

struct Place: Hashable {
    var scope = ""
    var folder: Folder = .inbox
}

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
    /** Inbox or Drafts, held: its recents show over the bar. */
    @State private var recents: Folder?
    @State private var mailboxesOpen = false
    @State private var selecting = false
    @State private var draft: Draft?
    @State private var settingsOpen = false
    @State private var searchOpen = false
    @State private var query = ""
    @State private var searchPath: [String] = []
    @State private var searchActive = false
    /** Scrolled down the list: the tabs tuck away until you scroll back up. */
    @State private var reading = false

    private var menuAnimation: Animation? { reduceMotion ? nil : .spring(duration: 0.4, bounce: 0.15) }

    var body: some View {
        mail
            .onChange(of: store.shownScopes.map(\.email), initial: true) { _, shown in
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
            .sheet(isPresented: $searchOpen) { search }
    }

    private var mail: some View {
        NavigationStack(path: $path) {
            ThreadListView(
                place: place,
                messageTransition: messageTransition,
                selecting: $selecting,
                onTitle: { setMenu(open: true) },
                onResume: { draft = $0 },
                onReading: { now in
                    if now != reading { withAnimation(.spring(duration: 0.3, bounce: 0.1)) { reading = now } }
                }
            )
            .overlay {
                if menuOpen || recents != nil || mailboxesOpen {
                    Color.clear
                        .contentShape(.rect)
                        .ignoresSafeArea()
                        .onTapGesture { setMenu(open: false) }
                }
            }
            // Over the list, where the cards take taps: the bar's own area ends at its top.
            .overlay(alignment: .bottomTrailing) {
                if menuOpen {
                    PlacesPanel(place: place, onSelect: { select($0) },
                                onSearch: { setMenu(open: false); searchOpen = true },
                                onSettings: { setMenu(open: false); settingsOpen = true })
                        .frame(maxHeight: 520)
                        .fixedSize(horizontal: false, vertical: true)
                        .glassEffect(.regular, in: .rect(cornerRadius: 28))
                        .padding(.horizontal, 16)
                        .padding(.bottom, 4)
                        .transition(.scale(scale: 0.6, anchor: .bottomTrailing).combined(with: .opacity))
                }
            }
            .overlay(alignment: .bottomLeading) {
                if mailboxesOpen {
                    MailboxesCard(current: place.scope) { mailbox in
                        setMenu(open: false)
                        switchMailbox(mailbox)
                    } onManage: {
                        setMenu(open: false)
                        settingsOpen = true
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 4)
                    .transition(.scale(scale: 0.6, anchor: .bottomLeading).combined(with: .opacity))
                }
            }
            .overlay(alignment: recents == .drafts ? .bottomTrailing : .bottomLeading) {
                if let folder = recents {
                    RecentsCard(folder: folder, scope: place.scope) { thread in
                        recents = nil
                        if thread.isDraft, let message = thread.messages.last {
                            draft = .resume(message, in: thread)
                        } else {
                            select(Place(scope: place.scope, folder: folder))
                            path = [thread.id]
                        }
                    } onCompose: {
                        recents = nil
                        compose()
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 4)
                    .transition(.scale(scale: 0.6, anchor: recents == .drafts ? .bottomTrailing : .bottomLeading).combined(with: .opacity))
                }
            }
            .topBarBacking()
            // On the list, so it goes with it when a conversation opens; a bar, so the list softens
            // under it as under the navigation bar.
            .safeAreaBar(edge: .bottom, spacing: 8) {
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
                    if !selecting {
                        PlacesBar(
                            place: place,
                            reading: reading,
                            onSelect: { select(Place(scope: place.scope, folder: $0)) },
                            onSearch: { setMenu(open: false); searchOpen = true },
                            onSettings: { setMenu(open: false); settingsOpen = true },
                            onMenu: { setMenu(open: !menuOpen) },
                            onCompose: { compose() },
                            onRecents: { folder in
                                setMenu(open: false)
                                withAnimation(menuAnimation) { recents = folder }
                            },
                            onMailboxes: {
                                let open = !mailboxesOpen
                                setMenu(open: false)
                                withAnimation(menuAnimation) { mailboxesOpen = open }
                            }
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

    private var search: some View {
        NavigationStack(path: $searchPath) {
            ThreadListView(
                place: place,
                messageTransition: searchTransition,
                query: query,
                searchTab: true,
                onQuery: { query = $0 },
                selecting: .constant(false),
                onTitle: {},
                onResume: { searchOpen = false; draft = $0 }
            )
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
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
        .searchable(text: $query, isPresented: $searchActive, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search")
        // From the pill, ready to type, as Claude's composer is.
        .task {
            // Once the sheet is up: a search started while it's still rising is dropped.
            try? await Task.sleep(for: .milliseconds(350))
            searchActive = true
        }
        // Its Cancel closes the sheet: there's nothing behind the search to go back to.
        .onChange(of: searchActive) { was, now in if was, !now { searchOpen = false } }
        .background(SearchFieldColors(color: palette.muted))
    }

    private func select(_ next: Place) {
        place = next
        reading = false
        path = []
        setMenu(open: false)
    }

    private func switchMailbox(_ mailbox: Mailbox) {
        select(Place(scope: mailbox.email, folder: mailbox.folders.contains(place.folder) ? place.folder : .inbox))
    }

    private func compose(to: String = "") {
        let mailbox = store.mailbox(for: place.scope) ?? store.shownMailboxes.first
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
            // An alias mailbox turned off since opens in its parent.
            let mailbox = destination.email.flatMap { email in
                store.mailboxes.first { $0.email.lowercased() == email.lowercased() }
                    ?? store.alias(email).flatMap { alias in store.shownScopes.contains(alias) ? alias : store.mailbox(alias.source) }
            }
            if let mailbox { place = Place(scope: mailbox.email) }
            setMenu(open: false)
            searchOpen = false
            if let thread = destination.thread, let loaded = store.thread(thread),
               destination.email == nil || loaded.mailbox.lowercased() == (mailbox?.source ?? destination.email)?.lowercased() {
                path = [thread]
            } else { path = [] }
        }
    }

    /** Opens or closes the places menu; any card over the bar closes either way. */
    private func setMenu(open: Bool) {
        withAnimation(menuAnimation) {
            menuOpen = open
            recents = nil
            mailboxesOpen = false
        }
    }
}

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
