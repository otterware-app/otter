import SwiftUI

/** Search before anything's typed: filters a tap away, and the people who write most. */
struct SearchStart: View {
    @Environment(MailStore.self) private var store
    @Environment(\.palette) private var palette
    let scope: String
    let onQuery: (String) -> Void

    private var people: [Person] {
        let mine = Set(store.shownScopes.map { $0.email.lowercased() })
        let senders = store.threads(in: .inbox, scope: scope).prefix(200)
            .flatMap(\.messages).map(\.from).filter { !mine.contains($0.email.lowercased()) }
        let counts = Dictionary(grouping: senders) { $0.email.lowercased() }
        return counts.values.sorted { ($0.count, $1[0].label) > ($1.count, $0[0].label) }.prefix(6).map { $0[0] }
    }

    var body: some View {
        let mailbox = store.mailbox(for: scope)
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 10) {
                heading("Filters")
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        chip("Unread", "envelope.badge", "is:unread")
                        chip(Folder.starred.title(in: mailbox), Folder.starred.symbol(in: mailbox), "is:starred")
                        chip("Attachments", "paperclip", "has:attachment")
                    }
                    .padding(.horizontal, 20)
                }
                .scrollIndicators(.hidden)
            }
            let people = people
            if !people.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    heading("People")
                    ForEach(people, id: \.email) { person in
                        Button { onQuery("from:\(person.email)") } label: {
                            HStack(spacing: 12) {
                                SenderAvatar(person: person, size: 32)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(person.label).font(.inter(.subheadline)).foregroundStyle(palette.text)
                                    Text(person.email).font(.inter(.caption)).foregroundStyle(palette.muted)
                                }
                                .lineLimit(1)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 20)
                            .frame(height: 50)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Mail from \(person.label)")
                    }
                }
            }
        }
        .padding(.top, 12)
    }

    private func heading(_ text: String) -> some View {
        Text(text).font(.inter(.footnote).weight(.medium)).foregroundStyle(palette.muted).padding(.horizontal, 20)
    }

    private func chip(_ title: String, _ symbol: String, _ query: String) -> some View {
        Button { onQuery(query) } label: {
            Label(title, systemImage: symbol)
                .font(.inter(.subheadline))
                .foregroundStyle(palette.text)
                .padding(.horizontal, 14)
                .frame(height: 36)
                .background(palette.text.opacity(0.06), in: .capsule)
        }
        .buttonStyle(.plain)
    }
}
