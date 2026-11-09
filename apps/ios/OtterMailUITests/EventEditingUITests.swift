import XCTest

/**
 * Making, changing and deleting an event on the demo's pretend calendar
 * (never Google): + opens the editor, an event of yours opens its page with
 * Edit, leaving with changes asks first, and Delete asks too.
 */
final class EventEditingUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let demo = app.buttons["Try the demo mailbox"]
        if demo.waitForExistence(timeout: 3) { demo.tap() }
        XCTAssertTrue(app.buttons["Calendar"].waitForExistence(timeout: 8), "Calendar tab missing")
        app.buttons["Calendar"].tap()
        XCTAssertTrue(app.buttons["Agenda"].waitForExistence(timeout: 8))
    }

    func testCreatesChangesAndDeletesAnEvent() {
        let app = XCUIApplication()
        let suffix = Int.random(in: 100...999)
        let title = "Demo dentist \(suffix)"

        app.navigationBars.buttons["New event"].tap()
        let field = titleField(app)
        XCTAssertTrue(field.waitForExistence(timeout: 5), "the editor didn't open")
        XCTAssertFalse(app.buttons["places-scope"].exists, "the bar is under the editor")
        field.tap()
        field.typeText(title)
        app.navigationBars.buttons["Save"].tap()

        // Saved, it's in view in the agenda, and opens its page first.
        let row = eventRow(app, title)
        XCTAssertTrue(waitTappable(row), "the new event isn't in view in the agenda")
        row.tap()
        XCTAssertTrue(app.navigationBars["Event"].waitForExistence(timeout: 5), "the event didn't open its page")
        XCTAssertTrue(app.staticTexts[title].exists)
        app.navigationBars["Event"].buttons["Edit"].tap()
        XCTAssertTrue(titleField(app).waitForExistence(timeout: 5), "Edit didn't open the editor")

        // Changed, Back asks before throwing the change away.
        let renamed = "Demo dentist moved \(suffix)"
        let edit = titleField(app)
        edit.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
        edit.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: title.count) + renamed)
        app.navigationBars.buttons["Back"].tap()
        XCTAssertTrue(app.buttons["Discard changes"].waitForExistence(timeout: 5), "Back didn't ask about the changes")
        XCTAssertTrue(app.buttons["Keep editing"].exists, "the question has no way to keep editing")
        app.buttons["Keep editing"].tap()
        app.navigationBars.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts[renamed].waitForExistence(timeout: 5), "the event's page didn't show the change")

        // Delete is at the foot of the editor, reachable, and asks first.
        app.navigationBars["Event"].buttons["Edit"].tap()
        let delete = app.buttons["Delete event"]
        XCTAssertTrue(titleField(app).waitForExistence(timeout: 5))
        for _ in 0..<6 where !(delete.exists && delete.isHittable) { app.swipeUp() }
        XCTAssertTrue(delete.isHittable, "Delete event isn't reachable")
        XCTAssertLessThan(delete.frame.maxY, app.windows.firstMatch.frame.maxY - 30, "Delete event is at the screen's edge")
        delete.tap()
        let asked = app.staticTexts["Delete \"\(renamed)\"?"]
        XCTAssertTrue(asked.waitForExistence(timeout: 5), "Delete didn't ask")
        app.buttons.matching(NSPredicate(format: "label == %@", "Delete event")).allElementsBoundByIndex.last { $0.isHittable }?.tap()
        XCTAssertTrue(app.buttons["Agenda"].waitForExistence(timeout: 5))
        XCTAssertTrue(waitGone(eventRow(app, renamed)), "the deleted event is still there")
    }

    private func eventRow(_ app: XCUIApplication, _ title: String) -> XCUIElement {
        app.descendants(matching: .any)["calendar-page-agenda"]
            .buttons.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
    }

    /** Waits for a row the agenda has just scrolled to (`Reveal`) to be there and tappable. */
    private func waitTappable(_ row: XCUIElement) -> Bool {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND hittable == true"), object: row)
        return XCTWaiter.wait(for: [ready], timeout: 8) == .completed
    }

    private func titleField(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["event-title"]
    }

    private func waitGone(_ element: XCUIElement) -> Bool {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter.wait(for: [gone], timeout: 5) == .completed
    }
}
