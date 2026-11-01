import SwiftUI

/**
 * The app's navigation, Linear's: a glass bar with the mailbox shown (its
 * picture, the one switcher), the places used most (Inbox, Drafts, Search),
 * a ⌃⌄ that opens every other place, and the agent on its own button beside it.
 */
struct PlacesBar: View {
    @Environment(MailStore.self) private var store
    @Environment(\.palette) private var palette

    let place: Place
    /** The ⌃⌄ panel is open. */
    let menuOpen: Bool
    let showsAgent: Bool
    let onSelect: (Folder) -> Void
    let onMailbox: (Mailbox) -> Void
    let onSearch: () -> Void
    let onMenu: () -> Void
    let onAgent: () -> Void

    static let pinned: [Folder] = [.inbox, .drafts]

    var body: some View {
        let mailbox = store.mailbox(place.scope)
        HStack(spacing: 12) {
            HStack(spacing: 0) {
                Menu {
                    MailboxChoices(current: place.scope, onPick: onMailbox)
                } label: {
                    MailboxAvatar(mailbox: mailbox, size: 30)
                        .frame(width: 52, height: 48)
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Mailbox, \(mailbox?.displayName ?? "")")
                .accessibilityHint("Switches mailbox")
                ForEach(Self.pinned, id: \.self) { folder in
                    Button { onSelect(folder) } label: {
                        tabLabel(folder.symbol(in: mailbox), selected: !menuOpen && place.folder == folder,
                                 dot: folder == .inbox && store.badge(in: .inbox, scope: place.scope) > 0)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(folder.title(in: mailbox))
                }
                Button(action: onSearch) { tabLabel("magnifyingglass", selected: false) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Search")
                // Lit for any place the bar doesn't pin.
                Button(action: onMenu) {
                    tabLabel("chevron.up.chevron.down", selected: menuOpen || !Self.pinned.contains(place.folder))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("All places")
            }
            .padding(4)
            .glassEffect(.regular.interactive(), in: .capsule)

            Spacer(minLength: 0)

            if showsAgent {
                Button(action: onAgent) {
                    Image("OtterAgent")
                        .resizable().scaledToFit()
                        .frame(width: 24, height: 24)
                        .foregroundStyle(palette.text)
                        .frame(width: 56, height: 56)
                        .contentShape(.circle)
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel("Agent")
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 4)
    }

    private func tabLabel(_ symbol: String, selected: Bool, dot: Bool = false) -> some View {
        Image(systemName: symbol)
                .font(.system(size: 19, weight: .medium))
                .symbolVariant(selected ? .fill : .none)
                .foregroundStyle(palette.text)
                .overlay(alignment: .topTrailing) {
                    if dot {
                        Circle().fill(palette.focus).frame(width: 9, height: 9).offset(x: 6, y: -4)
                    }
                }
                .frame(width: 56, height: 48)
                .background(selected ? palette.text.opacity(0.1) : .clear, in: .capsule)
                .contentShape(.capsule)
                .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/**
 * Every place, from the bar's ⌃⌄ (Linear's menu): the mailbox switcher on top,
 * then its folders and labels, then Search and Settings.
 */
struct PlacesPanel: View {
    @Environment(MailStore.self) private var store
    @Environment(\.palette) private var palette

    let place: Place
    let onSelect: (Place) -> Void
    let onSearch: () -> Void
    let onSettings: () -> Void

    var body: some View {
        let mailbox = store.mailbox(place.scope)
        VStack(alignment: .leading, spacing: 0) {
            header(mailbox)
                .padding(.horizontal, 16)
                .frame(height: 56)
            Divider().overlay(palette.border).padding(.horizontal, 12)
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    if let mailbox, mailbox.signedOut {
                        HStack(spacing: 10) {
                            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(palette.warning)
                            Text(signedOutTitle(mailbox)).font(.inter(.subheadline)).lineLimit(1)
                            Spacer(minLength: 8)
                            SignInAgainButton(mailbox: mailbox)
                        }
                        .foregroundStyle(palette.text)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 48)
                    }
                    ForEach(mailbox?.folders ?? [], id: \.self) { folder in
                        row(folder.title(in: mailbox), symbol: folder.symbol(in: mailbox),
                            count: store.badge(in: folder, scope: place.scope), selected: place.folder == folder) {
                            onSelect(Place(scope: place.scope, folder: folder))
                        }
                    }
                    labels(mailbox)
                    row("Search", symbol: "magnifyingglass", action: onSearch)
                    row("Settings", symbol: "gearshape", action: onSettings)
                    SyncStatusLine(scope: place.scope)
                        .padding(.horizontal, 12)
                        .padding(.top, 8)
                }
                .padding(8)
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
        }
        .frame(maxWidth: 340)
        .glassEffect(.regular, in: .rect(cornerRadius: 32))
    }

    /** The mailbox shown (the bar's picture switches it). */
    private func header(_ mailbox: Mailbox?) -> some View {
        HStack(spacing: 10) {
            MailboxAvatar(mailbox: mailbox, size: 24)
            Text(mailbox?.displayName ?? "Mailbox")
                .font(.inter(.headline))
                .foregroundStyle(palette.text)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func labels(_ mailbox: Mailbox?) -> some View {
        let labels = mailbox?.labels ?? []
        if !labels.isEmpty {
            Text(mailbox?.provider == .gmail ? "Labels" : "Folders")
                .font(.inter(.footnote))
                .foregroundStyle(palette.muted)
                .padding(.horizontal, 12)
                .padding(.top, 12)
                .padding(.bottom, 4)
            ForEach(labels) { label in
                let folder = Folder.label(id: label.id, name: label.name)
                row(folder.title, symbol: folder.symbol, color: label.color,
                    count: store.badge(in: folder, scope: place.scope), selected: place.folder == folder,
                    indent: label.depth) {
                    onSelect(Place(scope: place.scope, folder: folder))
                }
            }
            Divider().overlay(palette.border).padding(.vertical, 6).padding(.horizontal, 4)
        }
    }

    private func row(_ title: String, symbol: String, color: String? = nil, count: Int = 0,
                     selected: Bool = false, indent: Int = 0, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: symbol)
                    .font(.system(size: 17))
                    .foregroundStyle(color.map(Color.init(hex:)) ?? palette.text)
                    .frame(width: 24)
                Text(title)
                    .font(.inter(.body))
                    .foregroundStyle(palette.text)
                    .lineLimit(1)
                Spacer(minLength: 8)
                if count > 0 {
                    Text("\(count)")
                        .font(.inter(.footnote).weight(.medium))
                        .foregroundStyle(palette.muted)
                        .monospacedDigit()
                }
            }
            .padding(.leading, 12 + CGFloat(indent) * 20)
            .padding(.trailing, 12)
            .frame(height: 48)
            .background(selected ? palette.text.opacity(0.1) : .clear, in: .rect(cornerRadius: 16))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

/** Every mailbox to switch to, with its unread count (the bar's picture). */
struct MailboxChoices: View {
    @Environment(MailStore.self) private var store
    let current: String
    let onPick: (Mailbox) -> Void

    var body: some View {
        ForEach(store.shownMailboxes) { mailbox in
            let unread = store.badge(in: .inbox, scope: mailbox.email)
            Button { onPick(mailbox) } label: {
                if mailbox.email == current {
                    Label(mailbox.displayName, systemImage: "checkmark")
                } else {
                    Text(mailbox.displayName)
                }
                if unread > 0 { Text("\(unread) unread") }
            }
        }
    }
}

/** A mailbox's picture (the Google account's), or its mark until there is one. */
struct MailboxAvatar: View {
    let mailbox: Mailbox?
    var size: CGFloat = 30

    var body: some View {
        if let mailbox, let url = mailbox.picture.flatMap(URL.init(string:)) {
            AsyncImage(url: url) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                MailboxMark(mailbox: mailbox, size: size)
            }
            .frame(width: size, height: size)
            .clipShape(.circle)
        } else if let mailbox {
            MailboxMark(mailbox: mailbox, size: size)
        }
    }
}
