import SwiftUI

/**
 * A task's links as chips under it in a list: every conversation and event,
 * each opening what it links to. One out of reach reads muted and struck
 * through, and still opens what the task kept of an event.
 */
struct TaskLinkChips: View {
    @Environment(MailStore.self) private var store
    @Environment(CalendarStore.self) private var calendar
    @Environment(Preferences.self) private var preferences
    @Environment(\.palette) private var palette

    let task: MailTask
    let onEmail: (TaskEmail) -> Void
    let onEvent: (TaskEvent) -> Void

    private var labels: TaskLinkLabels {
        TaskLinkLabels(store: store, calendar: calendar, dates: CalendarDates(preferences: preferences.calendar))
    }

    var body: some View {
        ChipFlow(spacing: 6) {
            ForEach(task.emails, id: \.key) { email in
                let label = labels.email(email)
                chip("envelope", label.title, unavailable: label.unavailable) { onEmail(email) }
                    .disabled(label.unavailable)
                    .accessibilityLabel(label.unavailable ? "\(label.title), not available" : "Email: \(label.title)")
                    .accessibilityHint(label.unavailable ? "" : "Opens the conversation")
            }
            ForEach(task.events, id: \.key) { link in
                let label = labels.event(link)
                chip(link.scope == .series ? "repeat" : "calendar", label.title, unavailable: label.unavailable) { onEvent(link) }
                    .accessibilityLabel("\(link.scope == .series ? "Every event" : "Event"): \(label.title)\(label.unavailable ? ", not available" : "")")
                    .accessibilityHint("Opens the event")
            }
        }
    }

    private func chip(_ symbol: String, _ title: String, unavailable: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: symbol).font(.system(size: 11))
                Text(title).lineLimit(1).strikethrough(unavailable)
            }
            .font(.inter(.caption))
            .foregroundStyle(palette.muted.opacity(unavailable ? 0.7 : 1))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .frame(maxWidth: 220, alignment: .leading)
            .background(palette.text.opacity(0.06), in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
    }
}

/** Chips in rows, wrapping to the next when one is full. */
struct ChipFlow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(subviews, width: proposal.width ?? .infinity)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                let width = min(size.width, bounds.width)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: width, height: size.height))
                x += width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let chip = min(size.width, width)
            if !row.indices.isEmpty, row.width + spacing + chip > width {
                rows.append(row)
                row = Row()
            }
            row.width = row.indices.isEmpty ? chip : row.width + spacing + chip
            row.height = max(row.height, size.height)
            row.indices.append(index)
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}
