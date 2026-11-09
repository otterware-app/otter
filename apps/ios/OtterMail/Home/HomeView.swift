import SwiftUI
import UIKit

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
    @State private var selecting = false
    @State private var draft: Draft?
    @State private var settingsOpen = false
    @State private var agentOpen = false
    @State private var searchOpen = false
    @State private var module: HomeModule = .mail
    @State private var calendar = CalendarStore()
    @State private var calendarShown = CalendarShown()
    @State private var calendarPath = NavigationPath()
    @State private var catchUp = CatchUpState()
    @State private var catchingUp = false
    @State private var tasksPath = NavigationPath()
    /** A task whose reminder was tapped, opened over Tasks. */
    @State private var openingTask: UUID?
    /** A task's event, opened in the calendar over its pages. */
    @State private var openingEvent: TaskEvent?
    @State private var query = ""
    @State private var searchPath: [String] = []

    private var showsAgent: Bool { session.agent.isOn || session.user != nil }

    private var dates: CalendarDates { CalendarDates(preferences: session.preferences.calendar) }

    private var menuAnimation: Animation? { reduceMotion ? nil : .spring(duration: 0.4, bounce: 0.15) }

    var body: some View {
        content
            .environment(calendar)
            .environment(\.openTaskTarget, openTaskTarget)
            .onChange(of: store.shownScopes.map(\.email), initial: true) { _, shown in
                if !shown.contains(place.scope) { place = Place(scope: shown.first ?? "") }
            }
            .onChange(of: CalendarStore.sources(store.shownMailboxes).isEmpty) { _, none in
                if none, module == .calendar { module = .mail }
            }
            .onChange(of: session.opening, initial: true) { _, _ in openNotification() }
            .onChange(of: session.openingTask, initial: true) { _, _ in openTaskReminder() }
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

    @ViewBuilder private var content: some View {
        switch module {
        case .mail:
            NavigationStack(path: $path) {
                withPlaces(ThreadListView(
                    place: place,
                    messageTransition: messageTransition,
                    selecting: $selecting,
                    onTitle: { setMenu(open: true) },
                    onCompose: { compose() },
                    onSettings: openSettings,
                    onSearch: { setMenu(open: false); searchOpen = true },
                    onCatchUp: { setMenu(open: false); catchingUp = true },
                    catchUpCount: catchUp.items(
                        scope: place.scope, store: store, calendar: calendar, shown: calendarShown.shown, dates: dates
                    ).count,
                    onResume: { draft = $0 }
                ))
                .navigationDestination(isPresented: $catchingUp) {
                    CatchUpView(scope: place.scope, calendar: calendar, shown: calendarShown, state: catchUp, draft: $draft)
                }
                // Invitations for the pill's count, read with every calendar so the calendar's own windows stay.
                .task(id: CalendarStore.sources(store.shownMailboxes).map(\.email)) {
                    let sources = CalendarStore.sources(store.shownMailboxes)
                    guard !sources.isEmpty else { return }
                    await calendar.load(CatchUp.window(dates), sources: sources, demo: store.isDemo, google: session.google, dates: dates)
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
        case .calendar:
            NavigationStack(path: $calendarPath) {
                withPlaces(CalendarView(
                    events: calendar, visibility: calendarShown, path: $calendarPath, opening: $openingEvent,
                    onTitle: { setMenu(open: true) }, onSettings: openSettings
                ))
            }
        case .tasks:
            NavigationStack(path: $tasksPath) {
                withPlaces(TasksView(
                    opening: openingTask, onEmail: openTaskEmail, onTitle: { setMenu(open: true) }, onSettings: openSettings
                ))
            }
        }
    }

    /** The bar, on a module's first page only: a page pushed over it (a conversation, an event) has none. */
    private func withPlaces(_ view: some View) -> some View {
        view
            .overlay {
                if menuOpen {
                    Color.clear
                        .contentShape(.rect)
                        .ignoresSafeArea()
                        .onTapGesture { setMenu(open: false) }
                }
            }
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
                    if !selecting {
                        PlacesBar(
                            place: place,
                            module: module,
                            menuOpen: menuOpen,
                            calendar: calendar,
                            calendarShown: calendarShown,
                            showsAgent: showsAgent,
                            onPlace: { select($0) },
                            onMailbox: { switchMailbox($0) },
                            onModule: { show($0) },
                            onMenu: { setMenu(open: !menuOpen) },
                            onDone: { setMenu(open: false) },
                            onAgent: { agentOpen = true }
                        )
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

    private func openSettings() {
        setMenu(open: false)
        settingsOpen = true
    }

    private func select(_ next: Place) {
        place = next
        path = []
        catchingUp = false
        module = .mail
        setMenu(open: false)
    }

    /** Mail again from another module comes back where it was; Mail in Mail is the inbox. */
    private func show(_ next: HomeModule) {
        if next == .mail, module == .mail {
            select(Place(scope: place.scope, folder: .inbox))
            return
        }
        setMenu(open: false)
        selecting = false
        module = next
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

    /** A task reminder opens Tasks with that task over it, wherever the app was. */
    private func openTaskReminder() {
        guard let destination = session.openingTask else { return }
        session.openingTask = nil
        guard destination.scope == session.tasks.scope, session.tasks.contains(destination.id) else { return }
        agentOpen = false
        searchOpen = false
        settingsOpen = false
        openingTask = destination.id
        show(.tasks)
    }

    /** A task's link, wherever it was tapped: the conversation in Mail, the event in the calendar. */
    private func openTaskTarget(_ target: TaskTarget) {
        agentOpen = false
        searchOpen = false
        settingsOpen = false
        switch target {
        case .email(let email):
            openTaskEmail(email)
        case .event(let link):
            openingEvent = link
            show(.calendar)
        }
    }

    /** The conversation a task links to, opened as a notification's is. */
    private func openTaskEmail(_ email: TaskEmail) {
        module = .mail
        catchingUp = false
        if let thread = store.thread(email.thread) {
            let scope = store.shownScopes.first { $0.email.lowercased() == email.mailbox.lowercased() }?.email ?? thread.mailbox
            place = Place(scope: scope)
            path = [thread.id]
            return
        }
        // Not cached (or no longer there): the notification path fetches it, or lands on the mailbox.
        guard !store.isDemo else { return }
        session.opening = Session.NotificationDestination(
            userId: session.user?.id, email: email.mailbox, thread: email.thread, message: email.message
        )
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
            agentOpen = false
            searchOpen = false
            catchingUp = false
            module = .mail
            if let thread = destination.thread, let loaded = store.thread(thread),
               destination.email == nil || loaded.mailbox.lowercased() == (mailbox?.source ?? destination.email)?.lowercased() {
                path = [thread]
            } else { path = [] }
        }
    }

    private func setMenu(open: Bool) {
        withAnimation(menuAnimation) { menuOpen = open }
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
