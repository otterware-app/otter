import SwiftUI

/**
 * The Day page's 24 hours, as the Mac and web apps' TimeGrid draws a day
 * (time-grid.tsx): the all-day row on top, an hour's line and label each
 * hour, every timed event a block from its start to its end, side by side
 * where they overlap (`TimeGrid.columns`), and a line at now on today. It
 * opens around now on today, else at the day's first event.
 */
struct DayGrid: View {
    @Environment(\.palette) private var palette
    let day: Date
    /** The events shown, on this day or around it. */
    let events: [CalendarEvent]
    /** Whether they have been fetched: the grid opens again at the first event once they are. */
    let loaded: Bool
    let now: Date
    let dates: CalendarDates
    let color: (EventCalendar) -> Color
    var onRefresh: () async -> Void = {}

    @State private var position = ScrollPosition()

    static let hourHeight: CGFloat = 48
    private static let gutter: CGFloat = 56
    /** time-grid.tsx's --calendar-today. */
    static let today = RGB(css: "#eb5757").color

    var body: some View {
        let timed = TimeGrid.timed(events, on: day, dates: dates)
        let allDay = TimeGrid.allDay(events, on: day, dates: dates)
        VStack(spacing: 0) {
            if !allDay.isEmpty { allDayRow(allDay) }
            Rectangle().fill(palette.border).frame(height: 0.5)
            ScrollView(.vertical) {
                hours(timed)
            }
            .scrollPosition($position)
            .scrollIndicators(.hidden)
            .refreshable { await onRefresh() }
            .task(id: "\(dates.dayKey(day))|\(loaded)") {
                position.scrollTo(y: CGFloat(TimeGrid.openingHour(timed, on: day, now: now, dates: dates)) * Self.hourHeight)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("day-grid")
    }

    private func allDayRow(_ allDay: [CalendarEvent]) -> some View {
        HStack(alignment: .top, spacing: 0) {
            Text("All-day")
                .font(.inter(.caption2))
                .foregroundStyle(palette.muted)
                .frame(width: Self.gutter - 8, height: 22, alignment: .trailing)
                .padding(.trailing, 8)
            VStack(spacing: 2) {
                ForEach(allDay) { event in
                    NavigationLink(value: event) {
                        EventBlock(event: event, color: color(event.calendar), dates: dates, height: 22)
                            .frame(height: 22)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("day-grid-all-day")
                }
            }
            .padding(.trailing, 8)
        }
        .padding(.vertical, 4)
    }

    private func hours(_ timed: [CalendarEvent]) -> some View {
        let layout = TimeGrid.columns(timed, on: day, dates: dates)
        let height = Self.hourHeight
        return ZStack(alignment: .topLeading) {
            ForEach(0..<24, id: \.self) { hour in
                Rectangle()
                    .fill(palette.border.opacity(0.7))
                    .frame(height: 0.5)
                    .padding(.leading, Self.gutter)
                    .offset(y: CGFloat(hour) * height)
            }
            ForEach(1..<24, id: \.self) { hour in
                Text(dates.hourLabel(hour))
                    .font(.inter(.caption2).monospacedDigit())
                    .foregroundStyle(palette.muted)
                    .frame(width: Self.gutter - 8, height: 14, alignment: .trailing)
                    .offset(y: CGFloat(hour) * height - 7)
            }
            GeometryReader { geometry in
                let width = max(geometry.size.width - Self.gutter - 8, 0)
                ForEach(timed) { event in
                    let placement = layout[event.id] ?? TimeGrid.Placement(col: 0, cols: 1)
                    let span = TimeGrid.minutes(event, on: day, dates: dates)
                    let top = span.lowerBound / 60 * height
                    let tall = max((span.upperBound - span.lowerBound) / 60 * height, 18)
                    NavigationLink(value: event) {
                        EventBlock(event: event, color: color(event.calendar), dates: dates, height: tall - 2, outlined: placement.cols > 1)
                    }
                    .buttonStyle(.plain)
                    .frame(width: max(width * TimeGrid.width(placement) - 3, 0), height: tall - 2)
                    .offset(x: Self.gutter + width * TimeGrid.leading(placement) + 1, y: top + 1)
                    .zIndex(Double(placement.col + 1))
                    .accessibilityIdentifier("day-grid-event")
                }
            }
            if dates.sameDay(day, now) { nowLine }
        }
        .frame(height: height * 24, alignment: .topLeading)
        .padding(.bottom, 24)
    }

    private var nowLine: some View {
        let top = CGFloat(dates.calendar.component(.hour, from: now) * 60 + dates.calendar.component(.minute, from: now)) / 60 * Self.hourHeight
        return ZStack(alignment: .topLeading) {
            Rectangle()
                .fill(Self.today)
                .frame(height: 2)
                .padding(.leading, Self.gutter)
                .offset(y: top - 1)
            Text(dates.timeLabel(now))
                .font(.inter(.caption2).weight(.medium).monospacedDigit())
                .foregroundStyle(.white)
                .padding(.horizontal, 4)
                .padding(.vertical, 1)
                .background(Self.today, in: .rect(cornerRadius: 4))
                .frame(width: Self.gutter - 2, alignment: .trailing)
                .offset(y: top - 8)
        }
        .zIndex(100)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/**
 * An event in the grid, as TimedEvent draws one: tinted in its calendar's
 * color with a bar down its side, dashed while it's unanswered, faded and
 * struck through when declined. Its text sits at its top left, however tall.
 */
struct EventBlock: View {
    @Environment(\.palette) private var palette
    /** Caption2's line in Inter (11pt, 1.21 high), at the reader's text size. */
    @ScaledMetric(relativeTo: .caption2) private var line: CGFloat = 13.4
    let event: CalendarEvent
    let color: Color
    let dates: CalendarDates
    /** The block's height, which says how much of its text it holds (`TimeGrid.titleLines`). */
    let height: CGFloat
    /** Edged in the canvas, so blocks laid over each other part. */
    var outlined = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 5)
        // The bar runs the block's height, so the row's alignment is where the text sits:
        // the top for a timed block, however tall; the middle of an all-day pill.
        let pill = TimeGrid.inAllDayRow(event)
        HStack(alignment: pill ? .center : .top, spacing: 0) {
            if tone == .solid {
                color.frame(width: 3)
            }
            content
                .padding(.horizontal, 6)
                .padding(.top, pill ? 0 : lines == nil ? 2 : 3)
            Spacer(minLength: 0)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(color.opacity(0.2).mix(with: palette.canvas, by: 0.15), in: shape)
        .clipShape(shape)
        .overlay {
            switch tone {
            case .unanswered, .tentative:
                shape.strokeBorder(color, style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
            default:
                if outlined { shape.strokeBorder(palette.canvas, lineWidth: 1) }
            }
        }
        .opacity(tone == .declined ? 0.55 : 1)
        .contentShape(shape)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(event.title), \(time)")
    }

    @ViewBuilder private var content: some View {
        if let lines {
            VStack(alignment: .leading, spacing: 1) {
                title.lineLimit(lines)
                Text(dates.rangeLabel(event.start, event.end))
                    .foregroundStyle(tint)
                    .monospacedDigit()
                    .lineLimit(1)
            }
            .font(.inter(.caption2))
        } else if TimeGrid.inAllDayRow(event) {
            title.lineLimit(1).font(.inter(.caption2))
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 6) {
                    title.lineLimit(1)
                    Text(dates.timeLabel(event.start)).foregroundStyle(tint).monospacedDigit()
                }
                title.lineLimit(1)
            }
            .font(.inter(.caption2))
        }
    }

    private var lines: Int? { TimeGrid.titleLines(height: height, line: line) }

    private var title: some View {
        Text(event.title)
            .fontWeight(.medium)
            .foregroundStyle(palette.text)
            .strikethrough(struck)
    }

    private var tint: Color { color.mix(with: palette.text, by: 0.25) }

    private var tone: EventStyle.Tone { EventStyle.tone(of: event) }

    private var struck: Bool { event.status == .cancelled || tone == .declined }

    private var time: String {
        TimeGrid.inAllDayRow(event) ? "All-day" : dates.rangeLabel(event.start, event.end)
    }
}
