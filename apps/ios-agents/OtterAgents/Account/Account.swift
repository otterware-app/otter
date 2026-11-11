import Foundation
import Observation
import UIKit
import UserNotifications

/**
 * Who's using the app: nobody yet, the demo, or an Otter account. Signed in, it keeps the
 * account's settings (the look, the agents) and its chats in step with the relay, both ways.
 */
@Observable
final class Account {
    enum State: Equatable {
        case welcome
        case demo
        case signedIn(Relay.User)
    }

    private(set) var state: State
    private(set) var busy: String?
    /** A chat a notification was tapped for, for the screens to open. */
    var opening: String?
    /** Whether this iPhone tells you when an agent asks or sends something while the app is away. */
    var notifications: Bool {
        didSet {
            guard notifications != oldValue else { return }
            UserDefaults.standard.set(notifications, forKey: Self.notificationsKey)
            Task { notifications ? await requestNotifications() : await registerPush() }
        }
    }

    let preferences: Preferences
    let agents = Agents()
    let chats: ChatStore
    @ObservationIgnored let relay = Relay()
    @ObservationIgnored private let google = GoogleSignIn()
    /** The account's `ui` section as last seen, so writes keep the keys only other apps have. */
    @ObservationIgnored private var remoteUI: [String: Any]?
    @ObservationIgnored private var pushingUI: Task<Void, Never>?

    @ObservationIgnored private var pushToken = UserDefaults.standard.string(forKey: "apns:token")
    @ObservationIgnored private var registered: String?

    private static let userKey = "otter:user"
    private static let demoKey = "otter:demo"
    private static let notificationsKey = "otter:notifications"

    init(preferences: Preferences) {
        self.preferences = preferences
        notifications = UserDefaults.standard.object(forKey: Self.notificationsKey) as? Bool ?? true
        chats = ChatStore(agents: agents)
        agents.relay = relay
        if relay.isSignedIn, let data = UserDefaults.standard.data(forKey: Self.userKey),
           let user = try? JSONDecoder().decode(Relay.User.self, from: data) {
            state = .signedIn(user)
        } else if UserDefaults.standard.bool(forKey: Self.demoKey) {
            state = .demo
        } else {
            state = .welcome
        }
        relay.onSignedOut = { [weak self] in self?.endSession() }
        preferences.onChange = { [weak self] in self?.changed("ui") }
        agents.onChange = { [weak self] section in self?.changed(section) }
        chats.onWatch = { [weak self] in self?.tellWatching() }
        agents.onReady = { [weak self] _ in
            self?.chats.resumeRuns()
            // An agent is reachable: now there's something to be told about.
            Task { await self?.requestNotifications() }
        }
        switch state {
        case .signedIn(let user): start(user)
        case .demo: startDemo()
        case .welcome: break
        }
    }

    var user: Relay.User? {
        if case .signedIn(let user) = state { user } else { nil }
    }

    var isDemo: Bool { state == .demo }

    func signIn() async throws {
        busy = "Signing in…"
        defer { busy = nil }
        let user = try await relay.signIn(idToken: try await google.idToken())
        UserDefaults.standard.set(try? JSONEncoder().encode(user), forKey: Self.userKey)
        if isDemo { leaveDemo() }
        state = .signedIn(user)
        start(user)
    }

    private func start(_ user: Relay.User) {
        chats.sync = ChatSync(store: chats, relay: relay, userId: user.id)
        Task { await refresh() }
    }

    /** Catches up with the account, and listens for what changes on other devices. */
    func refresh() async {
        guard user != nil else { return }
        async let preferences: Void = pullPreferences()
        async let pulled: Void = chats.sync?.pull() ?? ()
        _ = await (preferences, pulled)
        chats.resumeRuns()
        tellWatching()
        relay.connect { [weak self] event in
            guard let self else { return }
            Task {
                switch event {
                case .preferences: await self.pullPreferences()
                case .chats: await self.chats.sync?.pull()
                case .agent(let pointer): await self.delivered(pointer)
                }
            }
        }
    }

    // MARK: What agents ask and send

    /** The agent a pointer is from: OpenClaw's sessions say so, varys is known by its id, else Hermes. */
    private func provider(of pointer: AgentPointer) -> String {
        if pointer.sessionKey?.hasPrefix("agent:") == true { return "openclaw" }
        return pointer.agentId == agents.varys.agentId && !agents.varys.agentId.isEmpty ? "varys" : "hermes"
    }

    /** Reads what the pointer points at into its chat; the chat's id, when this iPhone can reach the agent. */
    @discardableResult
    func delivered(_ pointer: AgentPointer) async -> String? {
        guard state != .welcome, let session = pointer.sessionKey else { return nil }
        if !agents.isUsable(provider(of: pointer)) { await agents.checkAll() }
        return await chats.delivered(provider: provider(of: pointer), session: session)
    }

