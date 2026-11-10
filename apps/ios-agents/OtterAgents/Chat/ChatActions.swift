import SafariServices
import SwiftUI

/** What a chat's menu can ask for that needs a question first. */
enum ChatDialog: Identifiable {
    case rename(Chat)
    case delete(Chat)

    var id: String {
        switch self {
        case .rename(let chat): "rename-\(chat.id)"
        case .delete(let chat): "delete-\(chat.id)"
        }
    }
}

/** A chat's menu: the same on its row in the list and in the chat itself. */
struct ChatMenu: View {
    @Environment(ChatStore.self) private var store
    let chat: Chat
    @Binding var dialog: ChatDialog?
    var settled: (Chat) -> Void = { _ in }

    var body: some View {
        let now = Int.now
        let shelf = ChatShelf.of(chat, working: store.runs[chat.id] != nil, needsYou: store.needsYou.contains(chat.id), now: now)
        if chat.pinnedAt == nil {
            Button("Pin", systemImage: "pin") { Task { await store.pin(chat.id, true) } }
        } else {
            Button("Unpin", systemImage: "pin.slash") { Task { await store.pin(chat.id, false) } }
        }
        if shelf == .snoozed { Button("Wake up now", systemImage: "clock") { Task { await store.shelve(chat.id) } } }
        if shelf == .settled { Button("Unsettle", systemImage: "arrow.uturn.backward") { Task { await store.shelve(chat.id) } } }
        Menu(shelf == .snoozed ? "Snooze until" : "Snooze", systemImage: "clock") {
            ForEach(ChatShelf.snoozePresets()) { preset in
                Button { Task { await store.shelve(chat.id, snoozedUntil: preset.until) } } label: {
                    Text(preset.label)
                    Text(preset.when)
                }
            }
        }
        if shelf != .settled {
            Button("Settle", systemImage: "checkmark") {
                settled(chat)
                Task { await store.shelve(chat.id, settledAt: .now) }
            }
        }
        Divider()
        Button("Rename", systemImage: "pencil") { dialog = .rename(chat) }
        if let kind = AgentKind(rawValue: chat.provider), kind.titles, chat.sessionId != nil, store.agents.isUsable(kind) {
            Button("Regenerate title", systemImage: "sparkles") { Task { await store.regenerateTitle(chat.id) } }
        }
        if let session = chat.sessionId {
            Button("Copy session ID", systemImage: "doc.on.doc") {
                UIPasteboard.general.string = session
                store.notice = "Session ID copied"
            }
        }
        Divider()
        Button("Delete", systemImage: "trash", role: .destructive) { dialog = .delete(chat) }
    }
}

private struct ChatDialogs: ViewModifier {
    @Environment(ChatStore.self) private var store
    @Binding var dialog: ChatDialog?
    var deleted: (Chat) -> Void
    @State private var title = ""

    private var renaming: Chat? { if case .rename(let chat) = dialog { chat } else { nil } }
    private var deleting: Chat? { if case .delete(let chat) = dialog { chat } else { nil } }

    func body(content: Content) -> some View {
        content
            .alert("Rename chat", isPresented: .constant(renaming != nil), presenting: renaming) { chat in
                TextField("Title", text: $title)
                Button("Cancel", role: .cancel) { dialog = nil }
                Button("Rename") {
                    dialog = nil
                    Task { await store.rename(chat.id, to: title) }
                }
            }
            .onChange(of: renaming?.id) { title = renaming?.title ?? "" }
            .confirmationDialog("Delete chat?", isPresented: .constant(deleting != nil), titleVisibility: .visible, presenting: deleting) { chat in
                Button("Delete", role: .destructive) {
                    dialog = nil
                    deleted(chat)
                    store.delete(chat.id)
                }
                Button("Cancel", role: .cancel) { dialog = nil }
            } message: { chat in
                Text(chat.sessionOwned && chat.provider != "varys"
                    ? "“\(chat.title)” goes from every device, and its session from \(AgentKind.name(of: chat.provider))."
                    : "“\(chat.title)” goes from every device.")
            }
    }
}

extension View {
    func chatDialogs(_ dialog: Binding<ChatDialog?>, deleted: @escaping (Chat) -> Void = { _ in }) -> some View {
        modifier(ChatDialogs(dialog: dialog, deleted: deleted))
    }
}

/** A web page, opened in the app. */
struct WebPage: Identifiable {
    let url: URL
    var id: URL { url }
}

struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
