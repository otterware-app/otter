import SwiftUI

extension MailContext {
    /** A conversation, or one message of it. */
    init(_ thread: MailThread, message: Message? = nil) {
        let message = message ?? thread.latest
        self.init(kind: message.draft ? "draft" : "mail", account: thread.mailbox, threadID: thread.id,
                  subject: thread.subject.isEmpty ? "(no subject)" : thread.subject, from: message.from.email, messageIDs: [message.id])
    }

    /** A draft the mailbox has: what's written since it was saved isn't the agent's to read yet. */
    init?(_ draft: Draft) {
        guard let messageID = draft.messageID else { return nil }
        self.init(kind: "draft", account: draft.from, threadID: draft.threadID ?? "",
                  subject: draft.subject.isEmpty ? "(no subject)" : draft.subject, from: draft.address ?? draft.from, messageIDs: [messageID])
    }

    /** The words selected in a message: the one thing that goes as text, since it's what the chat is about. */
    func quoting(_ text: String) -> MailContext? {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        var quoted = self
        quoted.quote = String(text.prefix(4000))
        return quoted
    }

    /** Otter Agents is on this iPhone (its scheme is in Info.plist's LSApplicationQueriesSchemes). */
    @MainActor static var agentsInstalled: Bool {
        URL(string: "\(scheme())://").map(UIApplication.shared.canOpenURL) ?? false
    }

    @MainActor static func send(_ mail: [MailContext]) {
        if let link = link(mail) { UIApplication.shared.open(link) }
    }
}

/** Opens a new chat about this mail in Otter Agents; absent when that app isn't installed. */
struct SendToAgent: View {
    let mail: [MailContext]
    var sent: () -> Void = {}

    var body: some View {
        if MailContext.agentsInstalled {
            Button {
                MailContext.send(mail)
                sent()
            } label: {
                Label(mail.first?.quote == nil ? "Send to agent" : "Send selection to agent", image: "OtterAgent")
            }
            .disabled(mail.isEmpty)
        }
    }
}
