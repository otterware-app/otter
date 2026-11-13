import SwiftUI

enum Route: Hashable {
    case chat(String)
    /** An agent's page, by its id. */
    case agent(String)
    case appearance
    case account
    case chatSettings
    case licenses
    case task(String)
}

/**
 * The app's frame, as T3 Code's phone app: the system's tab bar (Liquid Glass, as iOS draws
 * it), each tab its own stack, and compose as the prominent tab, its own circle at the bottom
 * right. The bar leaves while a chat is open or chats are being selected.
 */
struct RootView: View {
    enum Place: Hashable {
        case chats, scheduled, settings, compose
    }

    @Environment(\.palette) private var palette
    @Environment(ChatStore.self) private var store
    @Environment(ScheduledStore.self) private var scheduled
    @Environment(Account.self) private var account
    @State private var place = Place.chats
    @State private var paths: [Place: [Route]] = [:]
    @State private var newTask = false
    @State private var selecting = false

    private var makesTask: Bool { place == .scheduled && !scheduled.creators.isEmpty }

    var body: some View {
        // Compose is a tab only to sit apart as iOS draws a prominent one: choosing it acts and stays where you were.
        TabView(selection: Binding(get: { place }, set: { picked in if picked == .compose { compose() } else { place = picked } })) {
            Tab(value: Place.chats) {
                stack(.chats) {
                    ChatsScreen(open: { open(.chat($0), in: .chats) }, openSettings: { place = .settings }, selecting: $selecting)
                        .toolbarVisibility(selecting ? .hidden : .automatic, for: .tabBar)
                }
            } label: { icon("Chats", "text.bubble") }
            .badge(store.unseen.union(store.needsYou).count)
            Tab(value: Place.scheduled) {
                stack(.scheduled) { ScheduledScreen(open: { open(.task($0), in: .scheduled) }, openSettings: { place = .settings }) }
            } label: { icon("Scheduled", "clock") }
            .badge(scheduled.failing ? Text("!") : nil)
            Tab(value: Place.settings) {
                stack(.settings) { SettingsScreen(path: path(.settings)) }
            } label: { icon("Settings", "gearshape") }
            Tab(value: Place.compose, role: .prominent) { Color.clear } label: { composeIcon }
        }
        .tint(palette.text)
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

    /** T3 Code's tabs: the symbol alone, its name for VoiceOver. */
    private func icon(_ name: String, _ symbol: String) -> some View {
        Label(name, systemImage: symbol).labelStyle(.iconOnly)
    }

    private var composeIcon: some View {
        icon(makesTask ? "New task" : "New chat", makesTask ? "plus" : "square.and.pencil")
    }

    private func path(_ place: Place) -> Binding<[Route]> {
        Binding(get: { paths[place] ?? [] }, set: { paths[place] = $0 })
    }

    private func open(_ route: Route, in place: Place) { paths[place, default: []].append(route) }

    private func compose() {
        Haptics.tap()
        if makesTask {
            newTask = true
        } else {
            place = .chats
            paths[.chats] = [.chat(store.newChat())]
        }
    }

    private func stack(_ place: Place, @ViewBuilder root: () -> some View) -> some View {
        NavigationStack(path: path(place)) {
            root().navigationDestination(for: Route.self) { route in
                destination(route, in: place).toolbarVisibility(.hidden, for: .tabBar).background(ShowsTabBarOnBack())
            }
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
        case .appearance: AppearanceSettings()
        case .account: AccountSettings()
        case .chatSettings: ChatSettings()
        case .licenses: LicensesView()
        case .task(let id): TaskScreen(id: id) { open(.chat($0), in: place) }
        }
    }
}

/**
 * Brings the tab bar back as a back swipe to a tab's first screen starts, in step with it, as
 * UIKit's own hiding does: SwiftUI's `toolbarVisibility(.hidden, for: .tabBar)` brings it back
 * only once the swipe is over. A swipe let go of hides it again.
 */
private struct ShowsTabBarOnBack: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> Marker { Marker() }
    func updateUIViewController(_ marker: Marker, context: Context) {}

    final class Marker: UIViewController {
        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            // The pushed screen this is in.
            var screen: UIViewController? = self
            while let current = screen, !(current.parent is UINavigationController) { screen = current.parent }
            // Leaving its stack for the tab's first screen (SwiftUI's screens don't say `isMovingFromParent`).
            guard let screen, let stack = screen.navigationController?.viewControllers, stack.count == 1, !stack.contains(screen),
                  let tabs = screen.tabBarController, let coordinator = screen.transitionCoordinator else { return }
            coordinator.animate { _ in tabs.setTabBarHidden(false, animated: false) } completion: { context in
                if context.isCancelled { tabs.setTabBarHidden(true, animated: false) }
            }
        }
    }
}
