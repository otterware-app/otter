import SwiftUI

/**
 * One event in a day's list, laid out like the mail rows (ThreadRow) and
 * labelled as the Mac and web apps' agenda labels it (agenda.tsx): when it is
 * on this day in the gutter, its calendar's color beside that, then the title
 * and a line of where it is. An invitation still open is dashed rather than
 * filled; a declined or cancelled event keeps its place, struck through.
 */
struct EventRow: View {
    @Environment(\.palette) private var palette
    let event: CalendarEvent
    /** The day it's listed under, so a longer event can say how far along it is. */
    var day: Date? = nil
    var dates: CalendarDates = CalendarDates()
    var color: Color

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .trailing, spacing: 1) {
                when
            }
            .font(.inter(.footnote).monospacedDigit())
            .foregroundStyle(palette.muted)
            .frame(width: 62, alignment: .trailing)

            gutter
                .frame(width: 3)
                .padding(.vertical, 1)

            VStack(alignment: .leading, spacing: 2) {
                Text(event.title)
                    .font(.inter(.subheadline).weight(.medium))
                    .foregroundStyle(struck ? palette.muted : palette.text)
                    .strikethrough(struck)
                    .lineLimit(2)
                if let line {
                    Text(line)
                        .font(.inter(.footnote))
                        .foregroundStyle(palette.muted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)

            if let response = event.response, response != .accepted {
                Image(systemName: response.symbol)
                    .font(.inter(.footnote))
                    .foregroundStyle(palette.muted)
                    .accessibilityLabel(response.title)
            }
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }

    /**
     * When it is on this day, in the mobile calendar's words
     * (CalendarAgendaRouteScreen's agendaTimeLabel): its own times, or where a
     * longer event starts or ends here.
     */
    @ViewBuilder private var when: some View {
        switch timing.kind {
        case .allDay:
            Text("All-day")
        case .from:
            Text("From").foregroundStyle(palette.muted.opacity(0.7))
            Text(dates.timeLabel(event.start))
        case .until:
            Text("Until").foregroundStyle(palette.muted.opacity(0.7))
            Text(dates.timeLabel(event.end))
        case .range:
            Text(dates.timeLabel(event.start))
            Text(CalendarDates.durationLabel(event.end.timeIntervalSince(event.start)))
                .foregroundStyle(palette.muted.opacity(0.7))
        }
    }

    @ViewBuilder private var gutter: some View {
        let shape = RoundedRectangle(cornerRadius: 1.5)
        switch tone {
        case .solid: shape.fill(color)
        case .declined: shape.strokeBorder(color, lineWidth: 1.5)
        case .unanswered, .tentative:
            shape.strokeBorder(color, style: StrokeStyle(lineWidth: 1.5, dash: [2, 2]))
        }
    }

    private var timing: EventTiming { EventDays.timing(of: event, on: day, dates: dates) }

    private var tone: EventStyle.Tone { EventStyle.tone(of: event) }

    private var struck: Bool { event.status == .cancelled || tone == .declined }

    private var line: String? {
        var parts: [String] = []
        if event.status == .cancelled { parts.append("Cancelled") }
        if let runs { parts.append(runs) }
        let location = event.location?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !location.isEmpty {
            parts.append(location)
        } else if let link = event.meetingLink {
            parts.append(Meetings.provider(link).title)
        } else if event.guests.count > 1 {
            parts.append("\(event.guests.count) people")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /** "Day 2 of 3" while a longer event runs (agendaRows.ts's dayOfSpan). */
    private var runs: String? {
        guard let reached = timing.dayOfSpan, let span = timing.spanDays else { return nil }
        return "Day \(reached) of \(span)"
    }
}
