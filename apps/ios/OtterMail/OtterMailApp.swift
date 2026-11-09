import BackgroundTasks
import SwiftUI
import UserNotifications

@main
struct OtterMailApp: App {
    @UIApplicationDelegateAdaptor private var delegate: AppDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var preferences: Preferences
    @State private var session: Session

    static let refreshTask = "dev.otterware.mail.refresh"

    init() {
        ErrorReports.start()
        UIFont.useInterInBars()
        let preferences = Preferences()
        _preferences = State(initialValue: preferences)
        _session = State(initialValue: Session(preferences: preferences))
    }

    var body: some Scene {
        WindowGroup {
            Themed {
                switch session.state {
                case .welcome: WelcomeView()
                case .demo, .signedIn: HomeView()
                }
            }
            .environment(preferences)
            .environment(session)
            .environment(session.store)
            .onAppear { delegate.session = session }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                Task { await session.relay.retrySignOuts(); await session.refreshAccount() }
                Task { await session.agent.resumeOpenClaw() }
                // Reminders are kept to the nearest few, so the next ones are scheduled as time passes.
                session.tasks.reschedule()
            case .background:
                session.disconnect()
                session.agent.suspendOpenClaw()
                Task { await Self.scheduleRefresh() }
            default: break
            }
        }
        .backgroundTask(.appRefresh(Self.refreshTask)) {
            await Self.scheduleRefresh()
            await session.backgroundRefresh()
        }
    }

    /** Checks Gmail every so often while the app is away (iOS picks the moment). */
    private static func scheduleRefresh() async {
        let request = BGAppRefreshTaskRequest(identifier: refreshTask)
        request.earliestBeginDate = .now.addingTimeInterval(15 * 60)
        // Xcode 27 (Swift 6.4) has the async form; CI's Xcode 26 doesn't yet.
        #if compiler(>=6.4)
        if #available(iOS 27, *) {
            try? await BGTaskScheduler.shared.submitTaskRequest(request)
            return
        }
        #endif
        try? BGTaskScheduler.shared.submit(request)
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var session: Session? {
        didSet {
            if let tapped { session?.opening = tapped; self.tapped = nil }
            if let tappedTask { session?.openingTask = tappedTask; self.tappedTask = nil }
            if let token { session?.registeredForPush(token) }
        }
    }
    private var tapped: Session.NotificationDestination?
    private var tappedTask: TaskDestination?
    private var token: String?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        self.token = token
        session?.registeredForPush(token)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        if let task = TaskReminders.destination(info) {
            if let session { session.openingTask = task } else { tappedTask = task }
            completionHandler()
            return
        }
        let metadata = info["otter"] as? [String: Any]
        let destination = Session.NotificationDestination(userId: metadata?["userId"] as? String,
            email: (info["mailbox"] as? String) ?? (metadata?["email"] as? String), thread: info["thread"] as? String, message: info["message"] as? String)
        if let session { session.opening = destination } else { tapped = destination }
        completionHandler()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let info = notification.request.content.userInfo
        // A reminder the user asked for shows whatever the mail notifications setting says.
        if TaskReminders.destination(info) != nil {
            completionHandler([.banner, .sound])
            return
        }
        if let metadata = info["otter"] as? [String: Any] {
            let userId = metadata["userId"] as? String
            let email = metadata["email"] as? String ?? ""
            // Foreground suppression is supported. A change marker alone doesn't merit a new-mail banner.
            let show = session?.user?.id == userId && info["message"] != nil && session?.preferences.notifications != .off
                && PushState.permits(userId: userId ?? "", email: email)
            completionHandler(show ? [.banner, .sound] : [])
            Task { await session?.backgroundRefresh() }
        } else {
            completionHandler(session?.preferences.notifications == .off ? [] : [.banner, .sound])
        }
    }
}

struct Themed<Content: View>: View {
    @Environment(Preferences.self) private var preferences
    @ViewBuilder var content: Content

    var body: some View {
        ThemedContent(content: content)
            .preferredColorScheme(preferences.scheme.colorScheme)
    }

    private struct ThemedContent: View {
        @Environment(Preferences.self) private var preferences
        @Environment(\.colorScheme) private var colorScheme
        let content: Content

        var body: some View {
            let id = colorScheme == .dark ? preferences.darkTheme : preferences.lightTheme
            let palette = (preferences.theme(id) ?? Theme.named(Preferences.initialTheme))?.palette(colorScheme)
            content
                .environment(\.palette, palette ?? EnvironmentValues().palette)
                // Inter wherever a view doesn't pick its own text style (Typography.swift).
                .font(.inter(.body))
                .tint(palette?.action)
                // Switches wear the focus color, as on the desktop (a monochrome action would vanish).
                .toggleStyle(SwitchToggleStyle(tint: palette?.focus ?? .blue))
        }
    }
}

extension Preferences.Scheme {
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}
