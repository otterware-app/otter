import XCTest

/**
 * Tasks and conversations on the demo: the reader shows a short Tasks list
 * only when a task is linked, and More has Add task and Link to a task.
 */
final class TaskLinksUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let demo = app.buttons["Try the demo mailbox"]
        if demo.waitForExistence(timeout: 3) { demo.tap() }
        XCTAssertTrue(app.buttons["All places"].waitForExistence(timeout: 8), "the inbox didn't open")
    }

    func testTheReaderListsLinkedTasksOnlyWhenThereAreSome() {
        let app = XCUIApplication()
        open(app, "Your Linden sign-in code")
        // The demo's tasks stay on the simulator between runs: what an earlier run linked here goes first.
        unlinkAll(app)
        XCTAssertTrue(gone(app.descendants(matching: .any)["linked-tasks"]), "a conversation without tasks has a Tasks card")

        app.navigationBars.buttons["More"].firstMatch.tap()
        app.buttons["Link to a task"].tap()
        XCTAssertTrue(app.navigationBars["Link to a task"].waitForExistence(timeout: 5), "Link to a task didn't open")
        let parcel = app.buttons["Link to Pick up the parcel"]
        XCTAssertTrue(parcel.waitForExistence(timeout: 5))
        parcel.tap()
        let linked = app.descendants(matching: .any)["linked-tasks"]
        XCTAssertTrue(linked.waitForExistence(timeout: 5), "the linked task isn't shown")
        XCTAssertTrue(linked.staticTexts["Pick up the parcel"].exists)

        app.navigationBars.buttons["More"].firstMatch.tap()
        app.buttons["Add task"].tap()
        XCTAssertTrue(app.navigationBars["New task"].waitForExistence(timeout: 5), "Add task didn't open the editor")
        app.navigationBars.buttons["Save"].tap()
        XCTAssertTrue(gone(app.navigationBars["New task"]), "the editor stayed open after Save")
        let added = linked.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Your Linden sign-in code")).firstMatch
        XCTAssertTrue(added.waitForExistence(timeout: 5), "the new task isn't linked")
        unlinkAll(app)
    }

    private func unlinkAll(_ app: XCUIApplication) {
        let unlink = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Unlink "))
        for _ in 0..<10 where unlink.firstMatch.exists { unlink.firstMatch.tap() }
    }

    private func gone(_ element: XCUIElement) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter.wait(for: [expectation], timeout: 5) == .completed
    }

    private func open(_ app: XCUIApplication, _ subject: String) {
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", subject)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), "\(subject) isn't in the inbox")
        row.tap()
        XCTAssertTrue(app.staticTexts[subject].waitForExistence(timeout: 5))
    }
}
