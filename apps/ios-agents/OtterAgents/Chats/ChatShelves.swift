import Foundation

/** Where a chat sits in the list (apps/web's chat-shelves.ts). */
nonisolated enum ChatShelf: CaseIterable {
    case pinned, active, snoozed, settled

    private static let hour = 60 * 60 * 1000
    private static let day = 24 * hour
    static let settleAfter = 7 * day

    /**
     * `working`: a turn runs in it here, so it doesn't settle for being idle. `needsYou`: the
     * agent asks for an approval or an answer, which outranks a snooze or settling. A pinned chat
     * never settles on its own.
     */
    static func of(_ chat: Chat, working: Bool, needsYou: Bool, now: Int) -> ChatShelf {
        let pinned = chat.pinnedAt != nil
        if needsYou { return pinned ? .pinned : .active }
        if let until = chat.snoozedUntil, until > now { return .snoozed }
        if chat.settledAt != nil { return .settled }
        if pinned { return .pinned }
        if !working, now - chat.updatedAt > settleAfter { return .settled }
        return .active
    }

    /** The chats on each shelf, in the order the list shows them. */
    static func shelve(_ chats: [Chat], working: Set<String>, needsYou: Set<String>, now: Int) -> [ChatShelf: [Chat]] {
        var shelves = Dictionary(grouping: chats) { of($0, working: working.contains($0.id), needsYou: needsYou.contains($0.id), now: now) }
        shelves[.pinned]?.sort { ($0.pinnedAt ?? 0) < ($1.pinnedAt ?? 0) }
        shelves[.active]?.sort { returnedAt($0, now) > returnedAt($1, now) }
        shelves[.snoozed]?.sort { ($0.snoozedUntil ?? 0) < ($1.snoozedUntil ?? 0) }
        shelves[.settled]?.sort { ($0.settledAt ?? $0.updatedAt) > ($1.settledAt ?? $1.updatedAt) }
        return shelves
    }

    /**
     * Where it sits among the active chats: when you made it, wrote in it or brought it back, or
     * its snooze ran out. Replies, renames and tabs don't move it.
     */
    static func returnedAt(_ chat: Chat, _ now: Int) -> Int {
        let woke = chat.snoozedUntil.flatMap { $0 <= now ? $0 : nil } ?? 0
        return max(chat.returnedAt ?? chat.updatedAt, woke)
    }

    struct SnoozePreset: Identifiable {
        var id: String
        var label: String
        var when: String
        var until: Int
    }

    static func snoozePresets(_ now: Date = .now, calendar: Calendar = .current) -> [SnoozePreset] {
        let at = { (days: Int, hour: Int) -> Date in
            // Calendar days, not 24 hours, so a DST change can't skip a day.
            let day = calendar.date(byAdding: .day, value: days, to: calendar.startOfDay(for: now)) ?? now
            return calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day) ?? day
        }
        var presets: [(String, String, Date)] = [
            ("hour", "In 1 hour", now.addingTimeInterval(3600)),
            ("three-hours", "In 3 hours", now.addingTimeInterval(3 * 3600)),
        ]
        let evening = at(0, 18)
        if evening.timeIntervalSince(now) > 3600 { presets.append(("evening", "This evening", evening)) }
        let tomorrow = at(1, 9)
        presets.append(("tomorrow", "Tomorrow", tomorrow))
        // Sunday is 1, so Monday is 2.
        let toMonday = (2 - calendar.component(.weekday, from: now) + 7) % 7
        let nextWeek = at(toMonday == 0 ? 7 : toMonday, 9)
        if nextWeek != tomorrow { presets.append(("next-week", "Next week", nextWeek)) }
        return presets.map { id, label, date in
            let time = date.formatted(date: .omitted, time: .shortened)
            let when = id == "next-week" ? "\(date.formatted(.dateTime.weekday(.abbreviated))) \(time)" : time
            return SnoozePreset(id: id, label: label, when: when, until: Int((date.timeIntervalSince1970 * 1000).rounded()))
        }
    }

    static func wakesIn(_ until: Int, _ now: Int) -> String {
        let left = until - now
        if left <= 0 { return "now" }
        if left < hour { return "\(max(1, Int((Double(left) / 60_000).rounded(.up))))m" }
        if left < day { return "\(Int((Double(left) / Double(hour)).rounded(.up)))h" }
        return "\(Int((Double(left) / Double(day)).rounded(.up)))d"
    }

    static func shortAgo(_ at: Int, _ now: Int) -> String {
        let minutes = (now - at) / 60_000
        if minutes < 1 { return "now" }
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h" }
        let days = hours / 24
        return days < 7 ? "\(days)d" : "\(days / 7)w"
    }

    /** What the chat used and made, from its tabs: "1 draft · 3 emails". */
    static func tabsSummary(_ tabs: [ChatTab]) -> String {
        [("draft", "draft"), ("thread", "email"), ("file", "file"), ("page", "page")].compactMap { kind, noun in
            let n = tabs.count { $0.ref.kind == kind }
            return n == 0 ? nil : "\(n) \(noun)\(n == 1 ? "" : "s")"
        }.joined(separator: " · ")
    }
}

