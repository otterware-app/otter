import SwiftUI

/**
 * Claude's bottom, for mail: a pill where Claude has its composer, with the mailbox's picture (tap
 * to switch mailbox), Search, and Compose (hold it for your drafts); and under it the tabs, a slim
 * row of icons: Inbox, Starred, every other place, and Settings. Slide across the tabs to
 * switch, or touch and hold one for what's newest there. They tuck away while you scroll down.
 */
struct PlacesBar: View {
    @Environment(MailStore.self) private var store
    @Environment(\.palette) private var palette
    @Namespace private var pill
    /** The tab under a finger sliding across the row, and the one it started on. */
    @State private var hovered: Int?
    @State private var slideStart: Int?
    @State private var width: CGFloat = 0

    let place: Place
    let reading: Bool
    let onSelect: (Folder) -> Void
    let onSearch: () -> Void
    let onSettings: () -> Void
    let onMenu: () -> Void
    let onCompose: () -> Void
    let onRecents: (Folder) -> Void
    let onMailboxes: () -> Void

    static let tabsHeight: CGFloat = 40

    private var pinned: [Folder] {
        let folders = store.mailbox(for: place.scope)?.folders ?? []
        return [Folder.inbox, .starred].filter { folders.isEmpty || folders.contains($0) }
    }

