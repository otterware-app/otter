import Foundation
import SwiftUI
import Testing
@testable import Otter_Mail

/**
 * The Day page's grid and the Month page's week, as ported from
 * apps/web/src/main/calendar/time-grid.tsx (layoutDay, TimedEvent's widths,
 * openingHour) and dates.ts (visibleDays' week).
 */
struct TimeGridTests {
    private let mine = EventCalendar(id: "primary", name: "Robin", primary: true, account: "robin@otter.example")

    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Berlin")!
        calendar.firstWeekday = 2
        calendar.locale = Locale(identifier: "en_US")
        return calendar
    }

    private var dates: CalendarDates { CalendarDates(calendar: calendar) }

    private func at(_ day: Int, _ hour: Int, _ minute: Int = 0, month: Int = 11) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute))!
    }

    private func event(_ id: String, _ start: Date, _ end: Date, allDay: Bool = false) -> CalendarEvent {
        CalendarEvent(eventId: id, calendar: mine, title: id, start: start, end: end, allDay: allDay)
    }

    private func placed(_ events: [CalendarEvent], on day: Date? = nil) -> [String: [Int]] {
        TimeGrid.columns(events, on: day ?? at(4, 0), dates: dates).reduce(into: [:]) { result, entry in
            result[String(entry.key.split(separator: "/").last!)] = [entry.value.col, entry.value.cols]
        }
    }

    @Test func eventsApartEachTakeTheWholeDay() {
        let layout = placed([event("a", at(4, 9), at(4, 10)), event("b", at(4, 10), at(4, 11))])
        #expect(layout == ["a": [0, 1], "b": [0, 1]])
    }

    @Test func overlappingEventsSitSideBySide() {
        let layout = placed([
            event("lunch", at(4, 12, 30), at(4, 13, 30)),
            event("call", at(4, 13), at(4, 13, 45)),
        ])
        #expect(layout == ["lunch": [0, 2], "call": [1, 2]])
    }

    /** A cluster holds as many columns as it ever needed; a freed column is reused within it. */
    @Test func aClusterReusesAFreedColumn() {
        let layout = placed([
            event("long", at(4, 9), at(4, 12)),
            event("first", at(4, 9), at(4, 10)),
            event("second", at(4, 10), at(4, 11)),
            event("later", at(4, 13), at(4, 14)),
        ])
        #expect(layout["long"] == [0, 2])
        #expect(layout["first"] == [1, 2])
        #expect(layout["second"] == [1, 2])
        #expect(layout["later"] == [0, 1])
    }

    /** layoutDay gives each event at least 20 minutes, so a short one doesn't hide under the next. */
    @Test func aShortEventHoldsTwentyMinutes() {
        let layout = placed([event("blip", at(4, 9), at(4, 9, 5)), event("next", at(4, 9, 15), at(4, 10))])
        #expect(layout == ["blip": [0, 2], "next": [1, 2]])
    }

    @Test func startingTogetherTheLongerLeads() {
        let layout = placed([event("short", at(4, 9), at(4, 9, 30)), event("long", at(4, 9), at(4, 11))])
        #expect(layout == ["long": [0, 2], "short": [1, 2]])
    }

    @Test func widthsAreTimedEventsOwn() {
        #expect(TimeGrid.width(.init(col: 0, cols: 1)) == 1)
        #expect(TimeGrid.width(.init(col: 0, cols: 2)) == 0.75)
        #expect(TimeGrid.width(.init(col: 1, cols: 2)) == 0.5)
        #expect(TimeGrid.leading(.init(col: 1, cols: 2)) == 0.5)
        #expect(abs(TimeGrid.width(.init(col: 0, cols: 3)) - 0.5) < 1e-9)
        #expect(abs(TimeGrid.width(.init(col: 2, cols: 3)) - 1.0 / 3) < 1e-9)
    }

    @Test func aNightEventIsClippedToEachDay() {
        let train = event("train", at(12, 22, 40), at(13, 7, 15))
        #expect(TimeGrid.minutes(train, on: at(12, 0), dates: dates) == (22 * 60 + 40)...1440)
        #expect(TimeGrid.minutes(train, on: at(13, 0), dates: dates) == 0...(7 * 60 + 15))
        #expect(TimeGrid.timed([train], on: at(12, 0), dates: dates).count == 1)
        #expect(TimeGrid.timed([train], on: at(13, 0), dates: dates).count == 1)
        #expect(TimeGrid.timed([train], on: at(14, 0), dates: dates).isEmpty)
    }

    @Test func endingAtMidnightIsntOnTheNextDay() {
        let late = event("late", at(4, 23), at(5, 0))
        #expect(TimeGrid.timed([late], on: at(4, 0), dates: dates).count == 1)
        #expect(TimeGrid.timed([late], on: at(5, 0), dates: dates).isEmpty)
        #expect(TimeGrid.minutes(late, on: at(4, 0), dates: dates) == (23 * 60)...1440)
    }

    /** The clocks go back on Oct 25, 2026 in Berlin: a 25-hour day still fits the grid's 24. */
    @Test func aLongDayStaysInTheGrid() {
        let day = at(25, 0, month: 10)
        let whole = event("whole", day, dates.addDays(day, 1))
        #expect(TimeGrid.minutes(whole, on: day, dates: dates).upperBound == 1440)
    }

    /** On the days the clocks change in Berlin, 09:00 is still at the grid's 9. */
    @Test func placesEventsByTheClockOnTheDaysItChanges() {
        let forward = event("forward", at(29, 9, month: 3), at(29, 10, month: 3))
        #expect(TimeGrid.minutes(forward, on: at(29, 0, month: 3), dates: dates) == (9 * 60)...(10 * 60))
        let back = event("back", at(25, 9, month: 10), at(25, 10, month: 10))
        #expect(TimeGrid.minutes(back, on: at(25, 0, month: 10), dates: dates) == (9 * 60)...(10 * 60))
        #expect(TimeGrid.openingHour([back], on: at(25, 0, month: 10), now: at(4, 12), dates: dates) == 8)
    }

    /** 02:00–02:30 comes twice in Berlin on Oct 25, 2026 (+02:00, then +01:00): both are drawn there, side by side. */
    @Test func theRepeatedHoursEventsSitSideBySide() {
        let day = at(25, 0, month: 10)
        let summer = day.addingTimeInterval(2 * 3600)
        let winter = summer.addingTimeInterval(3600)
        let first = event("first", summer, summer.addingTimeInterval(30 * 60))
        let second = event("second", winter, winter.addingTimeInterval(30 * 60))
        #expect(TimeGrid.minutes(first, on: day, dates: dates) == (2 * 60)...(2 * 60 + 30))
        #expect(TimeGrid.minutes(second, on: day, dates: dates) == (2 * 60)...(2 * 60 + 30))
        #expect(placed([first, second], on: day) == ["first": [0, 2], "second": [1, 2]])
    }

    /** 02:45+02:00 to 02:15+01:00 is half an hour across the clocks going back: it covers 02:45–03:00 and 02:00–02:15. */
    @Test func anEventAcrossTheClocksGoingBackCoversTheRepeatedHour() {
        let day = at(25, 0, month: 10)
        let turn = day.addingTimeInterval(3 * 3600)
        let across = event("across", turn.addingTimeInterval(-15 * 60), turn.addingTimeInterval(15 * 60))
        #expect(TimeGrid.minutes(across, on: day, dates: dates) == (2 * 60)...(3 * 60))
        let early = event("early", turn.addingTimeInterval(-3600 - 30 * 60), turn.addingTimeInterval(-3600))
        let winter = event("winter", turn, turn.addingTimeInterval(10 * 60))
        #expect(TimeGrid.minutes(early, on: day, dates: dates) == 90...120)
        #expect(placed([across, winter], on: day) == ["across": [0, 2], "winter": [1, 2]])
        #expect(placed([early, across], on: day) == ["early": [0, 1], "across": [0, 1]])
    }

    /** 01:00+02:00 to 02:00+01:00 ends just as the clocks go back, so it covers the first 02:00–03:00 too. */
    @Test func anEventEndingAsTheClocksGoBackCoversTheRepeatedHour() {
        let day = at(25, 0, month: 10)
        let turn = day.addingTimeInterval(3 * 3600)
        let toTurn = event("toTurn", turn.addingTimeInterval(-2 * 3600), turn)
        #expect(TimeGrid.minutes(toTurn, on: day, dates: dates) == 60...180)
        let summer = event("summer", turn.addingTimeInterval(-30 * 60), turn.addingTimeInterval(-10 * 60))
        #expect(placed([toTurn, summer], on: day) == ["toTurn": [0, 2], "summer": [1, 2]])
    }

    @Test func allDayAndDayLongEventsGoInTheAllDayRow() {
        let birthday = event("birthday", at(4, 0), at(5, 0), allDay: true)
        let marathon = event("marathon", at(4, 6), at(5, 6))
        let meeting = event("meeting", at(4, 9), at(4, 10))
        let all = [birthday, marathon, meeting]
        #expect(TimeGrid.allDay(all, on: at(4, 0), dates: dates).map(\.eventId) == ["birthday", "marathon"])
        #expect(TimeGrid.timed(all, on: at(4, 0), dates: dates).map(\.eventId) == ["meeting"])
        #expect(TimeGrid.allDay(all, on: at(5, 0), dates: dates).map(\.eventId) == ["marathon"])
    }

    @Test func opensAroundNowOnTodayElseAtTheFirstEvent() {
        let now = at(4, 15, 20)
        let events = [event("b", at(5, 11), at(5, 12)), event("a", at(5, 9, 30), at(5, 10))]
        #expect(TimeGrid.openingHour(events, on: at(4, 0), now: now, dates: dates) == 13)
        #expect(TimeGrid.openingHour([], on: at(4, 0), now: at(4, 1), dates: dates) == 0)
        #expect(TimeGrid.openingHour(events, on: at(5, 0), now: now, dates: dates) == 8)
        #expect(TimeGrid.openingHour([], on: at(5, 0), now: now, dates: dates) == 8)
        let overnight = event("train", at(4, 22), at(5, 7))
        #expect(TimeGrid.openingHour([overnight], on: at(5, 0), now: now, dates: dates) == 0)
    }

    /** The grid's heights (48pt an hour, less 2) at Inter caption2's 13.4pt line. */
    @Test func aBlockHoldsWhatItsHeightFits() {
        #expect(TimeGrid.titleLines(height: 16, line: 13.4) == nil)
        #expect(TimeGrid.titleLines(height: 22, line: 13.4) == nil)
        #expect(TimeGrid.titleLines(height: 34, line: 13.4) == 1)
        #expect(TimeGrid.titleLines(height: 46, line: 13.4) == 1)
        #expect(TimeGrid.titleLines(height: 70, line: 13.4) == 3)
        #expect(TimeGrid.titleLines(height: 46, line: 20) == nil, "a larger text size makes an hour one line")
    }

    /**
     * A tall block's title and times sit at its top left, not its middle:
     * the full-height bar beside them once centered them in the block.
     */
    @MainActor @Test func aTallBlocksTextSitsAtItsTop() throws {
        let train = event("Night train to Lisbon", at(13, 0), at(13, 7, 15))
        let block = EventBlock(event: train, color: .blue, dates: dates, height: 300)
            .frame(width: 220, height: 300)
            .background(EnvironmentValues().palette.canvas)
        let renderer = ImageRenderer(content: block)
        renderer.scale = 1
        let image = try #require(renderer.cgImage)
        let rows = inkedRows(image)
        let first = try #require(rows.first, "the block drew no text")
        let last = try #require(rows.last)
        #expect(first < 10, "the title doesn't start at the top")
        #expect(last < 50, "the text reaches \(last)pt down a 300pt block")
    }

    /** The rows of a block's picture with text in them: past its bar and corners, unlike its fill. */
    private func inkedRows(_ image: CGImage) -> [Int] {
        let width = image.width, height = image.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let context = CGContext(
            data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )!
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        func pixel(_ x: Int, _ y: Int) -> [Int] {
            let i = (y * width + x) * 4
            return (0..<3).map { Int(pixels[i + $0]) }
        }
        let fill = pixel(width - 12, height - 12)
        return (0..<height).filter { y in
            (8..<(width - 8)).contains { x in zip(pixel(x, y), fill).map { abs($0 - $1) }.reduce(0, +) > 90 }
        }
    }

    @Test func theDemoOverlapsAtLunch() {
        let now = at(4, 10)
        let day = dates.window(.day, anchor: now)
        let today = TimeGrid.timed(DemoCalendar.events(in: day, now: now, dates: dates), on: now, dates: dates)
        let layout = TimeGrid.columns(today, on: now, dates: dates)
        let lunch = today.first { $0.eventId == "lunch" }!
        let call = today.first { $0.eventId == "supplier-call" }!
        #expect(layout[lunch.id] == TimeGrid.Placement(col: 0, cols: 2))
        #expect(layout[call.id] == TimeGrid.Placement(col: 1, cols: 2))
    }
}
