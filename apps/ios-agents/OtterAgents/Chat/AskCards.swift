import SwiftUI

/** Lays pills out in rows, wrapping. */
struct Flow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(proposal.width ?? .infinity, subviews)
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0,
                      height: rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1)))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(bounds.width, subviews) {
            var x = bounds.minX
            for index in row.items {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private func rows(_ width: CGFloat, _ subviews: Subviews) -> [(items: [Int], width: CGFloat, height: CGFloat)] {
        var rows: [(items: [Int], width: CGFloat, height: CGFloat)] = []
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            if let last = rows.last, last.width + spacing + size.width <= width {
                rows[rows.count - 1] = (last.items + [index], last.width + spacing + size.width, max(last.height, size.height))
            } else {
                rows.append(([index], size.width, size.height))
            }
        }
        return rows
    }
}

private struct Pill: ButtonStyle {
    enum Tone { case primary, secondary, danger }
    @Environment(\.palette) private var palette
    @Environment(\.isEnabled) private var enabled
    var tone = Tone.secondary
    var wide = false

    func makeBody(configuration: Configuration) -> some View {
        let (fill, text): (Color, Color) = switch tone {
        case .primary: (palette.action, palette.actionText)
        case .secondary: (palette.text.opacity(0.08), palette.text)
        case .danger: (palette.dangerFill, palette.error)
        }
        configuration.label
            .font(.ui(15, .semibold))
            .foregroundStyle(text)
            .padding(.horizontal, 20)
            .frame(maxWidth: wide ? .infinity : nil, minHeight: 42)
            .background(fill, in: .capsule)
            .opacity(configuration.isPressed ? 0.7 : enabled ? 1 : 0.4)
    }
}

private struct AskCard<Content: View>: View {
    @Environment(\.palette) private var palette
    let caption: String
    var count: (Int, Int)?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(caption.uppercased()).font(.ui(12, .bold)).kerning(1.1).foregroundStyle(palette.muted)
                Spacer()
                if let count, count.1 > 1 {
                    Text("\(count.0) of \(count.1)").font(.ui(12, .medium)).monospacedDigit().foregroundStyle(palette.muted)
                }
            }
            content
        }
        .padding(16)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}

/**
 * An agent asking before it acts, in the composer's place: what it wants to do, exactly, and
 * the answers it takes.
 */
struct ApprovalCard: View {
    @Environment(\.palette) private var palette
    @Environment(ChatStore.self) private var store
    let chat: Chat
    let approval: Approval
    let count: (Int, Int)

    private var agent: String { AgentKind.name(of: chat.provider) }

    private var title: String {
        switch approval.kind {
        case "command": "Allow \(agent) to run this command?"
        case "fileChange": "Allow \(agent) to edit \(approval.title.isEmpty ? "files" : approval.title)?"
        case "permission": approval.title.isEmpty ? "Allow \(agent) to change its permissions?" : approval.title
        default: approval.title.isEmpty ? "Allow \(agent) to use a tool?" : "Allow \(agent) to \(approval.title)?"
        }
    }

    var body: some View {
        AskCard(caption: "Approval needed", count: count) {
            Text(title).font(.ui(18, .semibold)).foregroundStyle(palette.text)
            if let detail = approval.detail, !detail.isEmpty {
                if approval.kind == "command" {
                    let command = Text(detail).font(.mono(13)).foregroundStyle(palette.text).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    // A long command scrolls in its box; a short one is as tall as it is.
                    ViewThatFits(in: .vertical) {
                        command
                        ScrollView { command }.frame(height: 120)
                    }
                    .padding(10)
                    .background(palette.text.opacity(0.06), in: .rect(cornerRadius: 10))
                } else {
                    Text(detail).font(.ui(14)).foregroundStyle(palette.muted)
                }
            }
            if let reason = approval.reason, !reason.isEmpty {
                Text(reason).font(.ui(14)).foregroundStyle(palette.warning)
            }
            Flow {
                Button("Allow once") { store.respond(approval, "once") }.buttonStyle(Pill(tone: .primary))
                if approval.choices.contains("session") {
                    Button("Allow for this chat") { store.respond(approval, "session") }.buttonStyle(Pill())
                }
                if approval.choices.contains("always") {
                    Button("Always allow") { store.respond(approval, "always") }.buttonStyle(Pill())
                }
                Button("Deny") { store.respond(approval, "deny") }.buttonStyle(Pill(tone: .danger))
                Button("Stop the agent") { store.stop(chat.id) }.buttonStyle(Pill())
            }
            .padding(.top, 4)
        }
    }
}

