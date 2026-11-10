import Foundation

/** When a task runs, in words, and the editor's fields for it (apps/web's scheduled-text.ts). */
nonisolated enum ScheduleText {
    private static let days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    private static let minute = 60_000, hour = 3_600_000, day = 86_400_000

    static var localTimeZone: String { TimeZone.current.identifier }

    private static func clock(_ hour: Int, _ minute: Int) -> String {
        let date = Calendar.current.date(from: DateComponents(year: 2000, month: 1, day: 1, hour: hour, minute: minute)) ?? .now
        return date.formatted(date: .omitted, time: .shortened)
    }

    private static func ordinal(_ n: Int) -> String {
        if (11...13).contains(n % 100) { return "\(n)th" }
        return "\(n)\(["th", "st", "nd", "rd"][safe: n % 10] ?? "th")"
    }

    private static func plural(_ n: Int, _ unit: String) -> String { n == 1 ? unit : "\(n) \(unit)s" }

    static func every(_ ms: Int) -> String {
        if ms % day == 0 { return "Every \(plural(ms / day, "day"))" }
        if ms % hour == 0 { return "Every \(plural(ms / hour, "hour"))" }
        if ms % minute == 0 { return "Every \(plural(ms / minute, "minute"))" }
        return "Every \(plural(Int((Double(ms) / 1000).rounded()), "second"))"
    }

    private static func number(_ field: String) -> Int? { field.allSatisfy(\.isNumber) ? Int(field) : nil }

    private static func step(_ field: String) -> Int? { field.hasPrefix("*/") ? number(String(field.dropFirst(2))) : nil }

    /** Days of the week a cron field names (`1-5`, `1,3,5`, `0`), or nil for anything else. */
    private static func weekdays(_ field: String) -> [Int]? {
        var found: Set<Int> = []
        for part in field.split(separator: ",") {
            let ends = part.split(separator: "-").compactMap { Int($0) }
            if part.contains("-"), ends.count == 2, ends[0] <= ends[1], ends[1] <= 7 {
                for d in ends[0]...ends[1] { found.insert(d % 7) }
            } else if let d = Int(part), (0...7).contains(d), part.count == 1 {
                found.insert(d % 7)
            } else {
                return nil
            }
        }
        return found.isEmpty ? nil : found.sorted()
    }

    /** A cron expression in words, for the common shapes; nil for the rest. */
    static func cron(_ expr: String) -> String? {
        let fields = expr.split(whereSeparator: \.isWhitespace).map(String.init)
        guard fields.count == 5 else { return nil }
        let (minute, hour, dom, month, dow) = (fields[0], fields[1], fields[2], fields[3], fields[4])
        if month != "*" || (dom != "*" && dow != "*") { return nil }
        if hour == "*", dom == "*", dow == "*" {
            if minute == "*" { return "Every minute" }
            if let m = step(minute) { return "Every \(plural(m, "minute"))" }
            if number(minute) != nil { return minute == "0" ? "Every hour" : "Hourly at :\(minute.count < 2 ? "0" + minute : minute)" }
            return nil
        }
        if let hours = step(hour), number(minute) != nil, dom == "*", dow == "*" { return "Every \(plural(hours, "hour"))" }
        guard let m = number(minute), let h = number(hour) else { return nil }
        let at = clock(h, m)
        if dom != "*" { return number(dom).map { "Monthly on the \(ordinal($0)) at \(at)" } }
        if dow == "*" { return "Every day at \(at)" }
        guard let days = weekdays(dow) else { return nil }
        if days == [1, 2, 3, 4, 5] { return "Weekdays at \(at)" }
        if days == [0, 6] { return "Weekends at \(at)" }
        if days.count == 7 { return "Every day at \(at)" }
        if days.count == 1 { return "Every \(Self.days[days[0]]) at \(at)" }
        return "\(days.map { String(Self.days[$0].prefix(3)) }.joined(separator: ", ")) at \(at)"
    }

    static func date(iso: String) -> Date? {
        (try? Date(iso, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true))) ?? (try? Date(iso, strategy: .iso8601))
    }

    /** When a task runs, in words: "Weekdays at 8:00 AM", "Every 2 hours", "Once, Mon 9 Nov, 9:00 AM". */
    static func schedule(_ schedule: ScheduledTask.Schedule) -> String {
        switch schedule {
        case .every(let ms): return every(ms)
        case .at(let iso):
            guard let date = date(iso: iso) else { return "Once" }
            return "Once, \(date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute()))"
        case .other(let text): return text
        case .cron(let expr, let tz):
            let text = cron(expr) ?? "Cron \(expr)"
            if let tz, tz != localTimeZone { return "\(text) (\(tz))" }
            return text
        }
    }

    /** A day and time near now: "today at 6:47 PM", "tomorrow at 9:00 AM", "Monday at…". */
    static func dayTime(_ at: Int, now: Date = .now, calendar: Calendar = .current) -> String {
        let date = Date(ms: at)
        let time = date.formatted(date: .omitted, time: .shortened)
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 0
        switch days {
        case 0: return "today at \(time)"
        case 1: return "tomorrow at \(time)"
        case -1: return "yesterday at \(time)"
        case 2..<7: return "\(Self.days[calendar.component(.weekday, from: date) - 1]) at \(time)"
        default: return "\(date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))) at \(time)"
        }
    }

    /** How long until then: "in 5 min", "in 3 h", "in 2 days"; "now" once it's due. */
    static func until(_ at: Int, now: Int = .now) -> String {
        let left = at - now
        if left < minute { return "now" }
        if left < hour { return "in \(Int((Double(left) / Double(minute)).rounded())) min" }
        if left < day { return "in \(Int((Double(left) / Double(hour)).rounded())) h" }
        let days = Int((Double(left) / Double(day)).rounded())
        return "in \(days) \(days == 1 ? "day" : "days")"
    }

    static func duration(_ ms: Int) -> String {
        if ms < 1000 { return "\(ms) ms" }
        if ms < minute { return "\(Int((Double(ms) / 1000).rounded())) s" }
        return "\(ms / minute) min \(Int((Double(ms % minute) / 1000).rounded())) s"
    }
}

