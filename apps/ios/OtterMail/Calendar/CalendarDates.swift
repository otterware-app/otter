import Foundation

/** What the calendar screen is looking at: the web app's modes (CALENDAR_MODES) and the phone's own Agenda. */
nonisolated enum CalendarMode: String, CaseIterable, Identifiable {
    case day, week, month, agenda

    /** The phone's picker and swipe pages, left to right; Week stays the Mac and web apps' own. */
    static let phone: [CalendarMode] = [.agenda, .day, .month]

    var id: String { rawValue }
    var title: String { rawValue.capitalized }

    /** The page `by` steps along `phone`, none past either end. */
    func neighbour(_ by: Int) -> CalendarMode? {
        guard let index = Self.phone.firstIndex(of: self), Self.phone.indices.contains(index + by) else { return nil }
        return Self.phone[index + by]
    }

    /** The page a turn came to rest on, nil when it's this one (or not one of the phone's). */
    func settling(on page: CalendarMode?) -> CalendarMode? {
        guard let page, page != self, Self.phone.contains(page) else { return nil }
        return page
    }
}

nonisolated struct EventWindow: Hashable {
    var from: Date
    var to: Date
}

/**
 * The calendar's dates, ported from apps/web/src/main/calendar/dates.ts: the
 * week starts where `calendar:week-start` says, stepping counts only weekdays
 * when `calendar:show-weekends` is off, and times read as
 * `calendar:time-format` asks. Every day is a local day, so an event is on the
 * days it covers where the user is.
 */