struct QuestionCard: View {
    @Environment(\.palette) private var palette
    @Environment(ChatStore.self) private var store
    let chat: Chat
    let question: Question
    let count: (Int, Int)
    @State private var chosen: [String: [String]] = [:]
    @State private var own: [String: String] = [:]

    private var agent: String { AgentKind.name(of: chat.provider) }
    private var secret: Bool { question.items.contains(where: \.secret) }
    /** One question with one answer is answered by the tap. */
    private var quick: Bool { question.items.count == 1 && !question.items[0].multiSelect && !secret }
    private var answers: [String: [String]] {
        Dictionary(uniqueKeysWithValues: question.items.map { item in
            let typed = (own[item.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return (item.id, (chosen[item.id] ?? []) + (typed.isEmpty ? [] : [typed]))
        })
    }
    private var complete: Bool { !secret && question.items.allSatisfy { answers[$0.id]?.isEmpty == false } }

    var body: some View {
        AskCard(caption: "\(agent) asks", count: count) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(question.items) { item in
                        VStack(alignment: .leading, spacing: 8) {
                            if !item.header.isEmpty {
                                Text(item.header.uppercased()).font(.ui(13, .bold)).foregroundStyle(palette.muted)
                            }
                            Text(item.question).font(.ui(16)).foregroundStyle(palette.text)
                            if item.secret {
                                Text("This asks for a secret, which only goes through \(agent)'s own app.")
                                    .font(.ui(14)).foregroundStyle(palette.muted)
                            } else {
                                if item.multiSelect { Text("Choose any that apply.").font(.ui(13)).foregroundStyle(palette.muted) }
                                ForEach(item.options, id: \.label) { option in
                                    let on = chosen[item.id]?.contains(option.label) == true
                                    Button { choose(item, option.label) } label: {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(option.label).font(.ui(14, .semibold)).foregroundStyle(palette.text)
                                            if let description = option.description, !description.isEmpty {
                                                Text(description).font(.ui(14)).foregroundStyle(palette.muted)
                                            }
                                        }
                                        .frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
                                        .padding(.horizontal, 14)
                                        .padding(.vertical, 10)
                                        .background(on ? palette.focus.opacity(0.12) : palette.text.opacity(0.04), in: .rect(cornerRadius: 14))
                                        .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(on ? palette.focus : palette.border, lineWidth: 1) }
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityAddTraits(on ? .isSelected : [])
                                }
                                TextField("Or answer in your own words", text: Binding(
                                    get: { own[item.id] ?? "" },
                                    set: { value in
                                        own[item.id] = value
                                        if !item.multiSelect, !value.isEmpty { chosen[item.id] = [] }
                                    }
                                ), axis: .vertical)
                                .font(.ui(15))
                                .lineLimit(1...3)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 11)
                                .background(palette.text.opacity(0.04), in: .rect(cornerRadius: 14))
                                .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(palette.border, lineWidth: 1) }
                            }
                        }
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxHeight: 340)
            if !secret {
                Button("Answer") { store.answer(question, answers) }
                    .buttonStyle(Pill(tone: complete ? .primary : .secondary, wide: true))
                    .disabled(!complete)
            }
            Button("Skip") { store.answer(question, nil) }
                .font(.ui(14, .medium))
                .foregroundStyle(palette.muted)
                .frame(maxWidth: .infinity, minHeight: 30)
        }
    }

    private func choose(_ item: Question.Item, _ label: String) {
        Haptics.tap()
        if quick { return store.answer(question, [item.id: [label]]) }
        var current = chosen[item.id] ?? []
        if item.multiSelect {
            if let index = current.firstIndex(of: label) { current.remove(at: index) } else { current.append(label) }
        } else {
            current = [label]
            own[item.id] = ""
        }
        chosen[item.id] = current
    }
}

/** What's going on in the chat, floating over the composer: the run's clock, what's queued, and the way back down. */
struct WorkingControl: View {
    @Environment(\.palette) private var palette
    @Environment(ChatStore.self) private var store
    let chat: Chat
    let following: Bool
    var toEnd: () -> Void
    var showQueue: () -> Void

    private var running: Bool { store.runs[chat.id] != nil }
    private var queued: Int { store.queued(in: chat.id).count }

