import SwiftUI

nonisolated enum CatchUp {
    /** How far ahead Catch up looks for invitations. */
    static let inviteDays = 60

    /** The inbox's unread conversations, in the list's order, less the ones already passed over. */
    static func queue(_ inbox: [MailThread], passed: Set<String> = []) -> [MailThread] {
        inbox.filter { $0.unread && !passed.contains($0.id) }
    }

    /** An unsubscribe that went through, or was handed to the sender's page, is done with the card; a failure keeps it. */
    static func advances(after outcome: Unsubscribe.Outcome) -> Bool {
        switch outcome {
        case .done, .openedPage: true
        case .failed: false
        }
    }

    enum Item: Identifiable {
        case invite(CalendarEvent)
        case mail(MailThread)

        var id: String {
            switch self {
            case .invite(let event): "invite/\(event.id)"
            case .mail(let thread): "mail/\(thread.id)"
            }
        }
    }

    /** Invitations first, soonest first, as they're the ones with a date; then the mail. */
    static func items(invites: [CalendarEvent], mail: [MailThread]) -> [Item] {
        invites.map(Item.invite) + mail.map(Item.mail)
    }

    static func window(_ dates: CalendarDates, now: Date = .now) -> EventWindow {
        let from = dates.startOfDay(now)
        return EventWindow(from: from, to: dates.addDays(from, inviteDays))
    }

    /** An invitation card's answers, as Google Calendar's: Yes, No, Maybe. */
    enum Answer: CaseIterable {
        case accept, decline, maybe

        var title: String {
            switch self {
            case .accept: "Accept"
            case .decline: "Decline"
            case .maybe: "Maybe"
            }
        }

        var symbol: String {
            switch self {
            case .accept: "checkmark.circle"
            case .decline: "xmark.circle"
            case .maybe: "questionmark.circle"
            }
        }

        /** Google's `responseStatus`. */
        var response: CalendarEvent.Response {
            switch self {
            case .accept: .accepted
            case .decline: .declined
            case .maybe: .tentative
            }
        }

        var done: String {
            switch self {
            case .accept: "Accepted"
            case .decline: "Declined"
            case .maybe: "Answered maybe to"
            }
        }
    }
}

/**
 * Catch up on an inbox: its unread mail one conversation at a time, after the
 * invitations on its mailbox's shown calendars still waiting on an answer.
 * HomeView holds it, so the inbox's pill and Catch up count the same cards
 * and what was passed over stays passed while the app is open. The senders
 * unsubscribed from no longer offer Unsubscribe on their other mail.
 */
@Observable
final class CatchUpState {
    var passed: Set<String> = []
    private(set) var unsubscribing: Set<String> = []
    private(set) var unsubscribed: Set<String> = []

    struct Result: Equatable {
        let text: String
        let ok: Bool
    }

    /** The cards for the inbox at `scope`: what its pill counts and Catch up goes through. */
    func items(scope: String, store: MailStore, calendar: CalendarStore, shown: [String: Bool], dates: CalendarDates) -> [CatchUp.Item] {
        let threads = store.threads(in: .inbox, scope: scope)
        let mail = CatchUp.queue(store.sync?.listed(threads, in: .inbox) ?? threads, passed: passed)
        let account = store.mailbox(scope)?.email.lowercased()
        let invites = CalendarStore.invites(calendar.events(in: CatchUp.window(dates)) ?? [], shown: shown)
            .filter { $0.calendar.account.lowercased() == account && !passed.contains($0.id) }
        return CatchUp.items(invites: invites, mail: mail)
    }

    private static func sender(_ thread: MailThread) -> Person { (thread.sent.last ?? thread.latest).from }

    func offersUnsubscribe(_ thread: MailThread) -> Bool {
        !unsubscribed.contains(Self.sender(thread).email.lowercased())
    }

    /**
     * Once the unsubscribe goes through (or is handed to the sender's page), the
     * conversation is archived and read, so sync doesn't bring the card back. If
     * that fails, the card stays and says so.
     */
    func unsubscribe(_ thread: MailThread, store: MailStore, run: () async -> Unsubscribe.Outcome) async -> Result {
        let sender = Self.sender(thread)
        unsubscribing.insert(thread.id)
        defer { unsubscribing.remove(thread.id) }
        let outcome = await run()
        guard CatchUp.advances(after: outcome) else { return Result(text: outcome.notice(from: sender.label), ok: false) }
        do {
            try await store.archiveRead(thread.id)
        } catch {
            unsubscribed.insert(sender.email.lowercased())
            return Result(text: "Unsubscribed, but couldn't archive “\(thread.subject)”: \(error.localizedDescription)", ok: false)
        }
        unsubscribed.insert(sender.email.lowercased())
        passed.insert(thread.id)
        return Result(text: outcome.notice(from: sender.label), ok: true)
    }
}

/**
 * Catch up, pushed over the inbox from its pill: one card at a time, right to
 * mark it read, left to skip it (it stays unread). Done, it says so and waits
 * to be closed.
 */
