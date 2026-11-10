import SwiftUI

enum Route: Hashable {
    case chat(String)
    case agent(AgentKind)
    case appearance
    case account
    case chatSettings
    case task(String)
}

/**
 * The app's frame, as Otter Code's: one stack whose root is the chosen tab, a floating glass bar
 * of tabs at the bottom with the compose button beside it, both gone while a chat is open.
 */
struct RootView: View {
    enum Tab: String, CaseIterable {
        case chats, scheduled, settings

        var symbol: String {
            switch self {
            case .chats: "text.bubble"
            case .scheduled: "clock"
            case .settings: "gearshape"
            }
        }

        var label: String { rawValue.capitalized }
    }

    @Environment(\.palette) private var palette
    @Environment(ChatStore.self) private var store
    @Environment(ScheduledStore.self) private var scheduled
    @Environment(Account.self) private var account
    @State private var tab = Tab.chats
    @State private var path: [Route] = []
    @State private var newTask = false

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                switch tab {
                case .chats: ChatsScreen(open: { path.append(.chat($0)) }, openSettings: { tab = .settings })
                case .scheduled: ScheduledScreen(open: { path.append(.task($0)) }, openSettings: { tab = .settings })
                case .settings: SettingsScreen(path: $path)
                }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .chat(let id): ChatScreen(id: id) {
                    path = []
                    tab = .settings
                }
                case .agent(let kind): AgentSettings(kind: kind)
                case .appearance: AppearanceSettings()
                case .account: AccountSettings()
                case .chatSettings: ChatSettings()
                case .task(let id): TaskScreen(id: id) { path.append(.chat($0)) }
                }
            }
        }
        .overlay(alignment: .bottom) {
            if path.isEmpty {
                bar
                    .padding(.horizontal, 16)
                    .padding(.bottom, 4)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.2), value: path.isEmpty)
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
        .sheet(isPresented: $newTask) { TaskEditor { path.append(.task($0)) } }
        .onChange(of: account.opening, initial: true) { _, chat in
            guard let chat else { return }
            account.opening = nil
            tab = .chats
            path = [.chat(chat)]
        }
    }

    private var bar: some View {
        GlassEffectContainer(spacing: 16) {
            HStack(spacing: 16) {
                HStack(spacing: 0) {
                    ForEach(Tab.allCases, id: \.self) { item in
                        let unseen = item == .chats && tab != .chats && !store.unseen.isEmpty
                        Button {
                            Haptics.tap()
                            tab = item
                        } label: {
                            let attention = item == .scheduled && scheduled.failing
                            Image(systemName: tab == item ? "\(item.symbol).fill" : item.symbol)
                                .font(.system(size: 21))
                                .foregroundStyle(tab == item ? palette.text : palette.muted)
                                .frame(width: 58, height: 46)
                                .overlay(alignment: .topTrailing) {
                                    if unseen || attention { Circle().fill(unseen ? Status.done : palette.warning).frame(width: 8, height: 8).offset(x: -14, y: 9) }
                                }
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(item.label)
                        .accessibilityValue(item == .scheduled && scheduled.failing ? "One isn't working" : "")
                        .accessibilityAddTraits(tab == item ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 4)
                .frame(height: 54)
                .glassEffect(.regular.interactive(), in: .capsule)
                Spacer()
                if tab == .chats || (tab == .scheduled && !scheduled.creators.isEmpty) {
                    Button {
                        Haptics.tap()
                        if tab == .chats { path.append(.chat(store.newChat())) } else { newTask = true }
                    } label: {
                        Image(systemName: tab == .chats ? "square.and.pencil" : "plus")
                            .font(.system(size: 21))
                            .foregroundStyle(palette.text)
                            .frame(width: 62, height: 54)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: .capsule)
                    .accessibilityLabel(tab == .chats ? "New chat" : "New task")
                    .transition(.scale(scale: 0.8).combined(with: .opacity))
                }
            }
        }
        .animation(.easeOut(duration: 0.2), value: tab)
    }
}
