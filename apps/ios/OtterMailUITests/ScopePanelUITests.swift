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

    func testTaskListsCreateRenameAndFilter() {
        let app = XCUIApplication()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Tasks")).firstMatch.tap()
        XCTAssertTrue(app.buttons["Add task"].waitForExistence(timeout: 5))
        openScope(app)

        XCTAssertTrue(app.buttons["New list"].waitForExistence(timeout: 5), "the panel didn't open")
        for row in ["All", "Inbox", "Home", "Work"] {
            XCTAssertTrue(app.buttons[row].exists, "\(row) missing from the panel")
        }
        attach(app, "tasks-scope")

        // A list picked is the title.
        app.buttons["Work"].tap()
        XCTAssertTrue(app.buttons["Tasks Work"].waitForExistence(timeout: 5), "the title doesn't name the list")

        // A new list, picked once it's made, with nothing on it yet.
        let suffix = Int.random(in: 100...999)
        let name = "Errands \(suffix)"
        openScope(app)
        app.buttons["New list"].tap()
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText(name)
        app.alerts.buttons["Create"].tap()
        XCTAssertTrue(app.buttons["Tasks \(name)"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["No tasks"].waitForExistence(timeout: 5))

        // A task added there is on that list, and not in the Inbox.
        let content = "Post the letter \(suffix)"
        app.buttons["Add task"].tap()
        let task = app.textFields["Task"].exists ? app.textFields["Task"] : app.textViews["Task"]
        XCTAssertTrue(task.waitForExistence(timeout: 5))
        task.tap()
        task.typeText(content)
        app.buttons["Save"].tap()
        XCTAssertTrue(labelled(app, content).waitForExistence(timeout: 5))
        openScope(app)
        app.buttons["Inbox"].tap()
        XCTAssertTrue(app.buttons["Tasks Inbox"].waitForExistence(timeout: 5))
        XCTAssertFalse(labelled(app, content).exists, "the Inbox shows another list's task")
        openScope(app)
        app.buttons[name].tap()

        // Renamed from holding its row.
        openScope(app)
        app.buttons[name].press(forDuration: 1.2)
        app.buttons["Rename"].tap()
        let rename = app.alerts.textFields.firstMatch
        XCTAssertTrue(rename.waitForExistence(timeout: 5))
        rename.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: name.count) + "Town \(suffix)")
        app.alerts.buttons["Rename"].tap()
        XCTAssertTrue(app.buttons["Town \(suffix)"].waitForExistence(timeout: 5), "the list wasn't renamed")
        attach(app, "tasks-scope-lists")

        // All again, every list's tasks in it.
        app.buttons["All"].tap()
        XCTAssertTrue(app.buttons["Tasks"].waitForExistence(timeout: 5))
        XCTAssertTrue(scrollToTask(app, content), "the new task isn't under All")
    }

    /**
     * All lists every task the simulator has kept from earlier runs, so the one
     * added here can sit below what the lazy list has drawn: swipes the list up
     * a bounded number of times, asking only `exists`, until its row is made.
     */
    private func scrollToTask(_ app: XCUIApplication, _ content: String) -> Bool {
        let row = labelled(app, content)
        if row.waitForExistence(timeout: 3) { return true }
        let list = app.collectionViews.firstMatch
        for _ in 0..<15 {
            (list.exists ? list : app).swipeUp()
            if row.waitForExistence(timeout: 1) { return true }
        }
        return false
    }

    /** A task's row reads as one element, its title first. */
    private func labelled(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
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
