import SwiftUI

/** Where a task's link leads, opened by HomeView wherever it's tapped: the conversation, or the event in the calendar. */
nonisolated enum TaskTarget: Hashable {
    case email(TaskEmail)
    case event(TaskEvent)
}

extension EnvironmentValues {
    @Entry var openTaskTarget: (TaskTarget) -> Void = { _ in }
}

/**
 * One link of a task's, as a row: a conversation or an event, under the name
 * it has now when it's loaded, else the one kept with the link. One that can't
 * be reached (deleted, its mailbox gone or signed out) still reads, muted, and keeps
 * its place until it's unlinked: the task loses nothing.
 */
struct TaskLinkRow: View {
    @Environment(\.palette) private var palette

    let symbol: String
    let title: String
    var detail: String?
    var unavailable = false
    var onOpen: (() -> Void)?
    var onUnlink: (() -> Void)?

    var body: some View {
        HStack(spacing: 12) {
            Button {
                onOpen?()
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: symbol)
                        .font(.system(size: 15))
                        .foregroundStyle(palette.muted)
                        .frame(width: 22)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(title)
                            .font(.inter(.subheadline))
                            .foregroundStyle(unavailable ? palette.muted : palette.text)
                            .lineLimit(2)
                        if let line {
                            Text(line)
                                .font(.inter(.footnote))
                                .foregroundStyle(palette.muted)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 8)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(onOpen == nil)
            .accessibilityElement(children: .combine)
            .accessibilityHint(onOpen == nil ? "" : "Opens it")
            if let onUnlink {
                UnlinkButton(title: title, action: onUnlink)
            }
        }
        .frame(minHeight: 44)
    }

    private var line: String? {
        guard unavailable else { return detail }
        return [detail, "Not available"].compactMap { $0 }.joined(separator: " · ")
    }
}

struct UnlinkButton: View {
    @Environment(\.palette) private var palette

    let title: String
    let action: () -> Void

    var body: some View {
        Button("Unlink \(title)", systemImage: "xmark.circle.fill", action: action)
            .labelStyle(.iconOnly)
            .font(.system(size: 17))
            .foregroundStyle(palette.muted)
            .buttonStyle(.plain)
            .frame(width: 32, height: 32)
            .contentShape(.rect)
    }
}

/** How a link is labelled: the live conversation's or event's own words when they're loaded, else the snapshot's. */
struct TaskLinkLabels {
    let store: MailStore
    let calendar: CalendarStore
    let dates: CalendarDates

    func email(_ email: TaskEmail) -> (title: String, detail: String, unavailable: Bool) {
        if let thread = store.thread(email.thread) {
            let subject = thread.subject.trimmingCharacters(in: .whitespacesAndNewlines)
            return (subject.isEmpty ? email.subject : subject, email.mailbox, false)
        }
        let known = store.mailboxes.contains { $0.email.lowercased() == email.mailbox.lowercased() } || store.alias(email.mailbox) != nil
        return (email.subject, email.mailbox, !known || store.removedThreads.contains(email.thread))
    }

    func event(_ link: TaskEvent, now: Date = .now) -> (title: String, detail: String, unavailable: Bool) {
        let live = calendar.find(link, now: now)
        let start = live?.start ?? link.start
        let allDay = live?.allDay ?? link.allDay
        let day = dates.heading(start, now: now)
        var detail = allDay ? day : "\(day) · \(dates.timeLabel(start))"
        if link.scope == .series { detail = "Whole series · next \(detail)" }
        let reachable = CalendarStore.sources(store.shownMailboxes).contains { $0.email.lowercased() == link.account }
        return (live?.title ?? link.title, detail, live == nil && (!reachable || calendar.isGone(link, now: now)))
    }
}
