import Foundation
import Sentry
import Synchronization

/** Scrubbed error reports to Sentry, as on the Mac and the web (docs/error-reports.md). */
nonisolated enum ErrorReports {
    static let dsn = "https://8ab23b52535e531f2b75f22d02dae47c@o4512364656459776.ingest.de.sentry.io/4512364735496272"
    static let enabledKey = "otter:errorReports"
    private static let idKey = "otter:reportID"
    private static let recent = Mutex<[String: Date]>([:])

    static var isRunning: Bool { SentrySDK.isEnabled }
    static var isOn: Bool { UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true }

    static var reportID: String {
        if let id = UserDefaults.standard.string(forKey: idKey) { return id }
        let id = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(12))
        UserDefaults.standard.set(id, forKey: idKey)
        return id
    }

    static func start() {
        #if DEBUG
        guard ProcessInfo.processInfo.environment["OTTER_MAIL_ERROR_REPORTS"] == "1" else { return }
        #endif
        guard !dsn.isEmpty else { return }
        let info = Bundle.main.infoDictionary ?? [:]
        SentrySDK.start { options in
            options.dsn = dsn
            options.releaseName = "otter-mail-ios@\(info["CFBundleShortVersionString"] ?? "0")+\(info["CFBundleVersion"] ?? "0")"
            #if DEBUG
            options.environment = "development"
            #else
            options.environment = "production"
            #endif
            options.sendDefaultPii = false
            options.maxBreadcrumbs = 50
            options.sendClientReports = false
            options.enableCrashHandler = true
            options.tracesSampleRate = 0
            options.enableAutoPerformanceTracing = false
            options.enableAutoSessionTracking = false
            options.sessionReplay.sessionSampleRate = 0
            options.sessionReplay.onErrorSampleRate = 0
            options.attachScreenshot = false
            options.attachViewHierarchy = false
            options.enableSwizzling = false
            options.enableUserInteractionTracing = false
            options.enableAutoBreadcrumbTracking = false
            options.enableNetworkBreadcrumbs = false
            options.enableNetworkTracking = false
            options.enableCaptureFailedRequests = false
            options.enableLogs = false
            options.beforeBreadcrumb = { Scrubber.scrub($0) }
            options.beforeSend = { isOn ? Scrubber.scrub($0) : nil }
        }
        SentrySDK.setUser(User(userId: reportID))
    }

    /** Offline, timeouts and rate limits are breadcrumbs; what the user did (cancelled, signed out) is nothing. */
    static func capture(_ error: Error, scope: String, tags: [String: String] = [:]) {
        guard isRunning, !isExpected(error) else { return }
        let message = Scrubber.scrub("\(type(of: error)): \(error.localizedDescription)")
        if isTransient(error) { return note(message, scope: scope) }
        let now = Date.now
        let fresh = recent.withLock { recent in
            let key = scope + "\n" + message
            if let last = recent[key], now.timeIntervalSince(last) < 600 { return false }
            if recent.count > 500 { recent.removeAll() }
            recent[key] = now
            return true
        }
        guard fresh else { return }
        SentrySDK.capture(error: error) { report in
            report.setTag(value: scope, key: "scope")
            for (key, value) in tags { report.setTag(value: value, key: key) }
            report.setContext(value: ["message": message], key: "log")
        }
    }

    static func note(_ message: String, scope: String) {
        guard isRunning else { return }
        let breadcrumb = Breadcrumb(level: .info, category: scope)
        breadcrumb.message = Scrubber.scrub(message)
        SentrySDK.addBreadcrumb(breadcrumb)
    }

    private static func isExpected(_ error: Error) -> Bool {
        switch error {
        case is CancellationError: true
        case let error as URLError: error.code == .cancelled
        case GoogleAuth.Failure.cancelled, GoogleAuth.Failure.signedOut, MicrosoftAuth.Failure.cancelled, MicrosoftAuth.Failure.signedOut: true
        case let error as ImapError: error.isSignedOut
        default: status(error) == 401
        }
    }

    private static func isTransient(_ error: Error) -> Bool {
        if let error = error as? URLError {
            return [.notConnectedToInternet, .timedOut, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff].contains(error.code)
        }
        return status(error) == 429
    }

    private static func status(_ error: Error) -> Int? {
        (error as? Relay.Failure)?.status ?? (error as? GmailAPI.Failure)?.status ?? (error as? GraphAPI.Failure)?.status
    }
}