/** The editor's "when", in the fields a person picks. */
nonisolated struct WhenForm: Equatable {
    enum Repeat: String, CaseIterable, Identifiable {
        case daily, weekdays, weekly, monthly, interval, once, cron
        var id: String { rawValue }
        var title: String {
            switch self {
            case .daily: "Every day"
            case .weekdays: "Weekdays"
            case .weekly: "Every week"
            case .monthly: "Every month"
            case .interval: "Every few minutes or hours"
            case .once: "Once"
            case .cron: "Custom (cron)"
            }
        }
    }

    var `repeat` = Repeat.daily
    var hour = 9
    var minute = 0
    /** Sunday is 0. */
    var weekday = 1
    var monthDay = 1
    var every = 1
    var hours = true
    var once: Date
    var cron = "0 9 * * *"
    /** Empty is the agent's own zone: kept, not replaced with this device's. */
    var tz: String

    init(now: Date = .now, calendar: Calendar = .current) {
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now
        once = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrow) ?? tomorrow
        tz = ScheduleText.localTimeZone
    }

    /** A schedule as the editor shows it; one it has no fields for is a cron expression, or can't be edited. */
    init?(_ schedule: ScheduledTask.Schedule, now: Date = .now) {
        self.init(now: now)
        switch schedule {
        case .other: return nil
        case .at(let iso):
            guard let date = ScheduleText.date(iso: iso) else { return nil }
            `repeat` = .once
            once = date
        case .every(let ms):
            `repeat` = .interval
            hours = ms % 3_600_000 == 0
            every = max(1, Int((Double(ms) / (hours ? 3_600_000 : 60_000)).rounded()))
        case .cron(let expr, let zone):
            tz = zone ?? ""
            `repeat` = .cron
            cron = expr
            let fields = expr.split(whereSeparator: \.isWhitespace).map(String.init)
            guard fields.count == 5, fields[3] == "*", fields[0].allSatisfy(\.isNumber), fields[1].allSatisfy(\.isNumber),
                  let m = Int(fields[0]), let h = Int(fields[1]) else { return }
            let (dom, dow) = (fields[2], fields[4])
            var timed = self
            timed.hour = h
            timed.minute = m
            if dom == "*", dow == "*" { timed.repeat = .daily }
            else if dom == "*", dow == "1-5" { timed.repeat = .weekdays }
            else if dom == "*", dow.count == 1, let d = Int(dow), (0...7).contains(d) {
                timed.repeat = .weekly
                timed.weekday = d % 7
            } else if dow == "*", let d = Int(dom), (1...31).contains(d) {
                timed.repeat = .monthly
                timed.monthDay = d
            } else {
                return
            }
            self = timed
        }
    }

    var schedule: ScheduledTask.Schedule {
        let at = "\(minute) \(hour)"
        let zone = tz.isEmpty ? nil : tz
        switch `repeat` {
        case .daily: return .cron(expr: "\(at) * * *", tz: zone)
        case .weekdays: return .cron(expr: "\(at) * * 1-5", tz: zone)
        case .weekly: return .cron(expr: "\(at) * * \(weekday)", tz: zone)
        case .monthly: return .cron(expr: "\(at) \(monthDay) * *", tz: zone)
        case .interval: return .every(ms: max(1, every) * (hours ? 3_600_000 : 60_000))
        case .once: return .at(once.formatted(.iso8601.year().month().day().time(includingFractionalSeconds: true)))
        case .cron: return .cron(expr: cron.trimmingCharacters(in: .whitespaces), tz: zone)
        }
    }

    /** What's wrong with the "when", if anything. */
    func problem(now: Date = .now) -> String? {
        switch `repeat` {
        case .once where once <= now: "Pick a time in the future."
        case .interval where every < 1: "Run it at least every minute."
        case .cron where ![5, 6].contains(cron.split(whereSeparator: \.isWhitespace).count):
            "A cron expression has five fields: minute hour day month weekday."
        default: nil
        }
    }
}

nonisolated extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
