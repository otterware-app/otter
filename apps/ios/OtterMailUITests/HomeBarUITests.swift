import XCTest

/**
 * The bar on the demo mailbox: Mail and Calendar, labeled, ⌃⌄ for what the
 * one in front is scoped by, and only on a module's first page, so it never
 * sits over a pushed page's last row.
 */
final class HomeBarUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let demo = app.buttons["Try the demo mailbox"]
        if demo.waitForExistence(timeout: 3) { demo.tap() }
        XCTAssertTrue(app.buttons["Mail"].waitForExistence(timeout: 8), "Mail tab missing")
    }

    func testBarHasMailAndCalendar() {
        let app = XCUIApplication()
        XCTAssertTrue(app.buttons["Calendar"].exists, "Calendar tab missing")
        XCTAssertTrue(app.staticTexts["Mail"].exists && app.staticTexts["Calendar"].exists, "the tabs aren't labeled")
        XCTAssertEqual(app.buttons["places-scope"].label, "All places")
        app.buttons["Calendar"].tap()
        XCTAssertTrue(app.buttons["Agenda"].waitForExistence(timeout: 8))
        XCTAssertEqual(app.buttons["places-scope"].label, "Calendars")
        app.buttons["places-scope"].tap()
        XCTAssertTrue(app.buttons["All calendars"].waitForExistence(timeout: 5), "the calendars' panel didn't open")
    }

    /** An event and a conversation are pushed without the bar, and their last row can be reached. */
    func testPushedPagesHaveNoBarAndTheirLastRowIsReachable() {
        let app = XCUIApplication()
        let bar = app.buttons["places-scope"]

        app.buttons["Calendar"].tap()
        let event = app.buttons.matching(identifier: "event-row").firstMatch
        XCTAssertTrue(event.waitForExistence(timeout: 8), "no event in the agenda")
        event.tap()
        XCTAssertTrue(app.navigationBars["Event"].waitForExistence(timeout: 5))
        XCTAssertTrue(gone(bar), "the bar stayed over the event")
        reachesTheEnd(app, of: app.scrollViews.firstMatch, "the event")
        app.navigationBars["Event"].buttons.firstMatch.tap()
        XCTAssertTrue(bar.waitForExistence(timeout: 5), "the bar didn't come back with the agenda")

        app.buttons["Mail"].tap()
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Dinner Saturday")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        XCTAssertTrue(gone(bar), "the bar stayed over the conversation")
    }

    /** Settings is a sheet with no bar under it: its last row comes into view. */
    func testSettingsLastRowIsReachable() {
        let app = XCUIApplication()
        app.navigationBars.buttons["More"].firstMatch.tap()
        app.buttons["Settings"].tap()
        let form = app.collectionViews.firstMatch
        XCTAssertTrue(form.waitForExistence(timeout: 5))
        let version = app.staticTexts["Version"]
        for _ in 0..<8 where !(version.exists && version.isHittable) { form.swipeUp() }
        XCTAssertTrue(version.isHittable, "Settings' last row can't be reached")
        XCTAssertLessThan(version.frame.maxY, app.windows.firstMatch.frame.maxY - 20)
    }

    private func reachesTheEnd(_ app: XCUIApplication, of scroll: XCUIElement, _ what: String) {
        for _ in 0..<6 { scroll.swipeUp() }
        let last = scroll.descendants(matching: .staticText).allElementsBoundByIndex.last
        XCTAssertNotNil(last, "\(what) is empty")
        XCTAssertTrue(last?.isHittable ?? false, "the end of \(what) can't be reached")
    }

    private func gone(_ element: XCUIElement) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter.wait(for: [expectation], timeout: 5) == .completed
    }
}
