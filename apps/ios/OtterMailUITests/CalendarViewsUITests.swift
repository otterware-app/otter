import XCTest

/**
 * The Day page's time grid and the Month page's week, on the demo mailbox
 * (its default preferences: weekends shown, the region's week start). Each
 * test leaves a kept screenshot (`day-grid`, `month-week`). Queries stay
 * inside the page in front: the others stay mounted beside it.
 */
final class CalendarViewsUITests: XCTestCase {
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

    func testDayShowsTheHoursWithOverlapsSideBySide() throws {
        let app = XCUIApplication()
        app.buttons["Day"].tap()
        let page = self.page(app, "day")
        let grid = page.descendants(matching: .any)["day-grid"]
        XCTAssertTrue(grid.waitForExistence(timeout: 5), "the day's grid is missing")

        // The demo's lunch and the call over its end, today.
        let blocks = grid.buttons.matching(identifier: "day-grid-event")
        let lunch = blocks.matching(NSPredicate(format: "label BEGINSWITH %@", "Lunch with Mum")).firstMatch
        let call = blocks.matching(NSPredicate(format: "label BEGINSWITH %@", "Call with the printer")).firstMatch
        XCTAssertTrue(lunch.waitForExistence(timeout: 5), "lunch isn't in the grid")
        XCTAssertTrue(call.exists, "the call isn't in the grid")
        XCTAssertLessThan(lunch.frame.minX, call.frame.minX, "overlapping events aren't side by side")
        XCTAssertLessThan(call.frame.minY, lunch.frame.maxY, "the call should start inside lunch")
        XCTAssertGreaterThan(lunch.frame.height, call.frame.height, "blocks aren't sized by their length")

        // The grid opens where the clock is; the picture is of midday, lunch and the call in view.
        scroll(grid, toShow: lunch)
        attach(app, "day-grid")

        // Turning the day keeps the grid.
        page.buttons["Next"].tap()
        XCTAssertTrue(grid.waitForExistence(timeout: 3))
        page.buttons["Previous"].tap()
        XCTAssertTrue(lunch.waitForExistence(timeout: 3))
    }

    /**
     * A tall block beside a short one (`day-grid-top`): the demo's standup is
     * 15 minutes; the night train's morning is 7¼ hours, 13 days on. Where that
     * morning falls on a weekend, without a standup, a Tuesday's hour-long
     * design review stands in for it.
     */
    func testDayPinsTextToTheTopOfTallBlocks() throws {
        let app = XCUIApplication()
        app.buttons["Day"].tap()
        let page = self.page(app, "day")
        let grid = page.descendants(matching: .any)["day-grid"]
        XCTAssertTrue(grid.waitForExistence(timeout: 5), "the day's grid is missing")
        let blocks = grid.buttons.matching(identifier: "day-grid-event")
        func block(_ title: String) -> XCUIElement {
            blocks.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
        }
        let standup = block("Standup")
        let train = block("Night train to Lisbon")
        let review = block("Design review")

        var fallback: Int?
        var ahead = 0
        while ahead < 14 {
            if standup.waitForExistence(timeout: 2) {
                if train.exists, train.frame.height > 4 * 48 { break }
                if fallback == nil, review.exists { fallback = ahead }
            }
            page.buttons["Next"].tap()
            ahead += 1
        }
        if ahead == 14, let fallback {
            for _ in fallback..<ahead { page.buttons["Previous"].tap() }
        }
        XCTAssertTrue(standup.waitForExistence(timeout: 3), "no day ahead has the standup")
        let tall = train.exists ? train : review
        XCTAssertTrue(tall.exists, "no tall block beside the standup")
        XCTAssertGreaterThan(tall.frame.height, standup.frame.height * 2, "the tall block isn't tall")
        XCTAssertTrue(grid.frame.intersects(tall.frame) && grid.frame.contains(standup.frame), "the blocks aren't in view together")
        attach(app, "day-grid-top")
    }

    /** The day picked in the month is the one listed under it, not its week. */
    func testMonthListsThePickedDay() throws {
        let app = XCUIApplication()
        app.buttons["Month"].tap()
        let page = self.page(app, "month")
        XCTAssertTrue(page.waitForExistence(timeout: 5), "the month isn't in front")

        let calendar = Calendar.current
        let month = calendar.dateInterval(of: .month, for: .now)!.start
        // A day at least two away from today, so its heading is its date.
        let picked = [14, 2, 26].map { calendar.date(byAdding: .day, value: $0, to: month)! }
            .first { abs(calendar.dateComponents([.day], from: calendar.startOfDay(for: .now), to: $0).day!) > 1 }!
        let label = picked.formatted(.dateTime.weekday(.wide).month(.wide).day())
        let cell = page.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
        XCTAssertTrue(cell.waitForExistence(timeout: 5), "\(label) isn't in the month's grid")
        cell.tap()
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isSelected == true"), object: cell)
        XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 3), .completed, "tapping \(label) didn't pick it")

        let heading = picked.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        XCTAssertTrue(page.staticTexts[heading].waitForExistence(timeout: 3), "the list isn't headed \(heading)")
        attach(app, "month-picked-day")
    }

    /** A calendar page; the ones not in front are hidden from accessibility. */
    private func page(_ app: XCUIApplication, _ mode: String) -> XCUIElement {
        app.descendants(matching: .any)["calendar-page-\(mode)"]
    }

    /**
     * Drags the grid a quarter of its height at a time until the element sits
     * in its upper half, clear of the all-day row and the bar over its foot.
     */
    private func scroll(_ grid: XCUIElement, toShow element: XCUIElement) {
        for _ in 0..<12 {
            let area = grid.frame
            let target = element.frame
            let low = area.minY + area.height * 0.15
            let high = area.minY + area.height * 0.55
            if target.minY >= low, target.maxY <= high { return }
            let up = target.maxY > high
            let from = grid.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: up ? 0.65 : 0.35))
            let to = grid.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: up ? 0.4 : 0.6))
            from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.3)
        }
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
