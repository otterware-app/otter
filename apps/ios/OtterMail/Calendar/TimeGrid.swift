import Foundation

/**
 * Where a day's events sit in the Day page's hours, ported from the Mac and
 * web apps' apps/web/src/main/calendar/time-grid.tsx: the timed ones by their
 * times, in layoutDay's columns where they overlap and TimedEvent's widths;
 * those all day or a day or more long in the all-day row above.
 */
nonisolated enum TimeGrid {
    struct Placement: Hashable {
        var col: Int
        var cols: Int
    }

    /** TimeGrid's split: all day, or a day or more long, is in the all-day row. */
    static func inAllDayRow(_ event: CalendarEvent) -> Bool {
        event.allDay || event.end.timeIntervalSince(event.start) >= 24 * 3600
    }

    static func timed(_ events: [CalendarEvent], on day: Date, dates: CalendarDates) -> [CalendarEvent] {
        events.filter { !inAllDayRow($0) && EventDays.spans($0, day, dates: dates) }
    }

    static func allDay(_ events: [CalendarEvent], on day: Date, dates: CalendarDates) -> [CalendarEvent] {
        EventDays.sorted(events.filter { inAllDayRow($0) && EventDays.spans($0, day, dates: dates) })
    }

    /**
     * layoutDay: where they overlap, Notion Calendar's way, each cluster's
     * events take a column, a later one laid over the one before, so each
     * keeps more than its share. Keyed by the event's `id`. Overlaps are
     * measured in the clock minutes the blocks are drawn at, so two events in
     * the hour the clocks repeat sit side by side, not on top of each other.
     */
    static func columns(_ events: [CalendarEvent], on day: Date, dates: CalendarDates) -> [String: Placement] {
        let sorted = events.map { (event: $0, span: minutes($0, on: day, dates: dates)) }.sorted { a, b in
            if a.span.lowerBound != b.span.lowerBound { return a.span.lowerBound < b.span.lowerBound }
            if a.span.upperBound != b.span.upperBound { return a.span.upperBound > b.span.upperBound }
            return a.event.id < b.event.id
        }
        var placed: [String: Placement] = [:]
        var cluster: [String] = []
        var columns: [Double] = []
        var clusterEnd = -Double.infinity
        func close() {
            for id in cluster { placed[id]?.cols = columns.count }
            cluster = []
            columns = []
        }
        for (event, span) in sorted {
            let start = span.lowerBound
            let end = max(span.upperBound, start + 20)
            if start >= clusterEnd { close() }
            let col: Int
            if let free = columns.firstIndex(where: { $0 <= start }) {
                col = free
                columns[free] = end
            } else {
                col = columns.count
                columns.append(end)
            }
            placed[event.id] = Placement(col: col, cols: 0)
            cluster.append(event.id)
            clusterEnd = max(clusterEnd, end)
        }
        close()
        return placed
    }

    /** TimedEvent's left, as a share of the day's width. */
    static func leading(_ placement: Placement) -> Double {
        Double(placement.col) / Double(placement.cols)
    }

    /** TimedEvent's width: the last column takes what's left, the others half a column more than their share. */
    static func width(_ placement: Placement) -> Double {
        let rest = 1 - leading(placement)
        return placement.col == placement.cols - 1 ? rest : min(rest, 1.5 / Double(placement.cols))
    }

    /**
     * The minutes it covers on that day by the clock, clipped to the day: an
     * event across midnight shows its part on each. Clock time, not time since
     * midnight, so on the days the clocks change 09:00 is still at the 9 the
     * hour lines and the now line are drawn at. One across the clocks going
     * back covers the repeated hour by the clock twice, so it's drawn over all
     * of it: 02:45+02:00 to 02:15+01:00 in Berlin is 02:00–03:00, and one
     * ending as they go back, 01:00+02:00 to 02:00+01:00, is 01:00–03:00.
     */
    static func minutes(_ event: CalendarEvent, on day: Date, dates: CalendarDates) -> ClosedRange<Double> {
        let dayStart = dates.startOfDay(day)
        let dayEnd = dates.addDays(dayStart, 1)
        var from = clock(event.start, from: dayStart, to: dayEnd, dates: dates)
        var to = max(clock(event.end, from: dayStart, to: dayEnd, dates: dates), from)
        let zone = dates.calendar.timeZone
        if let turn = zone.nextDaylightSavingTimeTransition(after: max(event.start, dayStart)), turn <= event.end, turn < dayEnd {
            let repeated = zone.secondsFromGMT(for: turn.addingTimeInterval(-1)) - zone.secondsFromGMT(for: turn)
            if repeated > 0 {
                let after = clock(turn, from: dayStart, to: dayEnd, dates: dates)
                from = min(from, after)
                to = max(to, after + Double(repeated) / 60)
            }
        }
        return from...to
    }

    /** Minutes past the day's 00:00 on the clock, 0 before the day and 24 hours after it. */
    private static func clock(_ date: Date, from dayStart: Date, to dayEnd: Date, dates: CalendarDates) -> Double {
        if date <= dayStart { return 0 }
        if date >= dayEnd { return 24 * 60 }
        let parts = dates.calendar.dateComponents([.hour, .minute, .second], from: date)
        return Double(parts.hour ?? 0) * 60 + Double(parts.minute ?? 0) + Double(parts.second ?? 0) / 60
    }

    /**
     * How many lines of title a block of that height holds above its times
     * (3pt in at the top and foot, 1 between), as Apple's Calendar fills a
     * block from its top; nil under that, when it's one line: the title, and
     * its start beside it if they fit.
     */
    static func titleLines(height: Double, line: Double) -> Int? {
        let lines = Int((height - 7 - line) / line)
        return lines < 1 ? nil : lines
    }

    /**
     * The hour the grid opens at: two before now on today (TimeGrid's
     * openingHour), else the hour before the day's first event, else 8.
     */
    static func openingHour(_ timed: [CalendarEvent], on day: Date, now: Date, dates: CalendarDates) -> Int {
        if dates.sameDay(day, now) { return max(0, dates.calendar.component(.hour, from: now) - 2) }
        let dayStart = dates.startOfDay(day)
        guard let first = timed.map({ max($0.start, dayStart) }).min() else { return 8 }
        return max(0, (first > dayStart ? dates.calendar.component(.hour, from: first) : 0) - 1)
    }
}