    /** A notification was tapped: its chat opens, read up to date. */
    func open(_ pointer: AgentPointer) async {
        if let chat = await delivered(pointer) { opening = chat }
    }

    /** Whether a notification should show: not for the chat already on screen. */
    func shows(_ pointer: AgentPointer) -> Bool {
        guard notifications, let session = pointer.sessionKey, let watched = chats.watched else { return notifications }
        return chats.chat(watched)?.sessionId != session
    }

    /** The relay hears which chat is on screen, so this account's iPhones stay quiet about it. */
    private func tellWatching() {
        relay.watching = chats.watched.flatMap { chats.chat($0)?.sessionId }
    }

    /** Asks once to show notifications, when they're on. */
    func requestNotifications() async {
        configureNotifications()
        guard notifications, state != .welcome else { return }
        guard (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])) == true else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    func registeredForPush(_ token: String) {
        pushToken = token
        UserDefaults.standard.set(token, forKey: "apns:token")
        Task { await registerPush() }
    }

    private func registerPush() async {
        configureNotifications()
        guard let user, let pushToken else { return }
        // Told once, and again only when something about it changes: iOS hands the token over at every launch.
        let state = "\(user.id):\(pushToken):\(notifications)"
        guard state != registered else { return }
        if (try? await relay.registerPush(token: pushToken, on: notifications)) != nil { registered = state }
    }

    /** Away: the socket closes, and the agents' turns go on without the app. */
    func pause() {
        configureNotifications()
        relay.watching = nil
        relay.disconnect()
        chats.suspend()
    }

    private func pullPreferences() async {
        guard let userId = user?.id, let (sections, hermesKey) = try? await relay.preferences(), user?.id == userId else {
            return await agents.checkAll()
        }
        let ui = sections["ui"] as? [String: Any]
        remoteUI = ui ?? [:]
        preferences.apply(ui: ui ?? [:])
        agents.apply(assistant: sections["assistant"] as? [String: Any], ui: ui ?? [:], hermesKey: hermesKey)
    }

    private func changed(_ section: String) {
        guard let userId = user?.id else { return }
        switch section {
        case "hermesKey":
            let key = agents.hermesKey
            Task { try? await relay.putPreferences(["assistant": agents.syncedSection], hermesKey: .some(key)) }
        case "assistant":
            Task { try? await relay.putPreferences(["assistant": agents.syncedSection]) }
        default:
            // Not pulled yet: writing now would drop what the other apps keep there.
            guard let remote = remoteUI else { return }
            let merged = remote.merging(preferences.uiSection) { _, mine in mine }.merging(agents.uiSection) { _, mine in mine }
            remoteUI = merged
            pushingUI?.cancel()
            pushingUI = Task {
                try? await Task.sleep(for: .milliseconds(400))
                guard !Task.isCancelled, user?.id == userId else { return }
                try? await relay.putPreferences(["ui": merged])
            }
        }
    }

    func signOut() async {
        endSession()
        await relay.signOut()
    }

    func deleteAccount() async throws {
        try await relay.deleteUser()
        endSession()
    }

    private func endSession() {
        AgentNotificationState.configure(nil)
        pushingUI?.cancel()
        remoteUI = nil
        relay.disconnect()
        chats.sync?.forget()
        chats.sync = nil
        chats.reset()
        agents.forgetAccount()
        UserDefaults.standard.removeObject(forKey: Self.userKey)
        state = .welcome
    }

    private func configureNotifications() {
        guard notifications, let user else { AgentNotificationState.configure(nil); return }
        let titles = chats.chats.sorted { $0.updatedAt > $1.updatedAt }.prefix(100).compactMap { chat -> (String, String)? in
            guard let session = chat.sessionId, !chat.title.isEmpty else { return nil }
            return (session, chat.title)
        }
        AgentNotificationState.configure(.init(
            userId: user.id,
            hermesURL: agents.hermes.enabled ? agents.hermes.baseUrl : nil,
            openClawURL: agents.openclaw.enabled ? agents.openclaw.url : nil,
            varysAddress: agents.varys.enabled ? agents.varys.address : nil,
            varysAgentId: agents.varys.enabled ? agents.varys.agentId : nil,
            titles: Dictionary(titles, uniquingKeysWith: { first, _ in first }),
            agentNames: Dictionary(agents.models(of: .openclaw).map { ($0.slug, $0.name) }, uniquingKeysWith: { first, _ in first })
        ))
    }

    // MARK: The demo

    func tryDemo() {
        UserDefaults.standard.set(true, forKey: Self.demoKey)
        state = .demo
        startDemo()
    }

    private func startDemo() {
        agents.startDemo()
        chats.replace(chats: DemoChats.all())
    }

    func leaveDemo() {
        UserDefaults.standard.set(false, forKey: Self.demoKey)
        agents.endDemo()
        chats.reset()
        state = .welcome
    }
}
