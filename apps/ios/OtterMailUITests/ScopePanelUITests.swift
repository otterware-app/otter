import XCTest

/**
 * The bar's ⌃⌄ panel on the demo mailbox, for the calendar (All calendars,
 * each mailbox and its calendars) and for Tasks (All, the Inbox, the lists).
 * Each test leaves a screenshot that is kept (`keepAlways`), for exporting
 * from the .xcresult.
 */
final class ScopePanelUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let demo = app.buttons["Try the demo mailbox"]
        if demo.waitForExistence(timeout: 3) { demo.tap() }
        XCTAssertTrue(app.buttons["Mail"].waitForExistence(timeout: 8), "Mail tab missing")
    }

    func testCalendarScopeFiltersByMailboxAndCalendar() {
        let app = XCUIApplication()
        app.buttons["Calendar"].tap()
        XCTAssertTrue(app.buttons["Agenda"].waitForExistence(timeout: 8))
        openScope(app)

        let all = app.buttons["All calendars"]
        XCTAssertTrue(all.waitForExistence(timeout: 5), "the panel didn't open")
        XCTAssertFalse(app.buttons["Back to Calendar"].exists, "⌃⌄ opened the full-page list")
        for row in ["Personal", "Work", "Robin Otter", "Otterware", "Sam Park", "Acme team"] {
            XCTAssertTrue(app.buttons[row].waitForExistence(timeout: 5), "\(row) missing from the panel")
        }
        attach(app, "calendar-scope")

        // A calendar's row switches it.
        let acme = app.buttons["Acme team"]
        XCTAssertEqual(acme.value as? String, "Shown")
        acme.tap()
        XCTAssertEqual(acme.value as? String, "Hidden")
        acme.tap()
        XCTAssertEqual(acme.value as? String, "Shown")

        // A mailbox scopes the calendar to its own, and the title says which.
        app.buttons["Work"].tap()
        XCTAssertTrue(all.waitForNonExistence(timeout: 5), "the panel stayed open")
        XCTAssertTrue(app.buttons["Calendar Work"].waitForExistence(timeout: 5), "the title doesn't name the mailbox")
        openScope(app)
        XCTAssertTrue(app.buttons["Work"].isSelected)
        attach(app, "calendar-scope-work")

        // Show only this calendar, from holding its row.
        app.buttons["Otterware"].press(forDuration: 1.2)
        let only = app.buttons["Show only this calendar"]
        XCTAssertTrue(only.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Color"].exists, "the color menu is missing")
        only.tap()
        XCTAssertTrue(app.buttons["Calendar 1 of 4"].waitForExistence(timeout: 5), "only one calendar should be shown")

        // All brings every calendar back.
        openScope(app)
        XCTAssertEqual(app.buttons["Robin Otter"].value as? String, "Hidden")
        app.buttons["All calendars"].tap()
        XCTAssertTrue(app.buttons["Calendar All calendars"].waitForExistence(timeout: 5))
        openScope(app)
        for row in ["Robin Otter", "Otterware", "Sam Park", "Acme team"] {
            XCTAssertEqual(app.buttons[row].value as? String, "Shown", "\(row) still off after All calendars")
        }
    }

    private func openScope(_ app: XCUIApplication) {
        let scope = app.buttons["places-scope"]
        XCTAssertTrue(scope.waitForExistence(timeout: 5), "⌃⌄ missing")
        scope.tap()
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