    var body: some View {
        GlassEffectContainer(spacing: 12) {
            HStack(spacing: 8) {
                if running || queued > 0 {
                    HStack(spacing: 0) {
                        if running {
                            TimelineView(.periodic(from: .now, by: 1)) { context in
                                Text(label(at: context.date))
                                    .font(.ui(13, .medium))
                                    .monospacedDigit()
                                    .foregroundStyle(palette.text)
                                    .padding(.horizontal, 14)
                            }
                        }
                        if running, queued > 0 { Rectangle().fill(palette.border).frame(width: 1, height: 16) }
                        if queued > 0 {
                            Button(action: showQueue) {
                                Label("\(queued) queued", systemImage: "list.number")
                                    .font(.ui(13, .medium))
                                    .foregroundStyle(palette.text)
                                    .padding(.horizontal, 14)
                                    .frame(height: 38)
                                    .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .frame(height: 38)
                    .glassEffect(.regular, in: .capsule)
                }
                if !following {
                    Button("Jump to latest", systemImage: "chevron.down", action: toEnd)
                        .labelStyle(.iconOnly)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(palette.text)
                        .frame(width: 38, height: 38)
                        .glassEffect(.regular.interactive(), in: .circle)
                        .transition(.scale(scale: 0.6).combined(with: .opacity))
                }
            }
        }
        .animation(.easeOut(duration: 0.24), value: following)
        .animation(.easeOut(duration: 0.2), value: running)
        .animation(.easeOut(duration: 0.2), value: queued)
    }

    private func label(at now: Date) -> String {
        if store.isCompacting(chat.id) { return "Compacting…" }
        if let waiting = store.runs[chat.id]?.waitingLabel { return waiting }
        let started = chat.turns.last { $0.role == .user }?.startedAt ?? chat.turns.last?.startedAt
        guard let started else { return "Working" }
        return "Working \(ChatText.duration(max(0, Int(now.timeIntervalSince1970 * 1000) - started)))"
    }
}

/** The chat's queued messages: each in full, with Send now, and Edit and Remove behind a swipe or a long press. */
struct QueueSheet: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(ChatStore.self) private var store
    let chat: Chat

    var body: some View {
        let queued = store.queued(in: chat.id)
        let canSendNow = store.runs[chat.id] != nil && !store.isCompacting(chat.id) && AgentKind(rawValue: chat.provider)?.steers == true
        NavigationStack {
            List {
                ForEach(queued) { message in
                    HStack(alignment: .center, spacing: 10) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text((message.skill.map { "/\($0.name) " } ?? "") + message.question)
                                .font(.ui(14))
                                .foregroundStyle(store.editingQueued?.id == message.id ? palette.muted : palette.text)
                                .lineLimit(4)
                            if store.editingQueued?.id == message.id {
                                Text("Editing in the composer").font(.ui(12)).foregroundStyle(palette.muted)
                            } else if !message.attachments.isEmpty {
                                Label(message.attachments.map(\.name).joined(separator: ", "), systemImage: "paperclip")
                                    .font(.ui(12)).foregroundStyle(palette.muted).lineLimit(1)
                            }
                        }
                        Spacer(minLength: 0)
                        if canSendNow, message.attachments.isEmpty {
                            Button { store.sendNow(message.id) } label: {
                                Label("Send now", systemImage: "arrow.up")
                                    .font(.ui(13, .semibold))
                                    .foregroundStyle(palette.actionText)
                                    .padding(.horizontal, 12)
                                    .frame(height: 32)
                                    .background(palette.action, in: .capsule)
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint("Send into the current turn")
                        }
                    }
                    .frame(minHeight: 44)
                    .listRowBackground(Color.clear)
                    .swipeActions {
                        Button("Remove", systemImage: "trash", role: .destructive) { store.removeQueued(message.id) }
                        Button("Edit", systemImage: "pencil") {
                            store.editQueued(message.id)
                            dismiss()
                        }
                    }
                    .contextMenu {
                        if canSendNow, message.attachments.isEmpty { Button("Send now", systemImage: "arrow.up") { store.sendNow(message.id) } }
                        Button("Edit in the composer", systemImage: "pencil") {
                            store.editQueued(message.id)
                            dismiss()
                        }
                        Button("Remove from queue", systemImage: "trash", role: .destructive) { store.removeQueued(message.id) }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .navigationTitle("Queued")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close", systemImage: "xmark") { dismiss() } }
            }
            .onChange(of: queued.isEmpty) { _, empty in if empty { dismiss() } }
        }
        .presentationDetents([.fraction(0.65), .large])
        .presentationDragIndicator(.visible)
    }
}
