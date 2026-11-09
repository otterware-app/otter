import SwiftUI

/**
 * A new event, or one of yours to change, as event-panel.tsx's NewEvent and
 * EventDetails edit one: title, All-day, when it starts and ends, the
 * calendar (picked for a new one), where, and notes; an event of yours can be
 * deleted. Nothing is written until Save or Delete, and leaving with changes
 * asks first. Pushed over the calendar, so the bar isn't under it.
 */
struct EventEditor: View {
    @Environment(MailStore.self) private var store
    @Environment(Session.self) private var session
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    let events: CalendarStore
    /** The event being changed, or nil for a new one. */
    let event: CalendarEvent?
    /** The calendars a new event can go on. */
    let calendars: [EventCalendar]
    let dates: CalendarDates
    let color: (EventCalendar) -> Color
    var onSaved: (CalendarEvent) -> Void = { _ in }
    var onDeleted: () -> Void = {}

    @State private var draft: EventDraft
    @State private var saving = false
    @State private var error: String?
    @State private var needsSignIn = false
    @State private var confirmingDiscard = false
    @State private var confirmingDelete = false

    init(
        events: CalendarStore, draft: EventDraft, event: CalendarEvent? = nil, calendars: [EventCalendar],
        dates: CalendarDates, color: @escaping (EventCalendar) -> Color,
        onSaved: @escaping (CalendarEvent) -> Void = { _ in }, onDeleted: @escaping () -> Void = {}
    ) {
        self.events = events
        self.event = event
        self.calendars = calendars
        self.dates = dates
        self.color = color
        self.onSaved = onSaved
        self.onDeleted = onDeleted
        _draft = State(initialValue: draft)
        initial = draft
    }

    private let initial: EventDraft
    private var changed: Bool { draft.patch(from: initial, dates: dates) != EventInput() }

