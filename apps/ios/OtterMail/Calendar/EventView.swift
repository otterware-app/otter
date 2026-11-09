import SwiftUI

/**
 * One event: when, its meeting's Join and where first, then which calendar
 * it's on, what it says, and who's coming with their answers.
 */
struct EventView: View {
    @Environment(Session.self) private var session
    @Environment(\.palette) private var palette
    @Environment(\.openTaskTarget) private var openTarget
    let event: CalendarEvent
    var dates: CalendarDates = CalendarDates()
    var color: Color
    /** One of yours, on a calendar that takes changes. */
    var onEdit: (() -> Void)? = nil
    /** Why this is what a task kept of the event, rather than the event itself. */
    var notice: String? = nil

    @State private var newTask: MailTask?
    @State private var linking = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let notice {
                    Label(notice, systemImage: "calendar.badge.exclamationmark")
                        .font(.inter(.subheadline))
                        .foregroundStyle(palette.muted)
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(palette.warning.opacity(0.12), in: .rect(cornerRadius: 14))
                }
                head
                LinkedTasks(source: .event(event))
                facts
                if let details {
                    Text(details)
                        .font(.inter(.subheadline))
                        .foregroundStyle(palette.text.opacity(0.85))
                        .textSelection(.enabled)
                }
                if !event.guests.isEmpty { guests }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
        .background(palette.canvas)
        .navigationTitle("Event")
        .toolbarTitleDisplayMode(.inline)
        .toolbar {
            if let onEdit {
                ToolbarItem(placement: .primaryAction) {
                    Button("Edit", action: onEdit)
                }
            }
            if notice == nil {
                ToolbarItem(placement: .primaryAction) {
                    Menu("More", systemImage: "ellipsis") {
                        Button("Add task", systemImage: "checklist") { newTask = TaskSource.event(event).newTask }
                        if !session.tasks.tasks.isEmpty {
                            Button("Link to a task", systemImage: "link") { linking = true }
                        }
                    }
                }
            }
        }
        .sheet(item: $newTask) { task in
            NavigationStack {
                TaskEditor(task: task, onEmail: { email in
                    newTask = nil
                    openTarget(.email(email))
                })
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close", systemImage: "xmark") { newTask = nil }
                    }
                }
            }
        }
        .sheet(isPresented: $linking) { LinkToTaskSheet(source: .event(event)) }
    }

    /** What it is, when, how to join and where, before anything else. */
    private var head: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(event.title)
                .font(.inter(.title2).weight(.semibold))
                .foregroundStyle(palette.text)
                .strikethrough(event.status == .cancelled)
            Text(dates.when(event))
                .font(.inter(.subheadline))
                .foregroundStyle(palette.text)
            // An all-day event is a date, not a time, so it has no zone to read it in.
            if !event.allDay, let elsewhere = dates.elsewhere(event.start, event.end, zone: event.timeZone) {
                Text(elsewhere)
                    .font(.inter(.footnote))
                    .foregroundStyle(palette.muted)
            }
            if let link = event.meetingLink, let meeting = URL(string: link) {
                Link(destination: meeting) {
                    Label("Join \(Meetings.provider(link).title)", systemImage: "video.fill")
                        .font(.inter(.subheadline).weight(.semibold))
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.glassProminent)
                .padding(.top, 4)
            }
            if let place {
                Label(place, systemImage: "mappin.and.ellipse")
                    .font(.inter(.subheadline))
                    .foregroundStyle(palette.text)
                    .textSelection(.enabled)
            }
            HStack(spacing: 8) {
                chip(event.calendar.name, color: color)
                if event.status != .confirmed {
                    chip(event.status == .cancelled ? "Cancelled" : "Tentative", color: palette.warning)
                }
                if event.recurring {
                    chip("Repeats", color: palette.muted)
                }
            }
            .padding(.top, 4)
        }
    }

    /**
     * Where it is, once: the location, then any room booked that it doesn't
     * already name (Google often puts the room in the location too).
     */
    private var place: String? {
        let location = text(event.location)
        let rooms = event.rooms.map(\.person.label).filter { room in
            location.map { !$0.localizedCaseInsensitiveContains(room) } ?? true
        }
        let parts = [location].compactMap { $0 } + rooms
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var facts: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let organizer = event.organizer {
                fact("person.crop.circle", title: organizer.label, detail: "Organizer")
            }
            if let response = event.response {
                fact(response.symbol, title: response.title, detail: "Your answer")
            }
            if let htmlLink = event.htmlLink.flatMap(URL.init(string:)) {
                fact("calendar", title: "Google Calendar") {
                    Link("Open", destination: htmlLink)
                        .font(.inter(.subheadline).weight(.semibold))
                }
            }
        }
    }

    /** The organizer first, then by answer, as eventPresentation.ts sorts them, under their counts. */
    private var guests: some View {
        let coming = event.guests
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Text(coming.count == 1 ? "1 guest" : "\(coming.count) guests")
                Text(CalendarEvent.responseSummary(coming))
                    .foregroundStyle(palette.muted.opacity(0.8))
            }
            .font(.inter(.footnote))
            .foregroundStyle(palette.muted)
            ForEach(coming) { attendee in
                HStack(spacing: 12) {
                    SenderAvatar(person: attendee.person, size: 32)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(attendee.person.label)
                            .font(.inter(.subheadline))
                            .foregroundStyle(palette.text)
                            .lineLimit(1)
                        if !attendee.person.name.isEmpty {
                            Text(attendee.person.email)
                                .font(.inter(.footnote))
                                .foregroundStyle(palette.muted)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 8)
                    Label(attendee.response.title, systemImage: attendee.response.symbol)
                        .labelStyle(.iconOnly)
                        .font(.inter(.subheadline))
                        .foregroundStyle(attendee.response == .declined ? palette.error : palette.muted)
                        .accessibilityLabel(attendee.response.title)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func chip(_ title: String, color: Color) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(title).font(.inter(.footnote)).foregroundStyle(palette.text)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(palette.text.opacity(0.06), in: .capsule)
    }

    private func fact(_ symbol: String, title: String, detail: String? = nil) -> some View {
        fact(symbol, title: title, detail: detail) { EmptyView() }
    }

    private func fact<Action: View>(
        _ symbol: String,
        title: String,
        detail: String? = nil,
        @ViewBuilder action: () -> Action
    ) -> some View {
        HStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 17))
                .foregroundStyle(palette.muted)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.inter(.body))
                    .foregroundStyle(palette.text)
                    .textSelection(.enabled)
                if let detail {
                    Text(detail).font(.inter(.footnote)).foregroundStyle(palette.muted)
                }
            }
            Spacer(minLength: 8)
            action()
        }
        .frame(minHeight: 52)
    }

    /** Google's descriptions are often HTML, read as eventPresentation.ts reads them. */
    private var details: String? {
        guard let raw = text(event.details) else { return nil }
        return text(EventDescription.plain(raw))
    }

    private func text(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
}