nonisolated enum ChatText {
    static func clampTitle(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "New chat" }
        return trimmed.count > 56 ? "\(trimmed.prefix(56))…" : trimmed
    }

    /** When a message was sent, as T3 Code shows it: the time today, else the day too. */
    static func messageTime(_ at: Int, now: Date = .now, calendar: Calendar = .current) -> String {
        let date = Date(ms: at)
        let time = date.formatted(date: .omitted, time: .shortened)
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day ?? 0
        if days <= 0 { return time }
        if days == 1 { return "Yesterday at \(time)" }
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
        let day = date.formatted(sameYear ? .dateTime.month(.abbreviated).day() : .dateTime.month(.abbreviated).day().year())
        return "\(day), \(time)"
    }

    /** A message's time in its bubble: the day is in the pill above it. */
    static func clock(_ at: Int) -> String { Date(ms: at).formatted(date: .omitted, time: .shortened) }

    /** The day pill between messages, and a chat's time in the list, as WhatsApp says them: Today, Yesterday, Friday, 3 Nov. */
    static func day(_ at: Int, now: Date = .now, calendar: Calendar = .current, today: String? = "Today") -> String {
        let date = Date(ms: at)
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day ?? 0
        if days <= 0 { return today ?? date.formatted(date: .omitted, time: .shortened) }
        if days == 1 { return "Yesterday" }
        if days < 7 { return date.formatted(.dateTime.weekday(.wide)) }
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
        return date.formatted(sameYear ? .dateTime.day().month(.abbreviated) : .dateTime.day().month(.abbreviated).year())
    }

    /** "1m 5s", as the work log counts a turn. */
    static func duration(_ ms: Int) -> String {
        let seconds = max(0, ms / 1000)
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m \(seconds % 60)s" }
        return "\(minutes / 60)h \(minutes % 60)m"
    }

    /** The context block a message was sent with is the agent's to read, not shown. */
    static func stripHandoff(_ text: String) -> String {
        (text.components(separatedBy: "\n\n— context from Otter Mail —").first ?? text).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func isFileLink(_ href: String) -> Bool {
        if href.range(of: "^(file:|sandbox:|otter-artifact:|~/)", options: [.regularExpression, .caseInsensitive]) != nil { return true }
        return href.range(of: "^(?:[a-z][a-z\\d+.-]*:|//|#)", options: [.regularExpression, .caseInsensitive]) == nil
            && href.range(of: "\\.[a-z\\d]{1,10}(?::\\d+(?:-\\d+)?)?(?:[?#].*)?$", options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func isImageLink(_ href: String) -> Bool {
        href.range(of: "^data:image/(png|jpe?g|gif|webp|avif|bmp);base64,", options: [.regularExpression, .caseInsensitive]) != nil
            || href.range(of: "\\.(png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#].*)?$", options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func size(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}

nonisolated extension Chat {
    /**
     * Puts a delivery that just finished (the last turn) where it happened among the chat's
     * turns: one caught up on late, after messages sent since, goes before them.
     */
    mutating func placeDelivered() {
        guard let delivery = turns.last, delivery.delivered != nil, let started = delivery.startedAt else { return }
        guard let at = turns.dropLast().firstIndex(where: { ($0.startedAt ?? 0) > started }) else { return }
        // A reply goes with the message it answers.
        let before = at > 0 && turns[at].role == .assistant && turns[at - 1].role == .user ? at - 1 : at
        turns.removeLast()
        turns.insert(delivery, at: before)
    }
}