    var body: some View {
        VStack(spacing: 4) {
            dock.padding(.horizontal, 16).zIndex(1)
            if !reading {
                tabs.padding(.horizontal, 32).transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .padding(.bottom, reading ? 8 : 0)
        // From the pill's middle down.
        .background { BarBacking(edge: .bottom).padding(.top, 14) }
        .padding(.top, 8)
    }

    private var dock: some View {
        let mailbox = store.mailbox(for: place.scope)
        return HStack(spacing: 4) {
            Button(action: onMailboxes) {
                MailboxAvatar(mailbox: mailbox, size: 28)
                    .frame(width: 38, height: 38)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Mailbox, \(mailbox?.displayName ?? "")")
            .accessibilityHint("Switches mailbox")
            Button(action: onSearch) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.system(size: 15, weight: .medium))
                    Text("Search \(mailbox?.displayName ?? "mail")").font(.inter(.body)).lineLimit(1)
                    Spacer(minLength: 0)
                }
                .foregroundStyle(palette.muted)
                .padding(.leading, 6)
                .frame(maxWidth: .infinity, minHeight: 38)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Search")
            Image(systemName: "square.and.pencil")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(palette.canvas)
                .frame(width: 38, height: 38)
                .background(palette.text, in: .circle)
                .contentShape(.circle)
                .onTapGesture(perform: onCompose)
                .onLongPressGesture(minimumDuration: 0.4) {
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    onRecents(.drafts)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Compose")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { onCompose() }
                .accessibilityAction(named: "Drafts") { onRecents(.drafts) }
        }
        .padding(5)
        .glassEffect(.regular.interactive(), in: .capsule)
    }

    private var tabs: some View {
        let mailbox = store.mailbox(for: place.scope)
        let pinned = pinned
        return HStack(spacing: 0) {
            ForEach(Array(pinned.enumerated()), id: \.element) { index, folder in
                tabLabel(folder.symbol(in: mailbox), selected: lit(index, place.folder == folder),
                         dot: folder == .inbox && store.badge(in: .inbox, scope: place.scope) > 0)
                    .onTapGesture { onSelect(folder) }
                    .onLongPressGesture(minimumDuration: 0.4) {
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        onRecents(folder)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(folder.title(in: mailbox))
                    .accessibilityAddTraits(.isButton)
                    .accessibilityAction { onSelect(folder) }
                    .accessibilityAction(named: "Recent") { onRecents(folder) }
            }
            // Lit for any place the row doesn't pin.
            tabLabel("folder", selected: lit(pinned.count, !pinned.contains(place.folder)))
                .onTapGesture(perform: onMenu)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("All places")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { onMenu() }
            // At the right end, as in Otter Agents.
            tabLabel("gearshape", selected: lit(pinned.count + 1, false))
                .onTapGesture(perform: onSettings)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Settings")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { onSettings() }
        }
        .frame(height: Self.tabsHeight)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .simultaneousGesture(slide)
        .animation(.spring(duration: 0.25, bounce: 0.2), value: hovered)
        .animation(.spring(duration: 0.25, bounce: 0.2), value: place)
    }

    /** While sliding, the tab under the finger is lit instead of the place's. */
    private func lit(_ index: Int, _ selected: Bool) -> Bool { hovered.map { $0 == index } ?? selected }

    /** The tab at a point across the row: the pinned places, every other place, then Settings. */
    private func tab(at x: CGFloat) -> Int {
        let count = pinned.count + 2
        return width > 0 ? max(0, min(count - 1, Int(x / (width / CGFloat(count))))) : 0
    }

    private var slide: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { drag in
                if slideStart == nil { slideStart = tab(at: drag.startLocation.x) }
                let over = tab(at: drag.location.x)
                if over != hovered {
                    hovered = over
                    UISelectionFeedbackGenerator().selectionChanged()
                }
            }
            .onEnded { _ in
                // Let go on the tab it started from, that tab's own tap acts.
                if let over = hovered, over != slideStart {
                    if over < pinned.count { onSelect(pinned[over]) } else if over == pinned.count { onMenu() } else { onSettings() }
                }
                hovered = nil
                slideStart = nil
            }
    }

    private func tabLabel(_ symbol: String, selected: Bool, dot: Bool = false) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 18, weight: .medium))
            .symbolVariant(.fill)
            .foregroundStyle(selected ? palette.text : palette.muted)
            .overlay(alignment: .topTrailing) {
                if dot {
                    Circle().fill(palette.focus).frame(width: 8, height: 8).offset(x: 5, y: -3)
                }
            }
            .frame(width: 58, height: 34)
            .background {
                if selected { Capsule().fill(palette.text.opacity(0.07)).matchedGeometryEffect(id: "pill", in: pill) }
            }
            .frame(maxWidth: .infinity)
            .contentShape(.rect)
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

/** The mailboxes to switch between, each with its picture and what's unread in its inbox; Settings' list at the bottom. */
struct MailboxesCard: View {
    @Environment(MailStore.self) private var store
    @Environment(\.palette) private var palette
    let current: String
    let onPick: (Mailbox) -> Void
    let onManage: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(store.shownScopes) { mailbox in
                let unread = store.badge(in: .inbox, scope: mailbox.email)
                let chosen = mailbox.email == current
                Button { onPick(mailbox) } label: {
                    HStack(spacing: 10) {
                        MailboxAvatar(mailbox: mailbox, size: 26)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(mailbox.displayName).font(.inter(.subheadline).weight(chosen ? .semibold : .regular))
                            Text(mailbox.email).font(.inter(.caption)).foregroundStyle(palette.muted)
                        }
                        .lineLimit(1)
                        Spacer(minLength: 6)
                        if unread > 0 {
                            Text("\(unread)").font(.inter(.footnote).weight(.medium)).monospacedDigit().foregroundStyle(palette.muted)
                        }
                    }
                    .foregroundStyle(palette.text)
                    .padding(.horizontal, 10)
                    .frame(height: 48)
                    .background(chosen ? palette.text.opacity(0.07) : .clear, in: .rect(cornerRadius: 17))
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(mailbox.displayName), \(mailbox.email)")
                .accessibilityAddTraits(chosen ? [.isButton, .isSelected] : .isButton)
                .accessibilityValue(unread > 0 ? "\(unread) unread" : "")
            }
            Divider().overlay(palette.border).padding(.horizontal, 10).padding(.vertical, 4)
            Button(action: onManage) {
                HStack(spacing: 10) {
                    Image(systemName: "gearshape").font(.system(size: 15)).frame(width: 26)
                    Text("Mailboxes").font(.inter(.subheadline))
                    Spacer(minLength: 0)
                }
                .foregroundStyle(palette.text)
                .padding(.horizontal, 10)
                .frame(height: 38)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
        }
        .padding(5)
        .frame(width: 280)
        .glassEffect(.regular, in: .rect(cornerRadius: 24))
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

/** Claude's recents: what's newest in Inbox or Drafts, and a new message, over the bar. */
struct RecentsCard: View {
    @Environment(MailStore.self) private var store
    @Environment(\.palette) private var palette

    let folder: Folder
    let scope: String
    let onThread: (MailThread) -> Void
    let onCompose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(store.threads(in: folder, scope: scope).prefix(5))) { thread in
                row(thread.subject.isEmpty ? "(No subject)" : thread.subject, unread: thread.unread) {
                    Image(systemName: folder == .drafts ? "doc" : "envelope").font(.system(size: 13))
                } action: { onThread(thread) }
            }
            row("New message") {
                Image(systemName: "square.and.pencil").font(.system(size: 14))
            } action: { onCompose() }
        }
        .padding(5)
        .frame(width: 250)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
    }

    private func row(_ title: String, unread: Bool = false, @ViewBuilder icon: () -> some View, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                icon().foregroundStyle(palette.text).frame(width: 18)
                Text(title).font(.inter(.subheadline)).foregroundStyle(palette.text).lineLimit(1)
                Spacer(minLength: 6)
                if unread { Circle().fill(palette.focus).frame(width: 7, height: 7) }
            }
            .padding(.horizontal, 10)
            .frame(height: 36)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}
