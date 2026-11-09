import SwiftUI

struct ThreadView: View {
    @Environment(MailStore.self) private var store
    @Environment(Preferences.self) private var preferences
    @Environment(Session.self) private var session
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openTaskTarget) private var openTarget

    let threadID: String
    let place: Place
    @Binding var path: [String]
    @Binding var draft: Draft?

    @State private var siblings: [String] = []
    @State private var expanded: Set<String> = []
    @State private var asking: [MailContext]?
    @State private var newTask: MailTask?
    @State private var linking = false
    @State private var unsubscribed = false
    @State private var unsubscribing = false
    @State private var notice: Notice?

    private struct Notice: Equatable {
        let id = UUID()
        let text: String
    }

    var body: some View {
        if let thread = store.thread(threadID), let mailbox = store.mailbox(thread.mailbox) {
            content(thread, mailbox)
        } else {
            ContentUnavailableView("Deleted", systemImage: "trash")
        }
    }

    private func content(_ thread: MailThread, _ mailbox: Mailbox) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                Text(thread.subject)
                    .font(.inter(.title2).weight(.semibold))
                    .foregroundStyle(palette.text)
                    .textSelection(.enabled)
                    .padding(.bottom, 8)
                    .padding(.horizontal, MessageView.inset)

                labels(thread, mailbox)
                    .padding(.bottom, 20)
                    .padding(.horizontal, MessageView.inset)

                LinkedTasks(source: .thread(thread, mailbox: shown(mailbox).email))
                    .padding(.bottom, 16)
                    .padding(.horizontal, MessageView.inset)

                let messages = thread.distinctMessages(preferring: store.alias(place.scope)?.email)
                let code = thread.verificationCode
                ForEach(messages) { message in
                    // Above the message it came from, where the Mac and web put it.
                    if let code, message.id == thread.sent.last?.id {
                        CodeCard(code: code, onTrash: thread.labels.contains("TRASH") ? nil : {
                            store.trash(thread.id)
                            leave(thread)
                        })
                            .padding(.bottom, 16)
                            .padding(.horizontal, MessageView.inset)
                    }
                    let open = message.id == messages.last?.id || message.unread || expanded.contains(message.id)
                    MessageView(message: message, mailbox: mailbox, open: open) {
                        if message.draft {
                            draft = .resume(message, in: thread)
                        } else if !open {
                            withAnimation(reduceMotion ? nil : .snappy(duration: 0.2)) { _ = expanded.insert(message.id) }
                        }
                    }
                    if message.id != messages.last?.id {
                        Spacer().frame(height: 20)
                    }
                }
            }
            .padding(.top, 8)
        }
        .minimizingNavigationBar()
        .scrollContentBackground(.hidden)
        .background(palette.canvas)
        .contentMargins(.bottom, 24, for: .scrollContent)
        .toolbar {
            if session.agent.isSetUp {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { asking = [MailContext(thread)] } label: { Label("Give to agent", image: "OtterAgent") }
                }
                ToolbarSpacer(.fixed, placement: .topBarTrailing)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(thread.starred ? "Un\(mailbox.mark)" : mailbox.mark.capitalized, systemImage: thread.starred ? "\(mailbox.mark).fill" : mailbox.mark) {
                    store.toggleStar(thread.id)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu("More", systemImage: "ellipsis") {
                    Button("Reply all", systemImage: "arrowshape.turn.up.left.2") {
                        draft = store.reply(to: thread, in: place.scope, all: true)
                    }
                    Button("Forward", systemImage: "arrowshape.turn.up.right") {
                        draft = store.forward(thread, in: place.scope)
                    }
                    Button("Add task", systemImage: "checklist") {
                        newTask = MailTask(from: thread, mailbox: shown(mailbox).email)
                    }
                    if !session.tasks.tasks.isEmpty {
                        Button("Link to a task", systemImage: "link") { linking = true }
                    }
                    if !unsubscribed, let unsubscribe = Unsubscribe(thread.sent.last?.headers ?? [:]) {
                        Button(unsubscribing ? "Unsubscribing…" : "Unsubscribe", systemImage: "hand.raised") {
                            guard !unsubscribing else { return }
                            let sender = (thread.sent.last ?? thread.latest).from.label
                            unsubscribing = true
                            Task {
                                let outcome = await unsubscribe.run(from: shown(mailbox), store: store)
                                unsubscribing = false
                                if outcome == .done { unsubscribed = true }
                                outcome.haptic()
                                notice = Notice(text: outcome.notice(from: sender))
                            }
                        }
                        .disabled(unsubscribing)
                    }
                    Divider()
                    ThreadActions(thread: thread, onGone: { leave(thread) })
                }
            }
        }
        .safeAreaBar(edge: .bottom) {
            VStack(spacing: 8) {
                if let notice { NoticeBanner(text: notice.text) }
                replyBar(thread, mailbox)
            }
            .animation(.snappy(duration: 0.2), value: notice)
        }
        .task(id: notice) {
            guard notice != nil else { return }
            try? await Task.sleep(for: .seconds(4))
            notice = nil
        }
        .toolbarVisibility(.hidden, for: .tabBar)
        .sheet(item: $newTask) { task in
            NavigationStack {
                TaskEditor(task: task, onEmail: { email in
                    newTask = nil
                    if !TaskSource.thread(thread, mailbox: shown(mailbox).email).isHere(email) { openTarget(.email(email)) }
                })
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close", systemImage: "xmark") { newTask = nil }
                    }
                }
            }
        }
        .sheet(isPresented: $linking) { LinkToTaskSheet(source: .thread(thread, mailbox: shown(mailbox).email)) }
        .sheet(isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } })) {
            NavigationStack {
                AgentView(context: asking ?? [], sheet: true)
            }
            .onAppear { session.agent.newChat() }
        }
        .toolbarTitleDisplayMode(.inline)
        .onAppear {
            if siblings.isEmpty { siblings = store.threads(in: place.folder, scope: place.scope).map(\.id) }
            if thread.unread { store.setRead(true, thread.id) }
        }
    }

    private func shown(_ mailbox: Mailbox) -> Mailbox {
        store.alias(place.scope).flatMap { $0.source == mailbox.email ? $0 : nil } ?? mailbox
    }

    @ViewBuilder
    private func labels(_ thread: MailThread, _ mailbox: Mailbox) -> some View {
        let userLabels = mailbox.labels.filter { thread.labels.contains($0.id) }
        HStack(spacing: 6) {
            Circle().fill(Color(hex: shown(mailbox).color)).frame(width: 7, height: 7)
            Text(shown(mailbox).displayName)
                .font(.inter(.footnote))
                .foregroundStyle(palette.muted)
                .padding(.trailing, 2)
            ForEach(userLabels) { label in
                Text(label.leaf)
                    .font(.inter(.caption2).weight(.medium))
                    .foregroundStyle(palette.text)
                    .padding(.horizontal, 7)
                    .frame(height: 20)
                    .background((label.color.map(Color.init(hex:)) ?? palette.muted).opacity(0.18), in: .capsule)
            }
        }
    }

    private func replyBar(_ thread: MailThread, _ mailbox: Mailbox) -> some View {
        let archives = store.canArchive(thread)
        let unarchives = !archives && thread.labels.contains("ARCHIVE")
        return HStack(spacing: 10) {
            Button(archives ? "Archive" : unarchives ? "Move to Inbox" : "Trash",
                   systemImage: archives ? "archivebox" : unarchives ? "tray.and.arrow.down" : "trash") {
                if archives { store.archive(thread.id) } else if unarchives { store.moveToInbox(thread.id) } else { store.trash(thread.id) }
                leave(thread)
            }
            .labelStyle(.iconOnly)
            .font(.system(size: 19))
            .foregroundStyle(palette.text)
            .frame(width: 44, height: 44)
            .glassEffect(.regular.interactive(), in: .circle)

            if archives || unarchives {
                Button("Trash", systemImage: "trash") {
                    store.trash(thread.id)
                    leave(thread)
                }
                .labelStyle(.iconOnly)
                .font(.system(size: 19))
                .foregroundStyle(palette.text)
                .frame(width: 44, height: 44)
                .glassEffect(.regular.interactive(), in: .circle)
            }

            Spacer()

            Button("Reply to \(replyName(thread, mailbox))", systemImage: "arrowshape.turn.up.left") {
                draft = store.reply(to: thread, in: place.scope, all: false)
            }
            .labelStyle(.iconOnly)
            .font(.system(size: 19))
            .foregroundStyle(palette.text)
            .frame(width: 44, height: 44)
            .glassEffect(.regular.interactive(), in: .circle)
            .contextMenu {
                Button("Reply", systemImage: "arrowshape.turn.up.left") {
                    draft = store.reply(to: thread, in: place.scope, all: false)
                }
                Button("Reply all", systemImage: "arrowshape.turn.up.left.2") {
                    draft = store.reply(to: thread, in: place.scope, all: true)
                }
                Button("Forward", systemImage: "arrowshape.turn.up.right") {
                    draft = store.forward(thread, in: place.scope)
                }
            }
            .accessibilityHint("Touch and hold for Reply all or Forward")
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
    }

    private func replyName(_ thread: MailThread, _ mailbox: Mailbox) -> String {
        let last = thread.sent.last ?? thread.latest
        let person = store.isMine(last.from, in: mailbox.email) ? last.to.first ?? last.from : last.from
        return person.label.split(separator: " ").first.map(String.init) ?? person.label
    }

    private func leave(_ thread: MailThread) {
        let remaining = Set(store.threads(in: place.folder, scope: place.scope).map(\.id))
        let index = siblings.firstIndex(of: thread.id) ?? 0
        let after = siblings[(index + 1)...].first(where: remaining.contains)
        let before = siblings[..<index].last(where: remaining.contains)
        let next: String? = switch preferences.advance {
        case .next: after ?? before
        case .previous: before ?? after
        case .none: nil
        }
        if let next {
            path = [next]
        } else {
            path = []
        }
    }
}
