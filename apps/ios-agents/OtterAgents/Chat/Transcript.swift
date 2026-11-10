import SwiftUI

/** One message of yours: what it carried, the words in their bubble, and when. */
struct UserTurnView: View {
    @Environment(\.palette) private var palette
    let turn: ChatTurn
    @State private var copied = false

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            if let context = turn.context {
                Label(context.count > 1 ? "\(context.count) conversations" : context.subjects.first ?? "Conversation",
                      systemImage: ["quote": "text.quote", "draft": "square.and.pencil", "sent": "paperplane"][context.kind] ?? "envelope")
                    .font(.ui(13))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
            }
            if !turn.attachments.isEmpty { attachments }
            VStack(alignment: .leading, spacing: 8) {
                if let skill = turn.skill {
                    Text("/\(skill)")
                        .font(.mono(13, .medium))
                        .foregroundStyle(palette.muted)
                }
                ForEach(turn.citations) { citation in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .top, spacing: 8) {
                            RoundedRectangle(cornerRadius: 1).fill(palette.border).frame(width: 2)
                            Text(citation.text).font(.ui(14)).foregroundStyle(palette.muted).lineLimit(3)
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        if let comment = citation.comment, !comment.isEmpty {
                            Text(comment).font(.ui(14)).foregroundStyle(palette.text)
                        }
                    }
                }
                if !turn.text.isEmpty {
                    MarkdownText(blocks: [.paragraph(turn.text)])
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(palette.card, in: .rect(cornerRadius: 20))
            .opacity(turn.text.isEmpty && turn.skill == nil && turn.citations.isEmpty ? 0 : 1)
            .frame(height: turn.text.isEmpty && turn.skill == nil && turn.citations.isEmpty ? 0 : nil)
            HStack(spacing: 6) {
                if turn.intent == "steer" || turn.intent == "promoted" {
                    Label("Steer", systemImage: "arrow.uturn.forward")
                        .font(.ui(12, .medium))
                        .foregroundStyle(palette.muted)
                        .accessibilityHint(turn.intent == "promoted" ? "Originally queued, then promoted to steer the active turn" : "Steered the active turn")
                }
                if let at = turn.startedAt {
                    Text(ChatText.messageTime(at)).font(.ui(13, .medium)).monospacedDigit().foregroundStyle(palette.tertiary)
                }
                CopyButton(text: turn.text, label: "Copy message")
            }
            .padding(.trailing, 2)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.leading, 52)
    }

    private var attachments: some View {
        VStack(alignment: .trailing, spacing: 6) {
            let images = turn.attachments.filter(\.isImage)
            if !images.isEmpty {
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(104), spacing: 6), count: min(2, images.count)), alignment: .trailing, spacing: 6) {
                    ForEach(Array(images.enumerated()), id: \.offset) { _, file in
                        Group {
                            if let image = Self.thumb(file.thumb) {
                                Image(uiImage: image).resizable().scaledToFill()
                            } else {
                                ZStack {
                                    palette.card
                                    Image(systemName: "photo").foregroundStyle(palette.muted)
                                }
                            }
                        }
                        .frame(width: 104, height: 104)
                        .clipShape(.rect(cornerRadius: 14))
                        .accessibilityLabel(file.name)
                    }
                }
                .fixedSize()
            }
            ForEach(Array(turn.attachments.filter { !$0.isImage }.enumerated()), id: \.offset) { _, file in
                HStack(spacing: 8) {
                    Image(systemName: "doc").font(.system(size: 15)).foregroundStyle(palette.muted)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(file.name).font(.ui(14, .medium)).foregroundStyle(palette.text).lineLimit(1)
                        Text(ChatText.size(file.size)).font(.ui(12)).foregroundStyle(palette.muted)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(palette.card, in: .rect(cornerRadius: 14))
            }
        }
    }

    private static func thumb(_ url: String?) -> UIImage? {
        guard let url, let comma = url.firstIndex(of: ","), let data = Data(base64Encoded: String(url[url.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }
}

struct CopyButton: View {
    @Environment(\.palette) private var palette
    let text: String
    var label = "Copy"
    @State private var copied = false

    var body: some View {
        Button(copied ? "Copied" : label, systemImage: copied ? "checkmark" : "doc.on.doc") {
            UIPasteboard.general.string = text
            copied = true
            Haptics.done()
            Task {
                try? await Task.sleep(for: .seconds(1.2))
                copied = false
            }
        }
        .labelStyle(.iconOnly)
        .font(.system(size: 13))
        .foregroundStyle(palette.muted)
        .frame(width: 28, height: 28)
        .contentShape(.rect)
        .buttonStyle(.plain)
    }
}

/** One reply: the work it took, folded once it's done, then what the agent said. */
struct AssistantTurnView: View {
    @Environment(\.palette) private var palette
    @Environment(ChatStore.self) private var store
    let turn: ChatTurn
    let chat: Chat
    let isLast: Bool
    /** The turn before it was a steer: its work continued the run. */
    var continued = false
    @State private var open = false

    private var live: Bool { turn.finishedAt == nil && turn.error == nil && store.runs[chat.id] != nil }

    /** What it took to get to the answer: everything up to the last step. */
    private var work: [ChatItem] {
        guard let last = turn.items.lastIndex(where: { $0.step != nil }) else { return [] }
        return Array(turn.items[...last])
    }

    private var answer: [ChatItem] {
        let last = turn.items.lastIndex { $0.step != nil } ?? -1
        return Array(turn.items[(last + 1)...])
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let delivered = turn.delivered { delivery(delivered) }
            if !work.isEmpty {
                if live {
                    WorkLog(items: work, live: true)
                } else {
                    fold
                    if open || store.found?.turnId == turn.id { WorkLog(items: work, live: false).transition(.opacity) }
                }
            }
            ForEach(Array(answer.enumerated()), id: \.offset) { _, item in
                if let text = item.text, !text.isEmpty { MarkdownView(source: text) }
            }
            if live, turn.items.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "circle.dashed").font(.system(size: 14, weight: .medium))
                    Text("Working").font(.ui(14))
                }
                .foregroundStyle(palette.muted)
                .shimmer()
                .frame(minHeight: 28)
            }
            if let error = turn.error { failure(error) }
            if !turn.changes.isEmpty, !live { ChangesList(changes: turn.changes) }
            if isLast, store.isDetached(chat), turn.finishedAt == nil, turn.error == nil {
                Text("Lost \(AgentKind.name(of: chat.provider)) mid-reply. The rest shows here once it's back.")
                    .font(.ui(14))
                    .foregroundStyle(palette.muted)
            }
            if !live, turn.finishedAt != nil, !turn.answer.isEmpty {
                HStack(spacing: 2) {
                    CopyButton(text: turn.answer, label: "Copy message")
                    if let at = turn.finishedAt {
                        Text(ChatText.messageTime(at)).font(.ui(13, .medium)).monospacedDigit().foregroundStyle(palette.tertiary)
                            .padding(.leading, 4)
                    }
                }
                .padding(.leading, -7)
                .padding(.top, -4)
            }
            if turn.forked {
                HStack(spacing: 10) {
                    Rectangle().fill(palette.hairline).frame(height: 1)
                    Label("Forked from conversation", systemImage: "arrow.triangle.branch").font(.ui(13)).foregroundStyle(palette.muted).fixedSize()
                    Rectangle().fill(palette.hairline).frame(height: 1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
    }

    private func delivery(_ delivered: ChatDelivery) -> some View {
        let time = turn.startedAt.map { " · \(ChatText.messageTime($0))" } ?? ""
        let (symbol, text) = switch delivered {
        case .automation(_, let name, _): ("clock", "Scheduled\(name.map { " · \($0)" } ?? "")\(time)")
        case .message(let from): ("paperplane", "\(from.map { "Sent by \($0)" } ?? "Sent to you")\(time)")
        }
        return Label(text, systemImage: symbol)
            .font(.ui(13, .medium))
            .foregroundStyle(palette.muted)
    }

    private var fold: some View {
        Button {
            Haptics.tap()
            withAnimation(.easeOut(duration: 0.18)) { open.toggle() }
        } label: {
            HStack(spacing: 6) {
                Text(summary).font(.ui(14, .medium)).foregroundStyle(palette.muted)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(palette.muted.opacity(0.7))
                    .rotationEffect(.degrees(open ? 90 : 0))
                Spacer()
            }
            .frame(height: 42)
            .overlay(alignment: .bottom) { Rectangle().fill(palette.hairline).frame(height: 1) }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private var summary: String {
        guard let started = turn.startedAt, let finished = turn.finishedAt, finished > started else {
            let steps = work.count { $0.step != nil }
            return "Took \(steps) step\(steps == 1 ? "" : "s")"
        }
        return "\(continued ? "Continued" : "Worked") for \(ChatText.duration(finished - started))"
    }

    private func failure(_ error: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(AgentKind.name(of: chat.provider)) error").font(.ui(14, .semibold))
                    Text(error).font(.ui(14))
                }
            } icon: {
                Image(systemName: "exclamationmark.circle")
            }
            .foregroundStyle(error == "Stopped." ? palette.muted : palette.error)
            if isLast, store.retries[turn.id] != nil, store.runs[chat.id] == nil {
                Button("Retry", systemImage: "arrow.clockwise") { store.retry(turn.id) }
                    .font(.ui(14, .medium))
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .tint(palette.text)
            }
        }
    }
}

/** The steps of a reply and what the agent said between them. */
struct WorkLog: View {
    @Environment(\.palette) private var palette
    let items: [ChatItem]
    let live: Bool

    /** Steps in a row from one integration read as one group. */
    private var groups: [(source: String?, items: [(offset: Int, item: ChatItem)])] {
        var groups: [(source: String?, items: [(offset: Int, item: ChatItem)])] = []
        for (offset, item) in items.enumerated() {
            let source = item.step.flatMap { $0.compaction ? nil : $0.source }
            if let source, groups.last?.source == source {
                groups[groups.count - 1].items.append((offset, item))
            } else {
                groups.append((source, [(offset, item)]))
            }
        }
        return groups
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
                if let source = group.source {
                    HStack(spacing: 7) {
                        Image(systemName: "command").font(.system(size: 13, weight: .medium)).frame(width: 21)
                        Text("Used \(source) integration").font(.ui(14))
                    }
                    .foregroundStyle(palette.muted)
                    .frame(minHeight: 28)
                }
                ForEach(group.items, id: \.offset) { entry in
                    switch entry.item {
                    case .text(_, let text):
                        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            MarkdownView(source: text).padding(.vertical, 6)
                        }
                    case .step(_, let step, let output):
                        StepRow(step: step, output: output, live: live)
                            .padding(.leading, group.source == nil ? 0 : 14)
                    }
                }
            }
        }
    }
}

