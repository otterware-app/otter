import XCTest

/** Without an agent set up (the demo's), Give to agent isn't offered on an event or a task: only what works is shown. */
final class GiveToAgentUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let demo = app.buttons["Try the demo mailbox"]
        if demo.waitForExistence(timeout: 3) { demo.tap() }
        XCTAssertTrue(app.buttons["Mail"].waitForExistence(timeout: 8), "Mail tab missing")
    }

    func testHiddenWithoutAnAgent() {
        let app = XCUIApplication()
        app.buttons["Calendar"].tap()
        let event = app.buttons.matching(identifier: "event-row").firstMatch
        XCTAssertTrue(event.waitForExistence(timeout: 8))
        event.tap()
        XCTAssertTrue(app.navigationBars["Event"].waitForExistence(timeout: 5))
        app.navigationBars["Event"].buttons["More"].tap()
        XCTAssertTrue(app.buttons["Add task"].waitForExistence(timeout: 5), "the event's More menu didn't open")
        XCTAssertFalse(app.buttons["Give to agent"].exists, "Give to agent offered with no agent set up")
    }

    func testHiddenOnATaskWithoutAnAgent() {
        let app = XCUIApplication()
        app.buttons.matching(NSPredicate(format: "label == %@", "Tasks")).firstMatch.tap()
        let task = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Pick up the parcel")).firstMatch
        XCTAssertTrue(task.waitForExistence(timeout: 5))
        task.tap()
        XCTAssertTrue(app.navigationBars["Task"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Give to agent"].exists, "Give to agent offered with no agent set up")
    }
}
