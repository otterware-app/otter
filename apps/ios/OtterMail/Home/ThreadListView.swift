import SwiftUI

struct ThreadListView: View {
    @Environment(MailStore.self) private var store
    @Environment(Preferences.self) private var preferences
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.displayScale) private var displayScale

    let place: Place
    let messageTransition: Namespace.ID
    var query = ""
    var searchTab = false
    @Binding var selecting: Bool
    let onTitle: () -> Void
    let onCompose: () -> Void
    let onSettings: () -> Void
    var onSearch: () -> Void = {}
    /** The inbox's Catch up, and how many cards it holds (`CatchUpState.items`). */
    var onCatchUp: (() -> Void)? = nil
    var catchUpCount = 0
    let onResume: (Draft) -> Void

    @State private var collapsedDays: Set<Date> = []
    @State private var unreadOnly = false
    @State private var selected: Set<String> = []
    @State private var found: (query: String, ids: [String]) = ("", [])
    /** Redraws the rows when a shown code goes stale. */
    @State private var codesChecked = Date.now

    var body: some View {
        let searching = !query.trimmingCharacters(in: .whitespaces).isEmpty
        let threads = searching ? results : searchTab ? [] : unreadOnly ? listed.filter(\.unread) : listed
        let codesExpire = threads.compactMap { $0.freshVerificationCode() == nil ? nil : $0.sent.last?.date.addingTimeInterval(MailThread.freshCodeAge) }.min()

        List {
            if !searchTab {
                pills
            }
            if !searching && !searchTab && !selecting && !recoveries.isEmpty {
                Section {
                    ForEach(recoveries) { recovery in
                        Button { onResume(recovery.draft) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Label(recovery.draft.subject.isEmpty ? "Unfinished message" : recovery.draft.subject, systemImage: "square.and.pencil")
                                    .foregroundStyle(palette.text).lineLimit(1)
                                Text(recovery.draft.to.isEmpty ? recovery.draft.from : recovery.draft.to)
                                    .font(.inter(.footnote)).foregroundStyle(palette.muted).lineLimit(1)
                            }.padding(.vertical, 6)
                        }
                        .listRowBackground(palette.canvas)
                        .contextMenu {
                            Button("Delete local copy", systemImage: "trash", role: .destructive) { store.removeRecovery(recovery.draft, deletingFiles: true) }
                        }
                    }
                } header: {
                    Text("On this iPhone").sectionHeader()
                }.textCase(nil)
            }
            if preferences.groupMessagesByDay {
                ForEach(ThreadDay.group(threads)) { day in
                    Section {
                        if !collapsedDays.contains(day.id) {
                            rows(day.threads)
                        }
                    } header: {
                        dayHeader(day)
                    }
                    .textCase(nil)
                }
            } else {
                rows(threads)
            }

            if !searching && !searchTab, let sync = store.sync, sync.hasMore(place.folder, scope: place.scope) {
                if sync.paused(place.folder, scope: place.scope) {
                    // Paging stopped at `aliasPageLimit`: going further takes a tap.
                    Button("Load more") { Task { await sync.loadMore(place.folder, scope: place.scope) } }
                        .font(.inter(.subheadline))
                        .foregroundStyle(palette.muted)
                        .frame(maxWidth: .infinity)
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                        .task(id: "\(place)-\(sync.cursor(place.folder, scope: place.scope))") { await sync.loadMore(place.folder, scope: place.scope) }
                }
            }

            if store.sync?.loadingCache == true && threads.isEmpty {
                ProgressView().frame(maxWidth: .infinity).listRowSeparator(.hidden)
            }
            if searchTab && !searching {
                ContentUnavailableView(
                    "Search \(scopeName)",
                    systemImage: "magnifyingglass",
                    description: Text("Senders, subjects and words, or from: and is:unread.")
                )
                .foregroundStyle(palette.muted)
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .padding(.top, 80)
            } else if store.sync?.loadingCache != true && threads.isEmpty && (searching || recoveries.isEmpty) && !(store.sync?.hasMore(place.folder, scope: place.scope) ?? false) {
                ContentUnavailableView(
                    searching ? "No results" : "Nothing in \(place.folder.title(in: mailbox))",
                    systemImage: searching ? "magnifyingglass" : place.folder.symbol(in: mailbox),
                    description: Text(searching ? "Try other words, or from: and is:unread." : "")
                )
                .foregroundStyle(palette.muted)
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .padding(.top, 80)
            }
        }
        .listStyle(.plain)
        .listSectionSeparator(.hidden, edges: .top)
        .scrollContentBackground(.hidden)
        .background(palette.canvas)
        .contentMargins(.bottom, 24, for: .scrollContent)
        .safeAreaInset(edge: .top, spacing: 0) { SignedOutBanners() }
        .task(id: place) {
            collapsedDays.removeAll()
            selected.removeAll()
            selecting = false
            unreadOnly = false
            if !searchTab { await store.sync?.open(place.folder, scope: place.scope) }
        }
        .task(id: query) {
            guard let sync = store.sync, !query.trimmingCharacters(in: .whitespaces).isEmpty else { return }
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            let ids = await sync.search(query, scope: place.scope)
            found = (query, ids)
        }
        .task(id: [codesExpire, codesChecked]) {
            guard let codesExpire else { return }
            try? await Task.sleep(for: .seconds(max(0, codesExpire.timeIntervalSinceNow) + 1))
            if !Task.isCancelled { codesChecked = .now }
        }
        .refreshable {
            await store.sync?.syncAll()
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(action: onTitle) {
                    PlaceTitle(title: searching || searchTab ? "Search" : place.folder.title(in: mailbox), scope: scopeName)
                }
                .buttonStyle(.plain)
                .disabled(searchTab)
                .accessibilityHint("Shows every folder and label")
            }
            .sharedBackgroundVisibility(.hidden)
            ToolbarItem(placement: .topBarTrailing) {
                if selecting {
                    Button("Done", action: endSelection)
                } else if !searchTab {
                    Button("Compose", systemImage: "square.and.pencil", action: onCompose)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if !selecting && !searchTab {
                    // Beside More, so the trailing bar stays two pieces of glass: Compose, and Search with More.
                    HStack(spacing: 16) {
                        Button("Search", systemImage: "magnifyingglass", action: onSearch)
                        Menu("More", systemImage: "ellipsis") {
                            Button("Select messages", systemImage: "checkmark.circle") { withAnimation(actionAnimation) { selecting = true } }
                                .disabled(threads.isEmpty)
                            Button("Mark all as read", systemImage: "envelope.open") {
                                for thread in threads where thread.unread { store.setRead(true, thread.id) }
                            }
                            .disabled(!threads.contains(where: \.unread))
                            Button("Settings", systemImage: "gearshape", action: onSettings)
                        }
                    }
                }
            }
            if selecting {
                ToolbarItem(placement: .bottomBar) {
                    Menu("\(selected.count) selected") {
                        Button(selected.count == threads.count ? "Deselect all" : "Select all") {
                            selected = selected.count == threads.count ? [] : Set(threads.map(\.id))
                        }
                    }
                }
                ToolbarSpacer(.flexible, placement: .bottomBar)
                ToolbarItem(id: "secondary-action", placement: .bottomBar) {
                    if [.trash, .junk, .archive].contains(place.folder) {
                        Button("Move to Inbox", systemImage: "tray.and.arrow.down") {
                            for id in selected { store.moveToInbox(id) }
                            endSelection()
                        }.disabled(selected.isEmpty)
                    } else {
                        Button("Archive", systemImage: "archivebox") { store.archive(selected); endSelection() }
                            .disabled(!selected.compactMap(store.thread).contains(where: store.canArchive))
                    }
                }
                ToolbarItem(id: "message-actions", placement: .bottomBar) {
                    Menu("Message actions", systemImage: "tag") {
                        Button("Mark as read", systemImage: "envelope.open") { for id in selected { store.setRead(true, id) }; endSelection() }
                        Button("Mark as unread", systemImage: "envelope.badge") { for id in selected { store.setRead(false, id) }; endSelection() }
                        if selected.compactMap(store.thread).contains(where: { !(store.mailbox($0.mailbox)?.labels.isEmpty ?? true) }) {
                            bulkLabels
                        }
                    }.disabled(selected.isEmpty)
                }
            }
            if selecting && place.folder != .trash {
                ToolbarItem(id: "primary-action", placement: .bottomBar) {
                    Button("Move to Trash", systemImage: "trash", role: .destructive) { store.trash(selected); endSelection() }
                        .disabled(selected.isEmpty)
                }
            }
        }
        .onChange(of: threads.map(\.id)) { _, ids in selected.formIntersection(ids) }
        .onChange(of: query) { _, _ in selected.removeAll() }
        .toolbarTitleDisplayMode(.inline)
        // Search and scroll minimization otherwise animate the same bar's insets.
        .minimizingNavigationBar(enabled: false)
    }

    /** The folder's threads, down to where its pages reached (so the next page adds to the bottom). */
    private var listed: [MailThread] {
        let threads = store.threads(in: place.folder, scope: place.scope)
        return store.sync?.listed(threads, in: place.folder) ?? threads
    }

    private var results: [MailThread] {
        let local = store.search(query, scope: place.scope)
        guard found.query == query else { return local }
        let known = Set(local.map(\.id))
        let remote = found.ids.filter { !known.contains($0) }.compactMap(store.thread).filter(store.belonging(to: place.scope))
        return (local + remote).sorted { $0.latest.date > $1.latest.date }
    }

    private var recoveries: [RecoveredDraft] {
        guard place.folder == .drafts else { return [] }
        return store.recoveries(in: place.scope)
    }

    private var actionAnimation: Animation? { reduceMotion ? nil : .smooth(duration: 0.18) }

    private func endSelection() {
        withAnimation(actionAnimation) { selected.removeAll(); selecting = false }
    }

    private var bulkLabels: some View {
        Menu("Labels / folders", systemImage: "tag") {
            ForEach(store.shownMailboxes) { mailbox in
                let threads = selected.compactMap(store.thread).filter { $0.mailbox == mailbox.email }
                if !threads.isEmpty && !mailbox.labels.isEmpty {
                    Menu(mailbox.displayName) {
                        ForEach(mailbox.labels) { label in
                            let remove = threads.allSatisfy { $0.labels.contains(label.id) }
                            Button("\(remove ? "Remove" : mailbox.capabilities.multipleLabels ? "Add" : "Move to") \(label.name)") {
                                for thread in threads where thread.labels.contains(label.id) == remove {
                                    store.toggleLabel(label.id, thread.id)
                                }
                                endSelection()
                            }
                        }
                    }
                }
            }
        }
    }

    private var mailbox: Mailbox? { store.mailbox(for: place.scope) }

    private var scopeName: String { mailbox?.displayName ?? "" }

    private func rows(_ threads: [MailThread]) -> some View {
        ForEach(threads) { thread in
            row(thread)
        }
    }

    private var pills: some View {
        HStack(spacing: 4) {
            pill("All", selected: !unreadOnly) { unreadOnly = false }
            pill("Unread", selected: unreadOnly) { unreadOnly = true }
            Spacer()
            if let onCatchUp, place.folder == .inbox, !selecting, catchUpCount > 0 {
                Button(action: onCatchUp) {
                    Label("Catch up · \(catchUpCount)", systemImage: "rectangle.stack")
                        .font(.inter(.subheadline).weight(.medium))
                        .monospacedDigit()
                        .foregroundStyle(palette.text)
                        .padding(.horizontal, 14)
                        .frame(height: 36)
                        .background(palette.text.opacity(0.08), in: .capsule)
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Goes through unread mail and invitations one at a time")
            }
        }
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 8, trailing: 16))
        .listRowSeparator(.hidden)
        .listRowBackground(palette.canvas)
    }

    private func pill(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            withAnimation(actionAnimation) { action() }
        } label: {
            Text(title)
                .font(.inter(.subheadline).weight(.medium))
                .foregroundStyle(selected ? palette.text : palette.muted)
                .padding(.horizontal, 16)
                .frame(height: 36)
                .background(selected ? palette.text.opacity(0.08) : .clear, in: .capsule)
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func dayHeader(_ day: ThreadDay) -> some View {
        let collapsed = collapsedDays.contains(day.id)
        return Button {
            withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) {
                if collapsed { collapsedDays.remove(day.id) }
                else { collapsedDays.insert(day.id) }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "chevron.down")
                    .font(.inter(.caption2))
                    .rotationEffect(.degrees(collapsed ? -90 : 0))
                Text(day.title).fontWeight(.medium).foregroundStyle(palette.text)
                Spacer()
                Text(day.unread > 0 ? "\(day.threads.count) · \(day.unread) unread" : "\(day.threads.count)")
                    .monospacedDigit()
            }
            .font(.inter(.footnote))
            .foregroundStyle(palette.muted)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(day.title), \(day.threads.count) conversations, \(day.unread) unread")
        .accessibilityValue(collapsed ? "Collapsed" : "Expanded")
        .accessibilityHint("Double tap to \(collapsed ? "expand" : "collapse") this day")
        .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
    }

    private func row(_ thread: MailThread) -> some View {
        let code = selecting ? nil : thread.freshVerificationCode()
        return Group {
            let content = ThreadRow(thread: thread, mark: mailbox?.mark ?? "star", mine: Set(store.addresses(of: thread.mailbox)), code: code)
            if selecting {
                Button {
                    if selected.contains(thread.id) { selected.remove(thread.id) }
                    else { selected.insert(thread.id) }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: selected.contains(thread.id) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selected.contains(thread.id) ? palette.action : palette.muted)
                        content
                    }
                }
                .buttonStyle(.plain)
                .accessibilityValue(selected.contains(thread.id) ? "Selected" : "Not selected")
            } else if thread.isDraft, let message = thread.messages.last {
                Button { onResume(.resume(message, in: thread)) } label: { content }
                    .buttonStyle(.plain)
            } else {
                NavigationLink(value: thread.id) { content }
                    .navigationLinkIndicatorVisibility(.hidden)
                    .matchedTransitionSource(id: thread.id, in: messageTransition)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if let code {
                // Centered on the code's line, outside the link so it takes its own tap; its 44pt target overhangs the line.
                Text(code).font(.inter(.subheadline)).hidden()
                    .overlay(alignment: .trailing) {
                        CodeButton(code: code, onTrash: thread.labels.contains("TRASH") ? nil : {
                            withAnimation(actionAnimation) { store.trash(thread.id) }
                        })
                    }
            }
        }
        .padding(.leading, 24)
        .padding(.trailing, 16)
        .padding(.vertical, 10)
        .background(rowBackground(unread: thread.unread && !thread.isDraft))
        .contextMenu {
            if !selecting { ThreadActions(thread: thread) }
        }
        .modifier(MailSwipeActions(
            leading: selecting ? nil : leadingAction(thread),
            trailing: selecting ? nil : trailingAction(thread),
            square: preferences.fullWidthRows
        ))
        .listRowBackground(palette.canvas)
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets())
    }

    /** The desktop's rows (styles.css): unread mail on a raised card, or edge to edge with a hairline between. */
    private func rowBackground(unread: Bool) -> some View {
        let fill = palette.text.opacity(unread ? 0.04 : 0)
        return palette.canvas.overlay {
            if preferences.fullWidthRows {
                Rectangle().fill(fill)
                    .overlay(alignment: .bottom) { Rectangle().fill(palette.border).frame(height: 1 / displayScale) }
            } else {
                RoundedRectangle(cornerRadius: 8).fill(fill)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
            }
        }
    }

    /** Linear's: one action a side. Away to the right, out of the folder; to the left, into the trash. */
    private func leadingAction(_ thread: MailThread) -> MailSwipeAction? {
        if store.canArchive(thread) && place.folder != .trash && place.folder != .junk {
            return MailSwipeAction(title: "Archive", symbol: "archivebox", tint: .indigo) {
                withAnimation(actionAnimation) { store.archive(thread.id) }
            }
        }
        if [.trash, .junk].contains(place.folder) || thread.labels.contains("ARCHIVE") {
            return MailSwipeAction(title: "Inbox", symbol: "tray.and.arrow.down", tint: palette.focus) {
                withAnimation(actionAnimation) { store.moveToInbox(thread.id) }
            }
        }
        return nil
    }

    private func trailingAction(_ thread: MailThread) -> MailSwipeAction {
        if place.folder == .trash || place.folder == .junk {
            return MailSwipeAction(title: "Delete", symbol: "trash", tint: .red) {
                withAnimation(actionAnimation) { store.deleteForever(thread.id) }
            }
        }
        return MailSwipeAction(title: "Trash", symbol: "trash", tint: .red) {
            withAnimation(actionAnimation) { store.trash(thread.id) }
        }
    }
}