private struct StepRow: View {
    @Environment(\.palette) private var palette
    let step: ChatStep
    let output: String?
    let live: Bool
    @State private var open = false

    private var running: Bool { output == nil && live }
    private var hasMore: Bool { !(output ?? "").isEmpty || !(step.detail ?? "").isEmpty }

    private var symbol: String {
        if step.compaction { return "rectangle.compress.vertical" }
        if step.source != nil { return "command" }
        return switch step.kind {
        case "command": "terminal"
        case "read": "doc.text"
        case "edit": "square.and.pencil"
        case "search": "magnifyingglass"
        case "web": "globe"
        default: "wrench.and.screwdriver"
        }
    }

    private var title: String {
        guard step.compaction else { return step.title }
        if output == nil { return "Compacting context" }
        return (output ?? "").isEmpty ? "Context compacted" : "Context compaction failed"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                guard hasMore else { return }
                Haptics.tap()
                withAnimation(.easeOut(duration: 0.18)) { open.toggle() }
            } label: {
                HStack(spacing: 7) {
                    Image(systemName: symbol).font(.system(size: 13, weight: .medium)).frame(width: 21)
                    Text(title).font(.ui(14)).lineLimit(1)
                    if hasMore {
                        Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)).opacity(0.7)
                            .rotationEffect(.degrees(open ? 180 : 0))
                    }
                    Spacer(minLength: 0)
                }
                .foregroundStyle(step.compaction && !(output ?? "").isEmpty ? palette.error : palette.muted)
                .frame(minHeight: 28)
                .contentShape(.rect)
                .shimmer(running)
            }
            .buttonStyle(.plain)
            if open { detail }
        }
    }

    private var detail: some View {
        let body = output ?? ""
        let pretty = Self.json(body)
        return VStack(alignment: .leading, spacing: 6) {
            Text(pretty == nil ? "text" : "json").font(.mono(11)).foregroundStyle(palette.muted)
            if let detail = step.detail, !detail.isEmpty {
                Text(detail).font(.mono(12)).foregroundStyle(palette.text).textSelection(.enabled)
            }
            if !body.isEmpty {
                ScrollView {
                    Text(pretty ?? body)
                        .font(.mono(12))
                        .lineSpacing(2)
                        .foregroundStyle(palette.text)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 240)
                .scrollBounceBehavior(.basedOnSize)
            } else if running {
                Text("Running…").font(.ui(13)).foregroundStyle(palette.muted)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.card, in: .rect(cornerRadius: 10))
        .padding(.leading, 28)
        .padding(.bottom, 6)
    }

    private static func json(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("{") || trimmed.hasPrefix("["), let value = try? JSONSerialization.jsonObject(with: Data(trimmed.utf8)),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]) else { return nil }
        return String(decoding: data, as: UTF8.self)
    }
}

/** What the agent changed in Otter, on a device that has Otter's tools: listed, to know it happened. */
private struct ChangesList: View {
    @Environment(\.palette) private var palette
    let changes: [ChatChange]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(changes.enumerated()), id: \.offset) { index, change in
                HStack(spacing: 10) {
                    Image(systemName: ["draft": "square.and.pencil", "thread": "envelope", "label": "tag", "view": "line.3.horizontal.decrease",
                                       "theme": "paintpalette", "event": "calendar"][change.kind] ?? "doc")
                        .font(.system(size: 14))
                        .foregroundStyle(palette.muted)
                        .frame(width: 21)
                    Text(change.title.isEmpty ? change.kind.capitalized : change.title).font(.ui(14)).foregroundStyle(palette.text).lineLimit(1)
                    Spacer(minLength: 8)
                    Text(change.action.capitalized).font(.ui(13)).foregroundStyle(palette.muted)
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 40)
                .overlay(alignment: .top) { if index > 0 { Rectangle().fill(palette.hairline).frame(height: 1) } }
            }
        }
        .background(palette.card, in: .rect(cornerRadius: 14))
    }
}
