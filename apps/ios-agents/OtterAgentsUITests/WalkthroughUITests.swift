import XCTest

/**
 * Walks the demo through what the app does, a screen at a time. With `OTTER_SHOTS` set to a
 * folder (`TEST_RUNNER_OTTER_SHOTS=…` for xcodebuild), each step leaves a picture there.
 */
final class WalkthroughUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-otter:theme-source", "system", "-otter:demo", "YES", "-chat-drafts", "<dict/>", "-chat-new-drafts", "<array/>", "-chat-open-requests", "<dict/>"]
        app.launch()
        XCTAssertTrue(app.buttons["New chat"].waitForExistence(timeout: 10), "the chats didn't open")
    }

    private func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["OTTER_SHOTS"] else { return }
        let style = XCUIDevice.shared.appearance == .dark ? "dark" : "light"
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(folder)/\(name)-\(style).png"))
    }

    private func row(_ title: String) -> XCUIElement {
        app.buttons.containing(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
    }

    func testChatsListAndItsShelves() {
        // A shelf left chosen by an earlier run goes back to Active.
        let active = app.buttons.containing(NSPredicate(format: "label BEGINSWITH 'Active'")).firstMatch
        if active.waitForExistence(timeout: 5) { active.tap() }
        XCTAssertTrue(row("Plan the Lisbon offsite").exists, "the pinned chat isn't listed")
        XCTAssertTrue(row("Reply to Lena about the Q4 budget").exists)
        XCTAssertFalse(row("Find the invoice from Hetzner").exists, "a snoozed chat shows among the active ones")
        shot("01-chats")
        app.buttons["Snoozed (1)"].tap()
        XCTAssertTrue(row("Find the invoice from Hetzner").waitForExistence(timeout: 3))
        XCTAssertFalse(row("Plan the Lisbon offsite").exists, "an active chat shows among the snoozed ones")
        shot("02-snoozed")
        app.buttons["Settled (2)"].tap()
        XCTAssertTrue(row("Draft the release note").waitForExistence(timeout: 3))
        shot("02-settled")
        active.tap()
    }

    func testOpenAChatAndReadIt() {
        row("Reply to Lena about the Q4 budget").tap()
        XCTAssertTrue(app.buttons["Chat details"].waitForExistence(timeout: 5), "the chat didn't open")
        XCTAssertFalse(app.buttons["New chat"].exists, "the tab bar stays over an open chat")
        shot("03-chat")
        app.buttons.containing(NSPredicate(format: "label BEGINSWITH 'Worked for'")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Used Otter integration"].waitForExistence(timeout: 3), "the work log didn't unfold")
        shot("04-work-log")
        app.buttons["Chat details"].tap()
        XCTAssertTrue(app.staticTexts["Outputs"].waitForExistence(timeout: 3))
        shot("05-details")
    }

    func testTheAgentsBrowserAndItsFiles() {
        row("Plan the Lisbon offsite").tap()
        XCTAssertTrue(app.buttons["View browser"].waitForExistence(timeout: 8), "no globe for a chat whose agent browsed")
        shot("20-globe")
        app.buttons["View browser"].tap()
        XCTAssertTrue(app.buttons["Take control"].waitForExistence(timeout: 8), "the browser didn't open")
        sleep(1)
        shot("21-browser")
        app.buttons["Take control"].tap()
        XCTAssertTrue(app.buttons["Release control"].waitForExistence(timeout: 5), "control wasn't taken")
        shot("22-browser-control")
        app.buttons["Close browser"].tap()

        XCTAssertTrue(app.buttons["Chat details"].waitForExistence(timeout: 5), "the browser didn't close")
        app.buttons["Chat details"].tap()
        let file = row("offsite-plan.md")
        XCTAssertTrue(file.waitForExistence(timeout: 3), "the chat's file isn't listed")
        file.tap()
        XCTAssertTrue(app.buttons["File actions"].waitForExistence(timeout: 8), "the file didn't open")
        sleep(1)
        shot("23-file")
    }

    func testTheBrowserZoomsWhileWatchingAndControlling() throws {
        row("Plan the Lisbon offsite").tap()
        XCTAssertTrue(app.buttons["View browser"].waitForExistence(timeout: 8))
        app.buttons["View browser"].tap()
        let page = app.scrollViews["Browser page"]
        XCTAssertTrue(page.waitForExistence(timeout: 8))
        let fitted = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "100%"), object: page)
        XCTAssertEqual(XCTWaiter.wait(for: [fitted], timeout: 5), .completed)
        shot("27-browser-fit")
        page.pinch(withScale: 2, velocity: 1)
        XCTAssertNotEqual(page.value as? String, "100%")
        let zoom = try XCTUnwrap(page.value as? String)
        page.swipeLeft()
        XCTAssertEqual(page.value as? String, zoom)
        shot("28-browser-zoom")
        app.buttons["Take control"].tap()
        XCTAssertTrue(app.buttons["Release control"].waitForExistence(timeout: 5))
        XCTAssertEqual(page.value as? String, zoom)
        page.pinch(withScale: 1.5, velocity: 1)
        XCTAssertNotEqual(page.value as? String, zoom)
        shot("29-browser-control-zoom")
        page.pinch(withScale: 0.25, velocity: -1)
        XCTAssertEqual(page.value as? String, "100%")
        app.buttons["Close browser"].tap()
    }

    func testATurnWaitsOnBackgroundWork() {
        app.buttons["New chat"].tap()
        let field = app.textFields.firstMatch.exists ? app.textFields.firstMatch : app.textViews.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("Compare the venues in the background, and tell me which one to book once you know more about each")
        shot("24-composer-lines")
        app.buttons["Send message"].tap()
        let waiting = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Waiting'")).firstMatch
        XCTAssertTrue(waiting.waitForExistence(timeout: 20), "the turn never said it was waiting")
        shot("25-waiting")
        XCTAssertTrue(app.buttons["Send message"].waitForExistence(timeout: 40), "the turn never finished after the wait")
        shot("26-waited")
    }

    func testSendAMessageAndWatchItAnswer() {
        app.buttons["New chat"].tap()
        let field = app.textFields.firstMatch.exists ? app.textFields.firstMatch : app.textViews.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "no composer in a new chat")
        field.tap()
        field.typeText("Where do things stand with Lena?")
        app.buttons["Send message"].tap()
        sleep(1)
        XCTAssertTrue(app.buttons["Stop agent"].waitForExistence(timeout: 5), "Send didn't start a turn")
        sleep(2)
        shot("07-working")
        XCTAssertTrue(app.buttons["Send message"].waitForExistence(timeout: 30), "the turn never finished")
        sleep(1)
        shot("08-answered")
    }

    func testLiveWorkStartsCollapsed() {
        app.buttons["New chat"].tap()
        let field = app.textFields.firstMatch.exists ? app.textFields.firstMatch : app.textViews.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("Compare the venues, take your time")
        app.buttons["Send message"].tap()
        let fold = app.buttons["Working…"]
        let step = app.buttons["Read Re: Q4 planning"]
        XCTAssertTrue(fold.waitForExistence(timeout: 5))
        XCTAssertEqual(fold.value as? String, "Collapsed")
        XCTAssertFalse(step.exists)
        shot("27-work-collapsed")
        fold.tap()
        XCTAssertTrue(step.waitForExistence(timeout: 5))
        XCTAssertEqual(fold.value as? String, "Expanded")
        shot("28-work-expanded")
        fold.tap()
        XCTAssertFalse(step.exists)
        XCTAssertEqual(fold.value as? String, "Collapsed")
        XCTAssertTrue(app.buttons["Send message"].waitForExistence(timeout: 30))
        XCTAssertFalse(step.exists)
    }

    func testApprovalAndQueue() {
        app.buttons["New chat"].tap()
        let field = app.textFields.firstMatch.exists ? app.textFields.firstMatch : app.textViews.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("Send Lena the new kickoff time")
        app.buttons["Send message"].tap()
        XCTAssertTrue(app.buttons["Allow once"].waitForExistence(timeout: 20), "the agent never asked")
        let said = app.textViews.matching(NSPredicate(format: "value CONTAINS %@", "One step needs your say-so")).firstMatch
        XCTAssertTrue(said.exists, "what the agent said before its step folded away while it works")
        shot("09-approval")
        app.buttons["Chats"].tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Needs you'")).firstMatch.waitForExistence(timeout: 5))
        shot("09-needs-you-badge")
        row("Send Lena the new kickoff time").tap()
        XCTAssertTrue(app.buttons["Allow once"].waitForExistence(timeout: 5))
        app.buttons["Allow once"].tap()
        XCTAssertTrue(app.buttons["Send message"].waitForExistence(timeout: 20), "the turn never finished after the approval")
        XCTAssertFalse(said.exists, "what the agent said along the way didn't fold once it was done")
        shot("10-approved")
    }

    func testQuestion() {
        app.buttons["New chat"].tap()
        let field = app.textFields.firstMatch.exists ? app.textFields.firstMatch : app.textViews.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("Plan the offsite")
        app.buttons["Send message"].tap()
        XCTAssertTrue(app.buttons["Answer"].waitForExistence(timeout: 20), "the agent never asked its question")
        shot("11-question")
        app.buttons.containing(NSPredicate(format: "label BEGINSWITH 'Mid January'")).firstMatch.tap()
        app.buttons["Design"].tap()
        app.buttons["Answer"].tap()
        XCTAssertTrue(app.buttons["Send message"].waitForExistence(timeout: 20), "the turn never finished after the answer")
        shot("12-answered")
    }

    func testAgentPickerAndSettings() {
        app.buttons["New chat"].tap()
        XCTAssertTrue(app.buttons["Agent and model"].waitForExistence(timeout: 5))
        app.buttons["Agent and model"].tap()
        XCTAssertTrue(app.staticTexts["Agent and model"].waitForExistence(timeout: 5))
        for agent in ["brokk", "rata", "Molty", "Scout", "varys"] {
            XCTAssertTrue(row(agent).exists, "\(agent) isn't offered")
        }
        XCTAssertTrue(row("claude-opus-5.5").exists, "the chosen agent's models aren't under it")
        shot("13-agents")
        row("Scout").tap()
        XCTAssertFalse(row("claude-opus-5.5").exists, "a gateway's agent has no models to pick")
        shot("13-agent-scout")
        row("rata").tap()
        app.buttons["Done"].tap()
        XCTAssertTrue(row("with rata").waitForExistence(timeout: 3), "the new chat isn't with the agent picked")
        shot("13-new-chat-rata")
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["About"].waitForExistence(timeout: 5))
        shot("14-settings")
        app.buttons["Color scheme, System"].tap()
        for mode in ["System", "Light", "Dark"] {
            XCTAssertTrue(app.buttons[mode].firstMatch.waitForExistence(timeout: 5))
        }
        XCTAssertFalse(app.buttons["Use in dark mode"].exists)
        shot("15-color-scheme")
    }

    func testYourAgentsInSettings() {
        app.buttons["Settings"].tap()
        for agent in ["brokk", "rata", "Studio", "varys"] {
            XCTAssertTrue(row(agent).waitForExistence(timeout: 5), "\(agent) isn't among your agents")
        }
        XCTAssertFalse(row("Codex").exists, "an agent only a Mac runs is listed")
        row("brokk").tap()
        XCTAssertTrue(app.textFields["Name"].waitForExistence(timeout: 5), "the agent's page didn't open")
        XCTAssertEqual(app.textFields["Name"].value as? String, "brokk")
        XCTAssertTrue(row("claude-opus-5.5").exists || app.staticTexts["Model"].exists, "brokk's model isn't on its page")
        shot("31-agent-page")
        app.navigationBars.buttons.firstMatch.tap()
        row("Add agent").tap()
        XCTAssertTrue(app.buttons["OpenClaw"].waitForExistence(timeout: 3), "Add agent offers no kinds")
        shot("32-add-agent")
        app.buttons["Hermes"].tap()
        XCTAssertTrue(app.textFields["Name"].waitForExistence(timeout: 5), "the new agent's page didn't open")
        XCTAssertEqual(app.textFields["Name"].value as? String, "Hermes")
        XCTAssertTrue(app.secureTextFields["API key"].exists, "a new Hermes agent isn't asked to connect")
        shot("33-new-agent")
        app.swipeUp()
        app.buttons["Remove agent"].tap()
        XCTAssertTrue(app.staticTexts["Remove Hermes?"].waitForExistence(timeout: 3), "removing asks nothing")
        let confirm = app.buttons.matching(NSPredicate(format: "label == 'Remove agent'")).allElementsBoundByIndex.last!
        shot("34-remove-agent")
        confirm.tap()
        XCTAssertTrue(row("Add agent").waitForExistence(timeout: 5), "removing didn't go back to the agents")
        XCTAssertFalse(app.buttons.containing(NSPredicate(format: "label BEGINSWITH 'Hermes'")).firstMatch.exists, "the removed agent is still listed")
    }

    func testScheduledTasks() {
        app.buttons["Scheduled"].tap()
        XCTAssertTrue(row("Morning brief").waitForExistence(timeout: 5), "the scheduled tasks didn't load")
        XCTAssertTrue(row("Inbox triage").exists, "the paused task isn't listed")
        shot("19-scheduled")
        row("Morning brief").tap()
        XCTAssertTrue(app.buttons["Run now"].waitForExistence(timeout: 5), "the task didn't open")
        sleep(1)
        shot("20-task")
        app.swipeUp()
        app.buttons.containing(NSPredicate(format: "label BEGINSWITH 'Today at' OR label BEGINSWITH 'Yesterday at'")).firstMatch.tap()
        sleep(1)
        shot("21-task-history")
        app.swipeDown()
        app.buttons["Edit"].tap()
        XCTAssertTrue(app.staticTexts["Edit task"].waitForExistence(timeout: 5), "the editor didn't open")
        shot("22-task-editor")
        app.buttons["Cancel"].tap()
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["New task"].tap()
        XCTAssertTrue(app.staticTexts["New scheduled task"].waitForExistence(timeout: 5))
        let name = app.textFields["Name"]
        name.tap()
        name.typeText("Evening wrap-up")
        app.buttons["Schedule"].tap()
        XCTAssertTrue(app.staticTexts["Say what the agent should do."].waitForExistence(timeout: 3), "a task without instructions saves")
        shot("23-task-new")
    }

    func testChatMenuAndFind() {
        row("Reply to Lena about the Q4 budget").tap()
        XCTAssertTrue(app.buttons["More"].waitForExistence(timeout: 5))
        app.buttons["More"].tap()
        XCTAssertTrue(app.buttons["Find in chat"].waitForExistence(timeout: 3))
        shot("24-chat-menu")
        app.buttons["Find in chat"].tap()
        let field = app.textFields["Find in chat"]
        XCTAssertTrue(field.waitForExistence(timeout: 3))
        sleep(1)
        field.typeText("Lena")
        XCTAssertTrue(app.staticTexts["1/3"].waitForExistence(timeout: 3), "find doesn't count its matches")
        shot("25-find")
    }

    func testQueueWhileTheAgentWorks() {
        app.buttons["New chat"].tap()
        let field = app.textFields.firstMatch.exists ? app.textFields.firstMatch : app.textViews.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("Take your time: where do things stand with Lena?")
        app.buttons["Send message"].tap()
        XCTAssertTrue(app.buttons["Stop agent"].waitForExistence(timeout: 5))
        // Sending put the keyboard away.
        field.tap()
        field.typeText("And with Marc?")
        app.buttons["Queue message"].tap()
        XCTAssertTrue(app.buttons["1 queued"].waitForExistence(timeout: 3), "a message sent while the agent works isn't queued")
        shot("26-queued")
        app.buttons["1 queued"].tap()
        XCTAssertTrue(app.staticTexts["Queued"].waitForExistence(timeout: 3))
        shot("27-queue-sheet")
    }

    /** Holding Send while the agent works offers the other way to send, from the button itself, with the keyboard still up. */
    func testHoldingSendOffersQueueAndSteer() {
        app.buttons["New chat"].tap()
        XCTAssertTrue(app.buttons["Agent and model"].waitForExistence(timeout: 5))
        shot("06-new-chat")
        app.buttons["Agent and model"].tap()
        app.buttons.containing(NSPredicate(format: "label BEGINSWITH 'claude-opus-5.5'")).firstMatch.tap()
        app.buttons["Done"].tap()
        let field = app.textFields.firstMatch.exists ? app.textFields.firstMatch : app.textViews.firstMatch
        field.tap()
        field.typeText("Take your time: where do things stand with Lena?")
        app.buttons["Send message"].tap()
        XCTAssertTrue(app.buttons["Stop agent"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.keyboards.count, 0, "the keyboard stays up after sending")
        field.tap()
        field.typeText("And Marc")
        app.buttons["Queue message"].press(forDuration: 1.2)
        XCTAssertTrue(app.buttons["Steer now"].waitForExistence(timeout: 3), "holding Send shows no menu")
        XCTAssertEqual(app.keyboards.count, 1, "the menu took the keyboard away")
        shot("28-send-menu")
        app.buttons["Steer now"].tap()
        XCTAssertTrue(app.staticTexts["Steer"].waitForExistence(timeout: 3), "Steer now didn't join the run")
    }

    /**
     * A push for a chat opens it when tapped. The push itself comes from outside the test
     * (`xcrun simctl push`, which /tmp/agents-ui.sh sends while this waits on the Home Screen).
     */
    func testANotificationOpensItsChat() throws {
        try XCTSkipIf(ProcessInfo.processInfo.environment["OTTER_PUSH"] == nil, "needs a push sent from the Mac")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        app.buttons["Settings"].tap()
        let toggle = app.switches["Notifications"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        // Off and on again asks iOS for permission, the first time.
        toggle.switches.firstMatch.tap()
        toggle.switches.firstMatch.tap()
        let allow = springboard.buttons["Allow"]
        if allow.waitForExistence(timeout: 5) { allow.tap() }
        XCUIDevice.shared.press(.home)
        let banner = springboard.otherElements.containing(NSPredicate(format: "label CONTAINS 'An agent is waiting for your approval'")).firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 40), "no notification arrived")
        shot("29-notification")
        banner.tap()
        XCTAssertTrue(app.buttons["Chat details"].waitForExistence(timeout: 10), "tapping the notification didn't open a chat")
        XCTAssertTrue(app.staticTexts["Plan the Lisbon offsite"].waitForExistence(timeout: 5), "it opened another chat")
        shot("30-opened-from-notification")
    }

    func testSearchAndSwipe() {
        app.buttons["Search chats"].tap()
        let field = app.textFields["Search chats"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        sleep(1)
        field.typeText("budget")
        XCTAssertTrue(row("Reply to Lena about the Q4 budget").waitForExistence(timeout: 3))
        XCTAssertFalse(row("Morning brief").exists, "search lists a chat that doesn't match")
        shot("16-search")
        app.buttons["Close search"].tap()
        let chat = row("Morning brief")
        XCTAssertTrue(chat.waitForExistence(timeout: 3))
        chat.swipeLeft()
        sleep(1)
        shot("17-swipe")
        app.buttons["Settle"].tap()
        XCTAssertTrue(app.buttons["Undo"].waitForExistence(timeout: 3), "settling offers no way back")
        shot("18-settled")
        app.buttons["Undo"].tap()
        XCTAssertTrue(row("Morning brief").waitForExistence(timeout: 3), "Undo didn't bring the chat back")
    }

    func testAccountAndWelcome() {
        app.buttons["Settings"].tap()
        row("Pretend chats, on this iPhone only").tap()
        XCTAssertTrue(app.buttons["Leave the demo"].waitForExistence(timeout: 5))
        shot("35-account")
        app.terminate()
        app.launchArguments = ["-otter:theme-source", "system", "-otter:demo", "NO"]
        app.launch()
        XCTAssertTrue(app.buttons["Try the demo"].waitForExistence(timeout: 5))
        shot("36-welcome")
    }
}