/** A module's title, top left: the place in semibold, then what it's scoped to, muted. */
struct PlaceTitle: View {
    @Environment(\.palette) private var palette
    let title: String
    var scope = ""

    var body: some View {
        let name = Text(title).fontWeight(.semibold).foregroundStyle(palette.text)
        (scope.isEmpty ? name : Text("\(name) \(Text(scope).foregroundStyle(palette.muted))"))
            .font(.inter(.title3))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .fixedSize()
    }
}

struct ThreadActions: View {
    @Environment(MailStore.self) private var store
    let thread: MailThread
    var onGone: () -> Void = {}

    var body: some View {
        Button(thread.unread ? "Mark as read" : "Mark as unread",
               systemImage: thread.unread ? "envelope.open" : "envelope.badge") {
            store.setRead(thread.unread, thread.id)
        }
        let mailbox = store.mailbox(thread.mailbox)
        let mark = mailbox?.mark ?? "star"
        Button(thread.starred ? "Un\(mark)" : mark.capitalized, systemImage: thread.starred ? "\(mark).slash" : mark) {
            store.toggleStar(thread.id)
        }
        if let mailbox, !mailbox.labels.isEmpty {
            Menu("Labels", systemImage: "tag") {
                ForEach(mailbox.labels) { label in
                    Toggle(label.name, isOn: Binding(
                        get: { thread.labels.contains(label.id) },
                        set: { _ in store.toggleLabel(label.id, thread.id) }
                    ))
                }
            }
            // A switch (the app's toggle style) can't sit in a menu; checkmarks can.
            .toggleStyle(.automatic)
        }
        Divider()
        if store.canArchive(thread) {
            Button("Archive", systemImage: "archivebox") { store.archive(thread.id); onGone() }
        }
        if thread.labels.contains("SPAM") || thread.labels.contains("TRASH") || !thread.labels.contains("INBOX") {
            Button("Move to Inbox", systemImage: "tray.and.arrow.down") { store.moveToInbox(thread.id); onGone() }
        }
        if !thread.labels.contains("SPAM") {
            Button("Report junk", systemImage: "xmark.bin") { store.markSpam(thread.id); onGone() }
        }
        if thread.labels.contains("TRASH") {
            Button("Delete forever", systemImage: "trash", role: .destructive) { store.deleteForever(thread.id); onGone() }
        } else {
            Button("Trash", systemImage: "trash", role: .destructive) { store.trash(thread.id); onGone() }
        }
    }
}