nonisolated struct CalendarDates {
    /** How far ahead the agenda looks. */
    static let agendaDays = 120

    var calendar: Calendar
    var preferences: CalendarPreferences

    init(calendar: Calendar = .current, preferences: CalendarPreferences = CalendarPreferences()) {
        self.calendar = calendar
        self.preferences = preferences
    }

    /** 0 Sunday … 6 Saturday; `auto` is the region's own first day. */
    var weekStart: Int {
        switch preferences.weekStart {
        case .auto: (calendar.firstWeekday - 1) % 7
        case .sunday: 0
        case .monday: 1
        case .saturday: 6
        }
    }

    /** A single day is always itself, whatever the weekends setting says. */
    func showsWeekends(_ mode: CalendarMode) -> Bool {
        preferences.showWeekends || mode == .day
    }

    func weekday(_ date: Date) -> Int { calendar.component(.weekday, from: date) - 1 }

    func isWeekend(_ date: Date) -> Bool { weekday(date) == 0 || weekday(date) == 6 }

    func startOfDay(_ date: Date) -> Date { calendar.startOfDay(for: date) }

    func addDays(_ date: Date, _ days: Int) -> Date {
        calendar.date(byAdding: .day, value: days, to: date) ?? date
    }

    func startOfWeek(_ date: Date) -> Date {
        let day = startOfDay(date)
        return addDays(day, -((weekday(day) - weekStart + 7) % 7))
    }

    func startOfMonth(_ date: Date) -> Date {
        calendar.date(from: calendar.dateComponents([.year, .month], from: date)) ?? startOfDay(date)
    }

    func sameDay(_ a: Date, _ b: Date) -> Bool { calendar.isDate(a, inSameDayAs: b) }

    /**
     * YYYY-MM-DD where the phone is: all-day events' dates, and a day's own name.
     * Always Gregorian, as Google reads it (`EventTimes.day`), whichever calendar the phone shows.
     */
    func dayKey(_ date: Date) -> String {
        var gregorian = Calendar(identifier: .gregorian)
        gregorian.timeZone = calendar.timeZone
        let parts = gregorian.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /** `by` days on, counting only weekdays when weekends are hidden; from a weekend, the next weekday is 0. */
    func stepDays(_ date: Date, _ by: Int, weekends: Bool = true) -> Date {
        if weekends { return addDays(date, by) }
        var day = startOfDay(date)
        while isWeekend(day) { day = addDays(day, 1) }
        var left = abs(by)
        while left > 0 {
            day = addDays(day, by > 0 ? 1 : -1)
            if !isWeekend(day) { left -= 1 }
        }
        return day
    }

    /** The days a mode lists; `free` leads the week with the day shown rather than the week's first. */
    func visibleDays(_ mode: CalendarMode, _ date: Date, free: Bool = false, weekends: Bool = true) -> [Date] {
        switch mode {
        case .day:
            return [startOfDay(date)]
        case .agenda:
            return (0..<Self.agendaDays).map { addDays(startOfDay(date), $0) }
        case .week:
            let first = stepDays(free ? startOfDay(date) : startOfWeek(date), 0, weekends: weekends)
            return (0..<(weekends ? 7 : 5)).map { stepDays(first, $0, weekends: weekends) }
        case .month:
            let month = startOfMonth(date)
            let first = startOfWeek(month)
            let last = calendar.date(byAdding: DateComponents(month: 1, day: -1), to: month) ?? month
            let spanned = (calendar.dateComponents([.day], from: first, to: last).day ?? 0) + 1
            let weeks = max(Int((Double(spanned) / 7).rounded(.up)), 5)
            let days = (0..<(weeks * 7)).map { addDays(first, $0) }
            return weekends ? days : days.filter { !isWeekend($0) }
        }
    }

    func step(_ mode: CalendarMode, _ date: Date, by: Int) -> Date {
        switch mode {
        case .day: addDays(date, by)
        case .week: addDays(date, by * 7)
        case .month: calendar.date(byAdding: .month, value: by, to: startOfMonth(date)) ?? date
        // The agenda is the days ahead from today and doesn't step.
        case .agenda: date
        }
    }

    /**
     * What a mode asks the provider for. Weekends are fetched even when they
     * are hidden, so turning them off doesn't ask Google again.
     */
    func window(_ mode: CalendarMode, anchor: Date) -> EventWindow {
        if mode == .agenda {
            let from = startOfDay(anchor)
            return EventWindow(from: from, to: addDays(from, Self.agendaDays))
        }
        let days = visibleDays(mode, anchor)
        let from = days.first ?? startOfDay(anchor)
        return EventWindow(from: from, to: addDays(days.last ?? from, 1))
    }

    func days(in window: EventWindow) -> [Date] {
        var days: [Date] = []
        var day = startOfDay(window.from)
        while day < window.to, days.count < 400 {
            days.append(day)
            day = addDays(day, 1)
        }
        return days
    }

    var hour12: Bool {
        switch preferences.timeFormat {
        case .twelve: true
        case .twentyFour: false
        case .auto: DateFormatter.dateFormat(fromTemplate: "j", options: 0, locale: locale)?.contains("a") ?? false
        }
    }

    /** "09:00", or "9 AM" where the clock runs to twelve: the web app's timeLabel. */
    func timeLabel(_ date: Date) -> String {
        guard hour12 else { return fixed("HH:mm").string(from: date) }
        let text = fixed("h:mm a").string(from: date)
        guard let minutes = text.range(of: ":00"),
              minutes.upperBound == text.endIndex || text[minutes.upperBound].isWhitespace
        else { return text }
        return text.replacingCharacters(in: minutes, with: "")
    }

    /** A grid's hour, "09:00" or "9 AM": the web app's hourLabel. */
    func hourLabel(_ hour: Int) -> String {
        let date = calendar.date(from: DateComponents(year: 2000, month: 1, day: 1, hour: hour)) ?? .now
        return fixed(hour12 ? "h a" : "HH:mm").string(from: date)
    }

    /** "9–10 AM": the start drops the suffix the end repeats (event-style.ts's rangeLabel). */
    func rangeLabel(_ start: Date, _ end: Date) -> String {
        let first = timeLabel(start)
        let last = timeLabel(end)
        guard let suffix = meridiem(first), last.hasSuffix(suffix.trimmingCharacters(in: .whitespaces)) else {
            return "\(first)–\(last)"
        }
        return "\(first.dropLast(suffix.count))–\(last)"
    }

    /** "45min", "1h", "1h 30min". */
    static func durationLabel(_ seconds: TimeInterval) -> String {
        let minutes = Int((seconds / 60).rounded())
        let (hours, rest) = (minutes / 60, minutes % 60)
        if hours == 0 { return "\(rest)min" }
        return rest == 0 ? "\(hours)h" : "\(hours)h \(rest)min"
    }

    func weekdayShort(_ date: Date) -> String { localized("EEE").string(from: date) }

    func monthTitle(_ date: Date) -> String { localized("MMMMy").string(from: date) }

    func dayTitle(_ date: Date) -> String { localized("MMMMdy").string(from: date) }

    /** "May 4, 2026 · 9–10 AM · 1h", or the days an all-day or longer event covers. */
    func when(_ event: CalendarEvent) -> String {
        let first = startOfDay(event.start)
        let last = EventDays.endDay(of: event, dates: self)
        if event.allDay {
            return last > first ? "\(dayTitle(first)) – \(dayTitle(last))" : "All-day · \(dayTitle(first))"
        }
        if last > first {
            return "\(dayTitle(first)), \(timeLabel(event.start)) – \(dayTitle(last)), \(timeLabel(event.end))"
        }
        let length = Self.durationLabel(event.end.timeIntervalSince(event.start))
        return "\(dayTitle(first)) · \(rangeLabel(event.start, event.end)) · \(length)"
    }

    /** "Monday, November 9": the Day page's title, short enough for one line. */
    func dayHeading(_ date: Date) -> String { localized("EEEEMMMMd").string(from: date) }

    /**
     * "Today", "Tomorrow", "Yesterday", else the short date: the headings of
     * the agenda (agenda.tsx's dayTitle) and of a week's or month's day, which
     * can be behind today, as format.ts's formatRelativeDay names it.
     */
    func heading(_ day: Date, now: Date = .now) -> String {
        if sameDay(day, now) { return "Today" }
        if sameDay(day, addDays(startOfDay(now), 1)) { return "Tomorrow" }
        if sameDay(day, addDays(startOfDay(now), -1)) { return "Yesterday" }
        let thisYear = calendar.component(.year, from: day) == calendar.component(.year, from: now)
        return localized(thisYear ? "EEEMMMd" : "EEEMMMdy").string(from: day)
    }

    /** The zone's short name at an instant, as format.ts's formatZoneName gives it: "GMT+2" or "PDT". */
    func zoneName(_ date: Date) -> String { fixed("zzz").string(from: date) }

    /**
     * An event's time read in the zone it was made in, when that zone's clock
     * differs from the phone's: the event screen's third line in the mobile
     * calendar (CalendarEventRouteScreen's eventWhen).
     */
    func elsewhere(_ start: Date, _ end: Date, zone identifier: String?) -> String? {
        guard let identifier, let zone = TimeZone(identifier: identifier),
              zone.secondsFromGMT(for: start) != calendar.timeZone.secondsFromGMT(for: start)
        else { return nil }
        var there = self
        there.calendar.timeZone = zone
        let name = identifier.replacingOccurrences(of: "_", with: " ")
        return "\(there.rangeLabel(start, end)) \(there.zoneName(start)) (\(name))"
    }

    private var locale: Locale { calendar.locale ?? .current }

    private func formatter() -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        return formatter
    }

    /** A clock the time format decides, not the region's. */
    private func fixed(_ format: String) -> DateFormatter {
        let formatter = self.formatter()
        formatter.dateFormat = format
        return formatter
    }

    private func localized(_ template: String) -> DateFormatter {
        let formatter = self.formatter()
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter
    }

    private func meridiem(_ text: String) -> String? {
        let symbols = fixed("a")
        for symbol in [symbols.amSymbol, symbols.pmSymbol].compactMap({ $0 }) where !symbol.isEmpty {
            if text.hasSuffix(" " + symbol) { return " " + symbol }
            if text.hasSuffix(symbol) { return symbol }
        }
        return nil
    }
}
