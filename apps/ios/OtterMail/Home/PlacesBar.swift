import SwiftUI

/** What the home screen shows above the bar: the modules, in the bar's order. */
enum HomeModule: Hashable {
    case mail, calendar, tasks
}

/**
 * The bar under every module's first page: Mail, Calendar (when a mailbox has
 * one) and Tasks, each labeled, and ⌃⌄ for what the one in front is scoped by
 * (the mail's mailboxes, folders and labels; the calendars to show; the task
 * lists). The agent has its own round button beside it.
 */
struct PlacesBar: View {
    @Environment(MailStore.self) private var store
    @Environment(Session.self) private var session
    @Environment(\.palette) private var palette
    @Namespace private var glass

    let place: Place
    let module: HomeModule
    let menuOpen: Bool
    let calendar: CalendarStore
    let calendarShown: CalendarShown
    let showsAgent: Bool
    let onPlace: (Place) -> Void
    let onMailbox: (Mailbox) -> Void
    let onModule: (HomeModule) -> Void
    let onMenu: () -> Void
    /** A choice in a panel that is the whole errand: the panel folds back into the bar. */
    let onDone: () -> Void
    let onAgent: () -> Void

    var body: some View {
        // One glass: the bar grows into the menu and shrinks back (Linear's).
        GlassEffectContainer(spacing: 0) {
            HStack(alignment: .bottom, spacing: 12) {
                ZStack(alignment: .bottomLeading) {
                    if menuOpen {
                        Group {
                            switch module {
                            case .mail:
                                PlacesPanel(place: place, module: module, onSelect: onPlace, onMailbox: onMailbox)
                            case .calendar:
                                CalendarScopePanel(events: calendar, visibility: calendarShown, onDone: onDone)
                            case .tasks:
                                TaskListsPanel(onDone: onDone)
                            }
                        }
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
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 4)
    }

    private var tabs: some View {
        let mailbox = store.mailbox(for: place.scope)
        return HStack(spacing: 0) {
            tab("Mail", symbol: Folder.inbox.symbol(in: mailbox), module: .mail,
                dot: store.badge(in: .inbox, scope: place.scope) > 0)
            if !CalendarStore.sources(store.shownMailboxes).isEmpty {
                tab("Calendar", symbol: "calendar", module: .calendar)
            }
            let open = session.tasks.tasks.count(where: { !$0.done })
            tab("Tasks", symbol: "checklist", module: .tasks, badge: open)
                .accessibilityValue(open > 0 ? "\(open) open" : "")
            // ⌃⌄ opens what the one in front is scoped by, in the same panel for each.
            Button(action: onMenu) {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 19, weight: .medium))
                    .foregroundStyle(palette.text)
                    .frame(width: 52, height: 48)
                    .background(scopeLit ? palette.text.opacity(0.1) : .clear, in: .capsule)
                    .contentShape(.capsule)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(scopeLabel)
            .accessibilityIdentifier("places-scope")
        }
        .padding(4)
    }

    /** Lit for a mail place other than the inbox, a calendar scoped to one mailbox, or a task list picked. */
    private var scopeLit: Bool {
        switch module {
        case .mail: place.folder != .inbox
        case .calendar: calendarShown.account != nil
        case .tasks: session.tasks.selected != nil
        }
    }

    private var scopeLabel: String {
        switch module {
        case .mail: "All places"
        case .calendar: "Calendars"
        case .tasks: "Task lists"
        }
    }

    private func tab(_ title: String, symbol: String, module: HomeModule, dot: Bool = false, badge: Int = 0) -> some View {
        let selected = self.module == module
        return Button { onModule(module) } label: {
            VStack(spacing: 2) {
                Image(systemName: symbol)
                    .font(.system(size: 17, weight: .medium))
                    .symbolVariant(selected ? .fill : .none)
                    .overlay(alignment: .topTrailing) {
                        if badge > 0 {
                            Text("\(min(badge, 99))")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 4)
                                .frame(minWidth: 16, minHeight: 16)
                                .background(.red, in: .capsule)
                                .offset(x: 10, y: -6)
                                .accessibilityHidden(true)
                        } else if dot {
                            Circle().fill(palette.focus).frame(width: 8, height: 8).offset(x: 5, y: -3)
                        }
                    }
                Text(title)
                    .font(.inter(.caption2).weight(selected ? .semibold : .medium))
                    .lineLimit(1)
            }
            .foregroundStyle(palette.text)
            .frame(width: 68, height: 48)
            .background(selected ? palette.text.opacity(0.1) : .clear, in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/** The mail's places: mailboxes, folders and labels. Search and Settings are in the toolbar (Search, ⋯). */
struct PlacesPanel: View {
    @Environment(MailStore.self) private var store
    @Environment(\.palette) private var palette

    let place: Place
    let module: HomeModule
    let onSelect: (Place) -> Void
    let onMailbox: (Mailbox) -> Void

    var body: some View {
        let mailbox = store.mailbox(for: place.scope)
        ScopePanel {
            header(mailbox)
        } rows: {
            mailboxes
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
                    count: store.badge(in: folder, scope: place.scope), selected: module == .mail && place.folder == folder) {
                    onSelect(Place(scope: place.scope, folder: folder))
                }
            }
            labels(mailbox)
            SyncStatusLine(scope: mailbox?.source ?? place.scope)
                .padding(.horizontal, 12)
                .padding(.top, 8)
        }
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

    /** Where switching mailboxes went from the bar: each one, its unread count, the current one lit. */
    @ViewBuilder
    private var mailboxes: some View {
        let scopes = store.shownScopes
        if scopes.count > 1 {
            ForEach(scopes) { mailbox in
                let current = mailbox.email == place.scope
                PlaceRow(title: mailbox.displayName, count: store.badge(in: .inbox, scope: mailbox.email), selected: current) {
                    MailboxAvatar(mailbox: mailbox, size: 24)
                } action: {
                    onMailbox(mailbox)
                }
                .accessibilityAddTraits(current ? .isSelected : [])
            }
            Divider().overlay(palette.border).padding(.vertical, 6).padding(.horizontal, 4)
        }
    }

    @ViewBuilder
    private func labels(_ mailbox: Mailbox?) -> some View {
        let labels = mailbox?.labels ?? []
        if !labels.isEmpty {
            PanelHeading(title: mailbox?.provider == .gmail ? "Labels" : "Folders")
            ForEach(labels) { label in
                let folder = Folder.label(id: label.id, name: label.name)
                row(folder.title, symbol: folder.symbol, color: label.color,
                    count: store.badge(in: folder, scope: place.scope), selected: module == .mail && place.folder == folder,
                    indent: label.depth) {
                    onSelect(Place(scope: place.scope, folder: folder))
                }
            }
            Divider().overlay(palette.border).padding(.vertical, 6).padding(.horizontal, 4)
        }
    }

    private func row(_ title: String, symbol: String, color: String? = nil, count: Int = 0,
                     selected: Bool = false, indent: Int = 0, action: @escaping () -> Void) -> some View {
        PlaceRow(title: title, count: count, selected: selected, indent: indent) {
            Image(systemName: symbol)
                .font(.system(size: 17))
                .foregroundStyle(color.map(Color.init(hex:)) ?? palette.text)
        } action: {
            action()
        }
    }
}

/**
 * What every panel over the bar is drawn in (the mail's places, the
 * calendars): a header, a hairline, and its rows scrolling under it once
 * they're taller than the panel.
 */
struct ScopePanel<Header: View, Rows: View>: View {
    @Environment(\.palette) private var palette
    @ViewBuilder let header: Header
    @ViewBuilder let rows: Rows

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.horizontal, 16)
                .frame(height: 56)
            Divider().overlay(palette.border).padding(.horizontal, 12)
            ScrollView {
                VStack(alignment: .leading, spacing: 2) { rows }
                    .padding(8)
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
        }
        .frame(maxWidth: 340)
    }
}

/** A panel's own heading over a group of rows ("Labels"). */
struct PanelHeading: View {
    @Environment(\.palette) private var palette
    let title: String

    var body: some View {
        Text(title)
            .font(.inter(.footnote))
            .foregroundStyle(palette.muted)
            .padding(.horizontal, 12)
            .padding(.top, 12)
            .padding(.bottom, 4)
    }
}

/** A row of the panels over the bar: an icon, a title, a count, or a check for one that switches on and off. */
struct PlaceRow<Icon: View>: View {
    @Environment(\.palette) private var palette
    let title: String
    var count = 0
    var selected = false
    var indent = 0
    var checked: Bool?
    @ViewBuilder let icon: Icon
    var action: (() -> Void)?

    var body: some View {
        let label = HStack(spacing: 14) {
            icon.frame(width: 24)
            Text(title)
                .font(.inter(.body))
                .foregroundStyle(palette.text)
                .lineLimit(1)
            Spacer(minLength: 8)
            if let checked {
                Image(systemName: checked ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 19))
                    .foregroundStyle(checked ? palette.text : palette.muted)
                    .accessibilityHidden(true)
            } else if count > 0 {
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
        if let action {
            Button(action: action) { label }
                .buttonStyle(.plain)
                .accessibilityLabel(title)
                .accessibilityValue(checked.map { $0 ? "Shown" : "Hidden" } ?? "")
                .accessibilityAddTraits(selected ? .isSelected : [])
        } else {
            label
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
