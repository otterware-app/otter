import Foundation
import Testing
@testable import Otter_Agents

/** apps/web's scheduled-text.test.ts, for the phone's port of it. */
@MainActor
struct ScheduleTests {
    @Test func cronInWords() {
        #expect(ScheduleText.cron("* * * * *") == "Every minute")
        #expect(ScheduleText.cron("*/15 * * * *") == "Every 15 minutes")
        #expect(ScheduleText.cron("0 * * * *") == "Every hour")
        #expect(ScheduleText.cron("5 * * * *") == "Hourly at :05")
        #expect(ScheduleText.cron("0 */2 * * *") == "Every 2 hours")
        #expect(ScheduleText.cron("0 9 1 * *")?.hasPrefix("Monthly on the 1st at") == true)
        #expect(ScheduleText.cron("0 9 22 * *")?.hasPrefix("Monthly on the 22nd at") == true)
        #expect(ScheduleText.cron("0 9 * * 1-5")?.hasPrefix("Weekdays at") == true)
        #expect(ScheduleText.cron("0 9 * * 0,6")?.hasPrefix("Weekends at") == true)
        #expect(ScheduleText.cron("0 9 * * 7")?.hasPrefix("Every Sunday at") == true)
        #expect(ScheduleText.cron("0 9 * * 1,3")?.hasPrefix("Mon, Wed at") == true)
        #expect(ScheduleText.cron("0 9 1 1 *") == nil)
        #expect(ScheduleText.cron("0 9 1 * 1") == nil)
        #expect(ScheduleText.cron("not cron") == nil)
    }

    @Test func schedulesInWords() {
        #expect(ScheduleText.schedule(.every(ms: 90 * 60_000)) == "Every 90 minutes")
        #expect(ScheduleText.schedule(.every(ms: 2 * 3_600_000)) == "Every 2 hours")
        #expect(ScheduleText.schedule(.every(ms: 86_400_000)) == "Every day")
        #expect(ScheduleText.schedule(.other("When new mail arrives")) == "When new mail arrives")
        #expect(ScheduleText.schedule(.cron(expr: "1 2 3 4 5", tz: nil)) == "Cron 1 2 3 4 5")
        #expect(ScheduleText.schedule(.cron(expr: "0 * * * *", tz: "Pacific/Kiritimati")) == "Every hour (Pacific/Kiritimati)")
        #expect(ScheduleText.until(5 * 60_000, now: 0) == "in 5 min")
        #expect(ScheduleText.until(2 * 86_400_000, now: 0) == "in 2 days")
        #expect(ScheduleText.duration(64_000) == "1 min 4 s")
    }

    @Test func theEditorsFieldsRoundTrip() {
        let cases: [(ScheduledTask.Schedule, WhenForm.Repeat)] = [
            (.cron(expr: "30 7 * * *", tz: "Europe/Berlin"), .daily),
            (.cron(expr: "0 9 * * 1-5", tz: nil), .weekdays),
            (.cron(expr: "15 16 * * 5", tz: "UTC"), .weekly),
            (.cron(expr: "0 8 31 * *", tz: nil), .monthly),
            (.every(ms: 45 * 60_000), .interval),
            (.every(ms: 3 * 3_600_000), .interval),
            (.cron(expr: "*/5 9-17 * * *", tz: nil), .cron),
        ]
        for (schedule, kind) in cases {
            let form = WhenForm(schedule)
            #expect(form?.repeat == kind)
            #expect(form?.schedule == schedule)
        }
        // No zone is the agent's own: kept, not replaced with this device's.
        #expect(WhenForm(.cron(expr: "0 9 * * *", tz: nil))?.tz == "")
        #expect(WhenForm(.other("When new mail arrives")) == nil)
        #expect(WhenForm(.cron(expr: "0 9 * * 7", tz: nil))?.weekday == 0)
    }

    @Test func whatIsWrongWithAWhen() {
        var form = WhenForm()
        #expect(form.problem() == nil)
        form.repeat = .once
        form.once = .now.addingTimeInterval(-60)
        #expect(form.problem() == "Pick a time in the future.")
        form.repeat = .cron
        form.cron = "0 9 * *"
        #expect(form.problem()?.hasPrefix("A cron expression has five fields") == true)
        form.repeat = .interval
        form.every = 0
        #expect(form.problem() == "Run it at least every minute.")
    }

    @Test func aHermesJobIsATask() {
        let agents = Agents()
        let schedules = Schedules(agents: agents)
        let task = schedules.hermesTask([
            "id": "brief", "name": "Morning brief", "prompt": "Tell me what's new", "schedule": ["kind": "cron", "expr": "0 8 * * 1-5"],
            "enabled": true, "state": "scheduled", "next_run_at": "2026-11-11T08:00:00Z", "last_run_at": "2026-11-10T08:00:00Z",
            "last_status": "error", "last_error": "No route", "deliver": "telegram:12345",
        ])
        #expect(task?.schedule == .cron(expr: "0 8 * * 1-5", tz: nil))
        #expect(task?.delivery == .channel(id: "telegram", label: "Telegram", to: "12345", accountId: nil))
        #expect(task?.lastRun?.status == .error && task?.lastRun?.error == "No route")
        #expect(task?.nextRunAt == 1_794_384_000_000)
        #expect(task?.failed == true)

        let paused = schedules.hermesTask(["id": "x", "schedule": ["kind": "interval", "minutes": 90], "state": "paused", "next_run_at": "2026-11-11T08:00:00Z"])
        #expect(paused?.enabled == false && paused?.nextRunAt == nil)
        #expect(paused?.schedule == .every(ms: 90 * 60_000))
        #expect(paused?.delivery == .otter(newChat: true))
        #expect(Schedules.hermesSchedule(.every(ms: 90 * 60_000)) == "every 90m")
        #expect(schedules.hermesTask(["id": "y", "schedule_display": "At dawn"])?.editable == false)
    }
}