struct CatchUpView: View {
    @Environment(MailStore.self) private var store
    @Environment(Session.self) private var session
    @Environment(Preferences.self) private var preferences
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    let scope: String
    let calendar: CalendarStore
    let shown: CalendarShown
    let state: CatchUpState
    @Binding var draft: Draft?

    @State private var answering: Set<String> = []
    @State private var notice: Notice?

    private struct Notice: Equatable {
        let id = UUID()
        let text: String
    }

    private var dates: CalendarDates { CalendarDates(preferences: preferences.calendar) }

    var body: some View {
        let items = state.items(scope: scope, store: store, calendar: calendar, shown: shown.shown, dates: dates)
        Group {
            if let item = items.first {
                VStack(spacing: 12) {
                    Text("\(items.count) left")
                        .font(.inter(.footnote).weight(.medium))
                        .foregroundStyle(palette.muted)
                        .monospacedDigit()
                    card(item)
                }
                .padding(.top, 4)
                .padding(.bottom, 8)
            } else {
                ContentUnavailableView {
                    Label("You're all caught up", systemImage: "checkmark.circle")
                } actions: {
                    Button("Back to Inbox") { dismiss() }
                        .buttonStyle(.glass)
                }
                .foregroundStyle(palette.text)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(alignment: .bottom) { banner }
        .background(palette.canvas)
        .navigationTitle("Catch up")
        .toolbarTitleDisplayMode(.inline)
        .toolbarVisibility(.hidden, for: .tabBar)
        .task(id: notice) {
            guard notice != nil else { return }
            try? await Task.sleep(for: .seconds(4))
            notice = nil
        }
    }

    @ViewBuilder private func card(_ item: CatchUp.Item) -> some View {
        switch item {
        case .mail(let thread):
            if let mailbox = store.mailbox(thread.mailbox) {
                CatchUpCard(thread: thread, mailbox: mailbox, scope: scope, draft: $draft)
                    .modifier(MailSwipeActions(leading: readAction(thread), trailing: skipAction(thread.id)))
                    .id(item.id)
                    .padding(.horizontal, 12)
                buttons(thread, mailbox)
            }
        case .invite(let event):
            InviteCard(event: event, mailbox: store.mailbox(event.calendar.account), dates: dates)
                .id(item.id)
                .padding(.horizontal, 12)
            inviteButtons(event)
        }
    }

    private var banner: some View {
        ZStack {
            if let notice {
                NoticeBanner(text: notice.text).padding(.bottom, 96).id(notice.id)
            }
        }
        .animation(.snappy(duration: 0.2), value: notice)
    }

    private func readAction(_ thread: MailThread) -> MailSwipeAction {
        MailSwipeAction(title: "Read", symbol: "envelope.open", tint: palette.focus) {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            markRead(thread)
        }
    }

    private func skipAction(_ id: String) -> MailSwipeAction {
        MailSwipeAction(title: "Skip", symbol: "arrow.uturn.forward", tint: .gray) {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            state.passed.insert(id)
        }
    }

    private func markRead(_ thread: MailThread) {
        store.setRead(true, thread.id)
        state.passed.insert(thread.id)
    }

    private func buttons(_ thread: MailThread, _ mailbox: Mailbox) -> some View {
        HStack(spacing: 8) {
            skipButton(thread.id)
            if store.canArchive(thread) {
                // Out of the inbox, so the card goes by itself; Undo brings it back.
                button("Archive", symbol: "archivebox") { store.archive(thread.id) }
            }
            if state.offersUnsubscribe(thread), let unsubscribe = Unsubscribe((thread.sent.last ?? thread.latest).headers) {
                let working = state.unsubscribing.contains(thread.id)
                button(working ? "Unsubscribing…" : "Unsubscribe", symbol: "hand.raised") {
                    run(unsubscribe, thread, mailbox)
                }
                .disabled(working)
            }
            button("Mark as Read", symbol: "envelope.open") { markRead(thread) }
        }
        .padding(.horizontal, 12)
    }

    private func skipButton(_ id: String) -> some View {
        button("Skip", symbol: "arrow.uturn.forward") { state.passed.insert(id) }
            .accessibilityHint("Leaves it as it is and shows the next one")
    }

    private func inviteButtons(_ event: CalendarEvent) -> some View {
        let working = answering.contains(event.id)
        return HStack(spacing: 8) {
            ForEach(CatchUp.Answer.allCases, id: \.self) { answer in
                button(answer.title, symbol: answer.symbol) { respond(answer, to: event) }
            }
            skipButton(event.id)
        }
        .disabled(working)
        .opacity(working ? 0.5 : 1)
        .padding(.horizontal, 12)
    }

    /** The card goes once Google has the answer; a refusal leaves it, saying why. */
    private func respond(_ answer: CatchUp.Answer, to event: CalendarEvent) {
        answering.insert(event.id)
        Task {
            do {
                try await calendar.respond(answer.response, to: event, demo: store.isDemo, google: session.google)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                notice = Notice(text: "\(answer.done) “\(event.title)”")
            } catch is GoogleCalendarAPI.NoAccess, GoogleAuth.Failure.signedOut {
                UINotificationFeedbackGenerator().notificationOccurred(.error)
                let name = store.mailbox(event.calendar.account)?.displayName ?? event.calendar.account
                notice = Notice(text: "Sign in to \(name) again to answer invitations.")
            } catch {
                UINotificationFeedbackGenerator().notificationOccurred(.error)
                ErrorReports.capture(error, scope: "calendar")
                notice = Notice(text: "Couldn't answer “\(event.title)”: \(error.localizedDescription)")
            }
            answering.remove(event.id)
        }
    }

    private func run(_ unsubscribe: Unsubscribe, _ thread: MailThread, _ mailbox: Mailbox) {
        Task {
            let result = await state.unsubscribe(thread, store: store) { await unsubscribe.run(from: mailbox, store: store) }
            UINotificationFeedbackGenerator().notificationOccurred(result.ok ? .success : .error)
            notice = Notice(text: result.text)
        }
    }

    private func button(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: symbol).font(.system(size: 18))
                Text(title).font(.inter(.caption).weight(.medium)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundStyle(palette.text)
            .frame(maxWidth: .infinity, minHeight: 56)
            .contentShape(.rect(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 16))
        .accessibilityLabel(title)
    }
}

/** A card's frame: as tall as what it holds, scrolling once that's taller than the screen. */
private struct CardScroll<Content: View>: View {
    @Environment(\.palette) private var palette
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView {
            content
                .background(palette.raised)
                .clipShape(.rect(cornerRadius: 20))
                .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(palette.border))
        }
        .scrollBounceBehavior(.basedOnSize)
        .scrollIndicators(.hidden)
    }
}

