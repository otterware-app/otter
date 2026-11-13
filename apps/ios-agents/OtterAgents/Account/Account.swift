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
    /** In the background, before the sockets close: the pause to come, and the time iOS gave for it. */
    @ObservationIgnored private var away: (pause: Task<Void, Never>, time: UIBackgroundTaskIdentifier)?

    /** How long the sockets stay once the app is in the background: a look at another app keeps them, and the turn streaming in them. */
    private static let grace: Duration = .seconds(25)

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
            self?.chats.startQueued()
            // An agent is reachable: now there's something to be told about.
            Task { await self?.requestNotifications() }
        }
        switch state {
        case .signedIn(let user): start(user)
        case .demo: startDemo()
        case .welcome: break
        }
        #if DEBUG
        if state == .welcome, let email = ProcessInfo.processInfo.environment["OTTER_DEV_EMAIL"] {
            Task { try? await signIn { try await self.relay.devSignIn(email: email) } }
        }
        #endif
    }

    var user: Relay.User? {
        if case .signedIn(let user) = state { user } else { nil }
    }

    var isDemo: Bool { state == .demo }

    func signIn() async throws {
        try await signIn { try await self.relay.signIn(idToken: try await self.google.idToken()) }
    }

    private func signIn(_ session: () async throws -> Relay.User) async throws {
        busy = "Signing in…"
        defer { busy = nil }
        let user = try await session()
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
        // The agents first: a turn left in the background picks up without waiting on the account.
        agents.reconnect()
        chats.resumeRuns(beforePull: true)
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

    /**
     * The agents a pointer may be from: OpenClaw's sessions say so, varys is known by its id, else
     * Hermes. Of several, the one with the session is (core tells each agent of the account).
     */
    private func candidates(for pointer: AgentPointer) -> [Agent] {
        if pointer.sessionKey?.hasPrefix("agent:") == true { return agents.runnable.filter { $0.kind == .openclaw } }
        let varys = agents.runnable.filter { $0.kind == .varys && $0.string("agentId") == pointer.agentId }
        return varys.isEmpty ? agents.runnable.filter { $0.kind == .hermes } : varys
    }

    /** Reads what the pointer points at into its chat; the chat's id, when this iPhone can reach the agent. */
    @discardableResult
    func delivered(_ pointer: AgentPointer) async -> String? {
        guard state != .welcome, let session = pointer.sessionKey else { return nil }
        if !candidates(for: pointer).contains(where: \.isUsable) { await agents.checkAll() }
        return await chats.delivered(to: candidates(for: pointer), session: session)
    }

    /** A notification was tapped: its chat opens, read up to date. */
    func open(_ pointer: AgentPointer) async {
        if let chat = await delivered(pointer) { opening = chat }
    }

    /** Otter Mail's Send to agent: a new chat about that mail opens. */
    func open(_ link: URL) {
        let mail = MailContext.read(link: link)
        guard state != .welcome, !mail.isEmpty else { return }
        opening = chats.newChat(about: mail)
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
        guard let user, let pushToken else { return }
        // Told once, and again only when something about it changes: iOS hands the token over at every launch.
        let state = "\(user.id):\(pushToken):\(notifications)"
        guard state != registered else { return }
        if (try? await relay.registerPush(token: pushToken, on: notifications)) != nil { registered = state }
    }

    /** Away: the sockets stay a while (`grace`), then close, and the agents' turns go on without the app; a call keeps them. */
    func leave() {
        guard away == nil, !chats.calling else { return }
        let time = UIApplication.shared.beginBackgroundTask(withName: "Agents") { [weak self] in self?.pause() }
        let pause = Task { [weak self] in
            try? await Task.sleep(for: Self.grace)
            if !Task.isCancelled { self?.pause() }
        }
        away = (pause, time)
    }

    /** Back: still connected after a short while away, the sockets are asked whether they still are; else all picks up again. */
    func returned() async {
        if endAway() { return await agents.probe() }
        await refresh()
    }

    private func pause() {
        endAway()
        relay.watching = nil
        relay.disconnect()
        chats.suspend()
    }

    /** Whether the app was still connected, away for less than `grace`. */
    @discardableResult
    private func endAway() -> Bool {
        guard let away else { return false }
        self.away = nil
        away.pause.cancel()
        UIApplication.shared.endBackgroundTask(away.time)
        return true
    }

    private func pullPreferences() async {
        guard let userId = user?.id, let (sections, agentKeys) = try? await relay.preferences(), user?.id == userId else {
            return await agents.checkAll()
        }
        let ui = sections["ui"] as? [String: Any]
        remoteUI = ui ?? [:]
        preferences.apply(ui: ui ?? [:])
        agents.apply(assistant: sections["assistant"].map(JSON.init(any:)), ui: ui ?? [:], agentKeys: agentKeys)
    }

    private func changed(_ section: String) {
        guard let userId = user?.id else { return }
        switch section {
        case "agentKeys":
            let keys = agents.agentKeys
            Task { try? await relay.putPreferences(["assistant": agents.syncedSection], agentKeys: keys) }
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
