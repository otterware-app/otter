import SwiftUI
import UserNotifications

@main
struct OtterAgentsApp: App {
    @UIApplicationDelegateAdaptor private var delegate: AppDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var preferences: Preferences
    @State private var account: Account
    @State private var scheduled: ScheduledStore

    init() {
        UIFont.useInterInBars()
        let preferences = Preferences()
        _preferences = State(initialValue: preferences)
        let account = Account(preferences: preferences)
        _account = State(initialValue: account)
        _scheduled = State(initialValue: ScheduledStore(agents: account.agents))
    }

    var body: some Scene {
        WindowGroup {
            Themed {
                switch account.state {
                case .welcome: WelcomeView()
                case .demo, .signedIn: RootView()
                }
            }
            .environment(preferences)
            .environment(account)
            .environment(account.chats)
            .environment(scheduled)
            .onAppear { delegate.account = account }
            .onOpenURL { account.open($0) }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: Task { await account.returned() }
            case .background: account.leave()
            default: break
            }
        }
    }
}

/** Push: this iPhone's token, and what a notification does when it arrives or is tapped. */
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var account: Account? {
        didSet {
            if let token { account?.registeredForPush(token) }
            if let tapped {
                self.tapped = nil
                Task { await account?.open(tapped) }
            }
        }
    }
    private var token: String?
    private var tapped: AgentPointer?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        self.token = token
        account?.registeredForPush(token)
    }

    private func pointer(_ notification: UNNotification) -> AgentPointer? {
        let metadata = notification.request.content.userInfo["otter"] as? [String: Any]
        guard metadata?["userId"] as? String == account?.user?.id || account == nil else { return nil }
        return (metadata?["pointer"] as? [String: Any]).flatMap(AgentPointer.init)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if let pointer = pointer(response.notification) {
            if let account { Task { await account.open(pointer) } } else { tapped = pointer }
        }
        completionHandler()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        guard let pointer = pointer(notification), let account else { return completionHandler([]) }
        // The app is open: the relay's event already reads it in. The banner is for a chat that isn't on screen.
        completionHandler(account.shows(pointer) ? [.banner, .sound] : [])
    }
}