/** An invitation: what, when, where, and who asked and who else is coming. */
private struct InviteCard: View {
    @Environment(\.palette) private var palette
    let event: CalendarEvent
    let mailbox: Mailbox?
    let dates: CalendarDates

    var body: some View {
        CardScroll {
            VStack(alignment: .leading, spacing: 12) {
                Label(mailbox.map { "Invitation · \($0.displayName)" } ?? "Invitation", systemImage: "calendar.badge.clock")
                    .font(.inter(.footnote).weight(.medium))
                    .foregroundStyle(palette.muted)
                Text(event.title)
                    .font(.inter(.title3).weight(.semibold))
                    .foregroundStyle(palette.text)
                Text(dates.when(event))
                    .font(.inter(.subheadline))
                    .foregroundStyle(palette.text)
                if event.recurring {
                    Text("Repeats: the answer is for every occurrence")
                        .font(.inter(.footnote))
                        .foregroundStyle(palette.muted)
                }
                if let location = event.location?.trimmingCharacters(in: .whitespacesAndNewlines), !location.isEmpty {
                    Label(location, systemImage: "mappin.and.ellipse")
                        .font(.inter(.subheadline))
                        .foregroundStyle(palette.text)
                }
                if let organizer = event.organizer {
                    Label("From \(organizer.label)", systemImage: "person")
                        .font(.inter(.subheadline))
                        .foregroundStyle(palette.text)
                }
                let guests = event.guests
                if !guests.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(CalendarEvent.responseSummary(guests))
                            .font(.inter(.footnote).weight(.medium))
                            .foregroundStyle(palette.muted)
                        Text(guests.map(\.person.label).joined(separator: ", "))
                            .font(.inter(.footnote))
                            .foregroundStyle(palette.muted)
                            .lineLimit(4)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
    }
}

/** One conversation, whole, as the reader shows it. */
private struct CatchUpCard: View {
    @Environment(MailStore.self) private var store
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let thread: MailThread
    let mailbox: Mailbox
    let scope: String
    @Binding var draft: Draft?

    @State private var expanded: Set<String> = []

    var body: some View {
        CardScroll {
            LazyVStack(alignment: .leading, spacing: 0) {
                Text(thread.subject)
                    .font(.inter(.title3).weight(.semibold))
                    .foregroundStyle(palette.text)
                    .padding(.bottom, 4)
                    .padding(.horizontal, MessageView.inset)
                Text(people)
                    .font(.inter(.footnote))
                    .foregroundStyle(palette.muted)
                    .lineLimit(2)
                    .padding(.bottom, 16)
                    .padding(.horizontal, MessageView.inset)
                let messages = thread.distinctMessages(preferring: store.alias(scope)?.email)
                let code = thread.verificationCode
                ForEach(messages) { message in
                    if let code, message.id == thread.sent.last?.id {
                        CodeCard(code: code)
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
            .padding(.vertical, 16)
        }
    }

    private var people: String {
        let mine = Set(store.addresses(of: thread.mailbox))
        var names: [String] = []
        for message in thread.messages where !message.draft {
            for person in [message.from] + message.to + message.cc {
                let name = mine.contains(person.email.lowercased()) ? "me" : person.label
                if !names.contains(name) { names.append(name) }
            }
        }
        return names.joined(separator: ", ")
    }
}