    var body: some View {
        SettingsForm {
            Section {
                TextField("Title", text: $draft.title, axis: .vertical)
                    .font(.inter(.body).weight(.medium))
                    .foregroundStyle(palette.text)
                    .accessibilityIdentifier("event-title")
            }

            Section {
                Toggle(isOn: Binding(get: { draft.allDay }, set: { draft.setAllDay($0, dates: dates) })) {
                    Label("All-day", systemImage: "sun.max")
                }
                if draft.allDay {
                    DatePicker(selection: Binding(get: { draft.start }, set: { draft.move(to: dates.startOfDay($0)) }),
                               displayedComponents: [.date]) {
                        Label("Starts", systemImage: "arrow.right.circle")
                    }
                    DatePicker(selection: Binding(get: { draft.lastDay(dates: dates) }, set: { draft.setLastDay($0, dates: dates) }),
                               in: draft.start..., displayedComponents: [.date]) {
                        Label("Ends", systemImage: "arrow.left.circle")
                    }
                } else {
                    DatePicker(selection: Binding(get: { draft.start }, set: { draft.move(to: $0) })) {
                        Label("Starts", systemImage: "arrow.right.circle")
                    }
                    DatePicker(selection: $draft.end, in: draft.start...) {
                        Label("Ends", systemImage: "arrow.left.circle")
                    }
                }
            } header: {
                Text("When").sectionHeader()
            } footer: {
                if let problem = draft.problem {
                    Text(problem).sectionFooter().foregroundStyle(palette.error)
                } else if event?.recurring == true {
                    Text("Repeats. Changes apply to this one.").sectionFooter()
                } else if !draft.allDay {
                    Text(CalendarDates.durationLabel(draft.end.timeIntervalSince(draft.start))).sectionFooter()
                }
            }

            Section {
                calendarRow
                TextField("Location", text: $draft.location)
                    .font(.inter(.body))
                    .foregroundStyle(palette.text)
                TextField("Notes", text: $draft.notes, axis: .vertical)
                    .font(.inter(.subheadline))
                    .foregroundStyle(palette.text)
                    .frame(minHeight: 60, alignment: .topLeading)
            }

            if let error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.inter(.subheadline))
                        .foregroundStyle(palette.error)
                    if needsSignIn, let mailbox = store.mailbox(draft.calendar.account) {
                        SignInAgainButton(mailbox: mailbox, title: "Sign in again")
                    }
                }
            }

            if let event {
                Section {
                    Button("Delete event", systemImage: "trash", role: .destructive) { confirmingDelete = true }
                        .disabled(saving)
                }
            }
        }
        // On the form, not the toolbar's buttons: anchored there they show as a popover without Keep editing.
        .confirmationDialog("Discard your changes?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
            Button("Discard changes", role: .destructive) { dismiss() }
            Button("Keep editing") {}
        }
        .confirmationDialog("Delete \"\(event?.title ?? "")\"?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete event", role: .destructive) {
                if let event { Task { await delete(event) } }
            }
        } message: {
            if event?.hasGuests == true { Text("The guests are told it's cancelled.") }
        }
        .navigationTitle(event == nil ? "New event" : "Edit event")
        .toolbarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(changed)
        .toolbar {
            if changed {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Back", systemImage: "chevron.left") { confirmingDiscard = true }
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(saving ? "Saving…" : "Save") { Task { await save() } }
                    .fontWeight(.semibold)
                    .disabled(saving || draft.problem != nil || !changed)
            }
        }
    }

    /** A new event's calendar is picked, by mailbox as the web's NewEvent lists them; an event's stays where it is. */
    @ViewBuilder private var calendarRow: some View {
        if event == nil, calendars.count > 1 {
            Picker(selection: $draft.calendar) {
                ForEach(CalendarStore.grouped(CalendarStore.sources(store.shownMailboxes), lists: lists), id: \.mailbox.email) { group in
                    if !group.calendars.isEmpty {
                        Section(group.mailbox.displayName) {
                            ForEach(group.calendars, id: \.key) { calendar in
                                Text(calendar.primary ? group.mailbox.displayName : calendar.name).tag(calendar)
                            }
                        }
                    }
                }
            } label: {
                calendarLabel
            }
        } else {
            LabeledContent {
                Text(draft.calendar.name).foregroundStyle(palette.muted)
            } label: {
                calendarLabel
            }
        }
    }

    private var calendarLabel: some View {
        Label {
            Text("Calendar")
        } icon: {
            Circle().fill(color(draft.calendar)).frame(width: 10, height: 10)
        }
    }

    private var lists: [String: [EventCalendar]] {
        Dictionary(grouping: calendars, by: \.account)
    }

    private func writer(_ account: String) -> EventWriter {
        events.writer(for: account, demo: store.isDemo, google: session.google)
    }

    /** Only once Google has it does the editor close; otherwise it stays, with the changes and why. */
    private func save() async {
        saving = true
        error = nil
        defer { saving = false }
        do {
            let saved: CalendarEvent
            if let event {
                saved = try await events.update(event, to: draft, with: writer(event.calendar.account), demo: store.isDemo, dates: dates)
            } else {
                saved = try await events.create(draft, with: writer(draft.calendar.account), demo: store.isDemo, dates: dates)
            }
            onSaved(saved)
            dismiss()
        } catch {
            fail(error, event == nil ? "Couldn't create the event." : "Couldn't change the event.")
        }
    }

    private func delete(_ event: CalendarEvent) async {
        saving = true
        error = nil
        defer { saving = false }
        do {
            try await events.delete(event, with: writer(event.calendar.account), demo: store.isDemo)
            onDeleted()
        } catch {
            fail(error, "Couldn't delete the event.")
        }
    }

    private func fail(_ error: Error, _ what: String) {
        needsSignIn = error is GoogleCalendarAPI.NoAccess
        if needsSignIn {
            self.error = "\(what) Sign in to this mailbox again to let Otter Mail change its calendar."
        } else if let problem = error as? EventProblem {
            self.error = problem.message
        } else {
            self.error = "\(what) \(error.localizedDescription)"
        }
    }
}
