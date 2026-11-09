import Foundation
import UserNotifications

/**
 * Which tasks get a local notification, what its request is called, and which
 * task a tapped one belongs to. Pure, so the decisions are tested
 * (OtterMailTests/TaskTests.swift): iOS keeps at most 64 pending requests per
 * app and mail's own alerts need room too, so only the nearest reminders are
 * scheduled (`scheduled`) and the rest wait (`waiting`) until those arrive.
 */
nonisolated enum TaskReminders {
    static let limit = 32
    static let key = "otterTask"
    private static let prefix = "otter-task"

    /** One request a task, named after it, so editing or finishing it replaces or removes that one. */
    static func identifier(_ id: UUID, scope: String) -> String { "\(prefix):\(scope):\(id.uuidString)" }

    /** The scope a pending request belongs to; nil for anything that isn't a task's. */
    static func scope(of identifier: String) -> String? {
        let parts = identifier.split(separator: ":", maxSplits: 2).map(String.init)
        guard parts.count == 3, parts[0] == prefix, !parts[1].isEmpty else { return nil }
        return parts[1]
    }

    /** The reminders worth keeping: still to come, nearest first, as many as the limit allows. */
    static func scheduled(_ tasks: [MailTask], now: Date = .now, limit: Int = limit) -> [MailTask] {
        Array(coming(tasks, now: now).prefix(max(limit, 0)))
    }

    /** The ones past the limit: iOS has no room for them until a nearer reminder has arrived. */
    static func waiting(_ tasks: [MailTask], now: Date = .now, limit: Int = limit) -> [MailTask] {
        Array(coming(tasks, now: now).dropFirst(max(limit, 0)))
    }

    private static func coming(_ tasks: [MailTask], now: Date) -> [MailTask] {
        tasks.filter { ($0.reminderAt ?? now) > now }.sorted { a, b in
            let (first, second) = (a.reminderAt ?? .distantFuture, b.reminderAt ?? .distantFuture)
            return first == second ? a.id.uuidString < b.id.uuidString : first < second
        }
    }

    /** What a reminder carries, so a tap finds its task again (`UNNotificationContent.userInfo`). */
    static func payload(_ task: MailTask, scope: String) -> [AnyHashable: Any] {
        [key: ["id": task.id.uuidString, "scope": scope]]
    }

    /** The task a tapped notification is for; nil for mail's, which route to a conversation. */
    static func destination(_ userInfo: [AnyHashable: Any]) -> TaskDestination? {
        guard let payload = userInfo[key] as? [String: Any],
              let id = (payload["id"] as? String).flatMap(UUID.init(uuidString:)),
              let scope = payload["scope"] as? String, !scope.isEmpty
        else { return nil }
        return TaskDestination(scope: scope, id: id)
    }
}

nonisolated struct TaskDestination: Equatable, Sendable {
    var scope: String
    var id: UUID
}

/** What the tasks ask of iOS's notifications, so the tests can stand in for it. */
nonisolated protocol TaskReminding: Sendable {
    func status() async -> UNAuthorizationStatus
    func ask() async
    func pending() async -> [String]
    func delivered() async -> [String]
    func remove(pending: [String], delivered: [String]) async
    func add(_ task: MailTask, scope: String) async
}

/** iOS's own notification center, one request a task. */
nonisolated struct LiveReminders: TaskReminding {
    private var center: UNUserNotificationCenter { .current() }

    func status() async -> UNAuthorizationStatus {
        await center.notificationSettings().authorizationStatus
    }

    func ask() async {
        _ = try? await center.requestAuthorization(options: [.alert, .sound])
    }

    func pending() async -> [String] {
        await center.pendingNotificationRequests().map(\.identifier)
    }

    func delivered() async -> [String] {
        await center.deliveredNotifications().map(\.request.identifier)
    }

    func remove(pending: [String], delivered: [String]) async {
        if !pending.isEmpty { center.removePendingNotificationRequests(withIdentifiers: pending) }
        if !delivered.isEmpty { center.removeDeliveredNotifications(withIdentifiers: delivered) }
    }

    /** The same identifier replaces its pending request, so an edited task keeps one. */
    func add(_ task: MailTask, scope: String) async {
        let content = UNMutableNotificationContent()
        content.title = task.content
        content.body = task.reminderBody
        content.sound = .default
        content.userInfo = TaskReminders.payload(task, scope: scope)
        let when = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: task.reminderAt ?? .now)
        try? await center.add(UNNotificationRequest(
            identifier: TaskReminders.identifier(task.id, scope: scope),
            content: content,
            trigger: UNCalendarNotificationTrigger(dateMatching: when, repeats: false)
        ))
    }
}
