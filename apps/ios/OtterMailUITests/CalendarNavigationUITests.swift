import XCTest

/**
 * Tapping an event pushes that event alone, whatever page it's on, and one
 * Back returns to the page it was tapped on, as it was left. Each test turns
 * to another page first, so the pages kept mounted beside the one in front
 * are part of it. On the demo mailbox: its events open in the editor or the
 * read-only view, both titled "Event", and nothing is saved.
 */
final class CalendarNavigationUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments += ["-otter:shot", "calendar"]
        app.launch()
        let demo = app.buttons["Try the demo mailbox"]
        if demo.waitForExistence(timeout: 3) { demo.tap() }
        if !app.buttons["Agenda"].waitForExistence(timeout: 5) {
            app.buttons["Calendar"].firstMatch.tap()
        }
        XCTAssertTrue(app.buttons["Agenda"].waitForExistence(timeout: 8), "the calendar didn't open")
    }

    func testAgendaOpensOneEvent() throws {
        let app = XCUIApplication()
        turn(app, to: "Month")
        turn(app, to: "Agenda")
        let page = self.page(app, "agenda")
        let rows = page.buttons
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 5), "the agenda lists nothing")
        // A row with others in its section and around it.
        let row = rows.element(boundBy: min(2, rows.count - 1))
        opensOnce(app, row, from: "Agenda")
        XCTAssertTrue(row.exists, "the agenda's row is gone after Back")
    }

    func testDayOpensOneTimedEvent() throws {
        let app = XCUIApplication()
        turn(app, to: "Month")
        turn(app, to: "Day")
        let page = self.page(app, "day")
        let grid = page.descendants(matching: .any)["day-grid"]
        XCTAssertTrue(grid.waitForExistence(timeout: 5), "the day's grid is missing")
        // Today's lunch has the printer's call over its end: two blocks side by side.
        let lunch = grid.buttons.matching(identifier: "day-grid-event")
            .matching(NSPredicate(format: "label BEGINSWITH %@", "Lunch with Mum")).firstMatch
        XCTAssertTrue(lunch.waitForExistence(timeout: 5), "lunch isn't in the grid")
        XCTAssertGreaterThan(grid.buttons.matching(identifier: "day-grid-event").count, 1, "the day has one event")
        opensOnce(app, lunch, from: "Day")
        XCTAssertTrue(lunch.waitForExistence(timeout: 3), "Back didn't return to the same day")
    }

    func testDayOpensOneAllDayEvent() throws {
        let app = XCUIApplication()
        turn(app, to: "Agenda")
        turn(app, to: "Day")
        let page = self.page(app, "day")
        let allDay = page.buttons.matching(identifier: "day-grid-all-day").firstMatch
        for _ in 0..<31 where !allDay.waitForExistence(timeout: 1.5) { page.buttons["Next"].tap() }
        XCTAssertTrue(allDay.exists, "no all-day event in the month ahead")
        let label = allDay.label
        opensOnce(app, allDay, from: "Day")
        XCTAssertEqual(page.buttons.matching(identifier: "day-grid-all-day").firstMatch.label, label, "Back didn't return to the same day")
    }

    /** A day picked in the month lists that day's events, and one of them opens. */
    func testMonthOpensAPickedDaysEvent() throws {
        let app = XCUIApplication()
        turn(app, to: "Month")
        let page = self.page(app, "month")
        for offset in 0..<28 {
            let day = Calendar.current.date(byAdding: .day, value: offset, to: .now)!
            guard Calendar.current.isDate(day, equalTo: .now, toGranularity: .month) else { break }
            pick(app, page, day)
            let event = page.buttons.matching(identifier: "event-row").firstMatch
            if event.waitForExistence(timeout: 1.5) {
                if !event.isHittable { page.swipeUp() }
                return opensOnce(app, event, from: "Month")
            }
        }
        XCTFail("no day this month with an event")
    }

    /**
     * Taps the element, expects one event pushed, and backs out once: the
     * page it came from is in front again with nothing left on the stack.
     */
    private func opensOnce(_ app: XCUIApplication, _ element: XCUIElement, from mode: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.isHittable, "\(element.label) isn't tappable", file: file, line: line)
        element.tap()
        let detail = app.navigationBars["Event"]
        XCTAssertTrue(detail.waitForExistence(timeout: 5), "tapping \(element.label) didn't open it", file: file, line: line)
        // Let any further pushes land before backing out.
        Thread.sleep(forTimeInterval: 1)

        var backs = 0
        while detail.exists, backs < 20 {
            detail.buttons.firstMatch.tap()
            backs += 1
            _ = waitGone(detail, timeout: 2)
        }
        XCTAssertEqual(backs, 1, "one tap on \(element.label) pushed \(backs) events", file: file, line: line)
        let picker = app.buttons[mode]
        XCTAssertTrue(picker.waitForExistence(timeout: 5), "Back didn't return to the calendar", file: file, line: line)
        XCTAssertTrue(picker.isSelected, "Back didn't return to \(mode)", file: file, line: line)
        XCTAssertTrue(page(app, mode.lowercased()).exists, "\(mode) isn't in front after Back", file: file, line: line)
    }

    private func turn(_ app: XCUIApplication, to mode: String) {
        let button = app.buttons[mode]
        button.tap()
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isSelected == true"), object: button)
        XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 3), .completed, "the picker didn't turn to \(mode)")
        XCTAssertTrue(page(app, mode.lowercased()).waitForExistence(timeout: 5), "\(mode) isn't in front")
    }

    private func pick(_ app: XCUIApplication, _ page: XCUIElement, _ day: Date) {
        let label = day.formatted(.dateTime.weekday(.wide).month(.wide).day())
        let cell = page.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
        XCTAssertTrue(cell.waitForExistence(timeout: 5), "\(label) isn't in the month's grid")
        cell.tap()
    }

    private func page(_ app: XCUIApplication, _ mode: String) -> XCUIElement {
        app.descendants(matching: .any)["calendar-page-\(mode)"]
    }

    private func waitGone(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter.wait(for: [gone], timeout: timeout) == .completed
    }
}
