import Foundation
import Sentry

/** packages/shared/src/error-reports.ts's scrubber, rule for rule. */
nonisolated enum Scrubber {
    private static let rules: [(NSRegularExpression, String)] = [
        // Ends in a letter: `otter-mail-ios@1.2.3` is a release, not an address.
        (#"[\w.+-]+(?:@|%40)[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b(/[^\s"'<>?#]*)?"#, "[email]", true),
        (#"\b([Bb]earer|[Bb]asic)\s+[\w.~+/=-]+"#, "$1 [redacted]", false),
        (#"\beyJ[\w-]+\.[\w-]+\.[\w-]*"#, "[token]", false),
        (#"\bya29\.[\w.-]+|\b1//[\w-]{20,}"#, "[token]", false),
        (#"(\b[a-z][\w+.-]*://[^\s?"'<>]*)\?[^\s"'<>#]*"#, "$1", true),
        (#"(/Users/|/home/|\\Users\\)[^/\\\s"']+"#, "$1[user]", false),
        (#"[\w+=-]{48,}"#, "[redacted]", false),
    ].map { pattern, template, ignoringCase in
        (try! NSRegularExpression(pattern: pattern, options: ignoringCase ? .caseInsensitive : []), template)
    }

    static func scrub(_ text: String) -> String {
        let out = rules.reduce(text) { text, rule in
            rule.0.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: rule.1)
        }
        return out.count > 2_000 ? String(out.prefix(2_000)) + "…" : out
    }

    static func scrub(_ value: Any) -> Any {
        switch value {
        case let text as String: scrub(text)
        case let list as [Any]: list.map(scrub)
        case let object as [String: Any]: scrub(object)
        default: value
        }
    }

    static func scrub(_ object: [String: Any]) -> [String: Any] { object.mapValues(scrub) }

    static func scrub(_ event: Event) -> Event {
        if let message = event.message { event.message = SentryMessage(formatted: scrub(message.formatted)) }
        for exception in event.exceptions ?? [] {
            exception.value = exception.value.map(scrub)
            exception.mechanism?.desc = exception.mechanism?.desc.map(scrub)
            exception.mechanism?.data = exception.mechanism?.data.map(scrub)
            exception.stacktrace.map(scrub)
        }
        for thread in event.threads ?? [] { thread.stacktrace.map(scrub) }
        event.stacktrace.map(scrub)
        event.breadcrumbs = event.breadcrumbs?.compactMap(scrub)
        event.extra = event.extra.map(scrub)
        event.context = event.context?.mapValues(scrub)
        event.tags = event.tags?.mapValues(scrub)
        event.fingerprint = event.fingerprint?.map(scrub)
        event.transaction = event.transaction.map(scrub)
        event.logger = event.logger.map(scrub)
        event.serverName = nil
        event.user = event.user?.userId.map { User(userId: $0) }
        // Sentry otherwise places the sender by its IP address (a city) before it drops it.
        event.sdk = (event.sdk ?? [:]).merging(["settings": ["infer_ip": "never"]]) { _, new in new }
        if let url = event.request?.url {
            let request = SentryRequest()
            request.url = scrub(url)
            event.request = request
        } else {
            event.request = nil
        }
        return event
    }

    static func scrub(_ breadcrumb: Breadcrumb) -> Breadcrumb? {
        if breadcrumb.category == "console" || breadcrumb.category.hasPrefix("ui.") { return nil }
        breadcrumb.message = breadcrumb.message.map(scrub)
        for (key, value) in breadcrumb.data ?? [:] { breadcrumb.setData(value: scrub(value), key: key) }
        return breadcrumb
    }

    private static func scrub(_ stacktrace: SentryStacktrace) {
        for frame in stacktrace.frames {
            frame.fileName = frame.fileName.map(scrub)
            frame.package = frame.package.map(scrub)
            frame.function = frame.function.map(scrub)
            frame.vars = nil
        }
    }
}
