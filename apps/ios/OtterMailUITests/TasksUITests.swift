import XCTest

/**
 * Tasks on the demo: the list says up front that tasks stay on this iPhone,
 * a task is added without the bar under the editor, leaving the editor with
 * changes and deleting a task both ask first, and the Done heading can be
 * reached above the bar.
 */
final class TasksUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let demo = app.buttons["Try the demo mailbox"]
        if demo.waitForExistence(timeout: 3) { demo.tap() }
        let tasks = app.buttons.matching(NSPredicate(format: "label == %@", "Tasks")).firstMatch
        XCTAssertTrue(tasks.waitForExistence(timeout: 8), "Tasks tab missing")
        tasks.tap()
        XCTAssertTrue(app.navigationBars.buttons["Add task"].waitForExistence(timeout: 5))
    }

    func testAddsAskBeforeDiscardingAndDeletes() {
        let app = XCUIApplication()
        XCTAssertTrue(app.staticTexts["On this iPhone only. Tasks don't sync to your other devices."].exists, "the list doesn't say tasks are local")

        app.navigationBars.buttons["Add task"].tap()
        XCTAssertTrue(app.navigationBars["New task"].waitForExistence(timeout: 5), "the editor didn't open")
        XCTAssertFalse(app.buttons["places-scope"].exists, "the bar is under the editor")
        let content = "Water the plants \(Int.random(in: 100...999))"
        let field = taskField(app)
        field.tap()
        field.typeText(content)
        app.navigationBars.buttons["Back"].tap()
        XCTAssertTrue(app.buttons["Discard changes"].waitForExistence(timeout: 5), "Back didn't ask about the changes")
        app.buttons["Keep editing"].tap()
        app.navigationBars.buttons["Save"].tap()
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", content)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), "the task wasn't added")

        row.tap()
        XCTAssertTrue(app.navigationBars["Task"].waitForExistence(timeout: 5), "the task didn't open")
        app.buttons["task-detail-edit"].tap()
        let delete = app.buttons["Delete task"]
        for _ in 0..<4 where !(delete.exists && delete.isHittable) { app.swipeUp() }
        XCTAssertTrue(delete.isHittable, "Delete task isn't reachable")
        delete.tap()
        XCTAssertTrue(app.staticTexts["Delete this task?"].waitForExistence(timeout: 5), "Delete didn't ask")
        app.buttons.matching(NSPredicate(format: "label == %@", "Delete task")).allElementsBoundByIndex.last { $0.isHittable }?.tap()
        XCTAssertTrue(app.navigationBars.buttons["Add task"].waitForExistence(timeout: 5))
        XCTAssertTrue(gone(row), "the deleted task is still listed")
    }

    func testTheDoneHeadingIsAboveTheBar() {
        let app = XCUIApplication()
        let done = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Done")).firstMatch
        let list = app.collectionViews.firstMatch
        let bar = app.buttons["places-scope"]
        // Glass doesn't stop a hit test, so being hittable isn't enough: it has to come out from under the bar.
        for _ in 0..<6 where !(done.exists && done.frame.maxY < bar.frame.minY) { list.swipeUp() }
        XCTAssertTrue(done.isHittable, "the Done heading can't be reached")
        XCTAssertLessThan(done.frame.maxY, bar.frame.minY, "the Done heading stays under the bar")
    }

    private func taskField(_ app: XCUIApplication) -> XCUIElement {
        app.textFields["Task"].exists ? app.textFields["Task"] : app.textViews["Task"]
    }

    private func gone(_ element: XCUIElement) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter.wait(for: [expectation], timeout: 5) == .completed
    }
}
