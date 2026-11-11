import SwiftUI

struct PlacesBar: View {
    @Environment(MailStore.self) private var store
    @Environment(\.palette) private var palette
    @Namespace private var glass

    let place: Place
    let menuOpen: Bool
    let onSelect: (Folder) -> Void
    let onPlace: (Place) -> Void
    let onMailbox: (Mailbox) -> Void
    let onSearch: () -> Void
    let onSettings: () -> Void
    let onMenu: () -> Void

    static let pinned: [Folder] = [.inbox, .drafts]

    var body: some View {
        // One glass: the bar grows into the menu and shrinks back (Linear's).
        GlassEffectContainer(spacing: 0) {
            HStack(alignment: .bottom, spacing: 12) {
                ZStack(alignment: .bottomLeading) {
                    if menuOpen {
                        PlacesPanel(place: place, onSelect: onPlace, onSearch: onSearch, onSettings: onSettings)
                            .frame(maxHeight: 560)
                            .fixedSize(horizontal: false, vertical: true)
                            .glassEffect(.regular, in: .rect(cornerRadius: 32))
                            .glassEffectID("places", in: glass)
                    } else {
                        tabs
                            .glassEffect(.regular.interactive(), in: .capsule)
                            .glassEffectID("places", in: glass)
                    }
                }
                // The bar's height either way, so the open menu rises over the list without moving it.
                .frame(height: 56, alignment: .bottomLeading)

                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 4)
    }

    private var tabs: some View {
        let mailbox = store.mailbox(for: place.scope)
        return HStack(spacing: 0) {
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
                    tabLabel(folder.symbol(in: mailbox), selected: place.folder == folder,
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
                tabLabel("chevron.up.chevron.down", selected: !Self.pinned.contains(place.folder))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("All places")
        }
        .padding(4)
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

struct PlacesPanel: View {
    @Environment(MailStore.self) private var store
    @Environment(\.palette) private var palette

    let place: Place
    let onSelect: (Place) -> Void
    let onSearch: () -> Void
    let onSettings: () -> Void

    var body: some View {
        let mailbox = store.mailbox(for: place.scope)
        VStack(alignment: .leading, spacing: 0) {
            header(mailbox)
                .padding(.horizontal, 16)
                .frame(height: 56)
            Divider().overlay(palette.border).padding(.horizontal, 12)
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    if let mailbox = mailbox.flatMap({ store.mailbox($0.source) }), mailbox.signedOut {
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
                    SyncStatusLine(scope: mailbox?.source ?? place.scope)
                        .padding(.horizontal, 12)
                        .padding(.top, 8)
                }
                .padding(8)
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
        }
        .frame(maxWidth: 340)
    }

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

struct MailboxChoices: View {
    @Environment(MailStore.self) private var store
    let current: String
    let onPick: (Mailbox) -> Void

    var body: some View {
        ForEach(store.shownScopes) { mailbox in
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

struct MailboxAvatar: View {
    let mailbox: Mailbox?
    var size: CGFloat = 30

    var body: some View {
        if let mailbox, let picture = mailbox.customImage {
            Image(uiImage: picture)
                .resizable().scaledToFill()
                .frame(width: size, height: size)
                .clipShape(.circle)
        } else if let mailbox, let url = mailbox.picture.flatMap(URL.init(string:)) {
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
