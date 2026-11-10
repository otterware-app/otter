import SwiftUI

/** Makes a scheduled task, or changes one: who runs it, what it does, when, and where its results go. */
struct TaskEditor: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(ScheduledStore.self) private var store
    @Environment(ChatStore.self) private var chats
    /** Nil makes a new one. */
    var task: ScheduledTask?
    var saved: (String) -> Void = { _ in }

    private enum Results: Hashable {
        case keep, newChat, off, webhook
        case channel(String)
    }

    @State private var creator = 0
    @State private var name = ""
    @State private var prompt = ""
    @State private var when = WhenForm()
    @State private var results = Results.newChat
    @State private var to = ""
    @State private var account = ""
    @State private var url = ""
    @State private var saving = false
    @State private var error: String?
    /** Nothing changed about when it runs: it's saved back exactly as it was. */
    @State private var originalWhen: WhenForm?

    private var kind: AgentKind? { task.flatMap { AgentKind(rawValue: $0.provider) } ?? store.creators[safe: creator]?.kind }
    private var listed: AgentTasks? { store.agents.first { $0.provider == kind?.rawValue } }

    private var problem: String? {
        if name.trimmingCharacters(in: .whitespaces).isEmpty { return "Give it a name." }
        if task?.prompt != nil || task == nil, prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Say what the agent should do." }
        if let problem = when.problem() { return problem }
        if results == .webhook, URL(string: url)?.scheme?.hasPrefix("http") != true { return "A webhook needs an http(s) address." }
        if case .channel = results, to.trimmingCharacters(in: .whitespaces).isEmpty { return "Say who on it gets the results." }
        return nil
    }

    var body: some View {
        NavigationStack {
            SettingsPage {
                Text("The agent runs it on its own, on time, whether or not Otter is open.").font(.ui(14)).foregroundStyle(palette.muted).padding(.horizontal, 8)
                if task == nil, store.creators.count > 1 {
                    SettingsSection {
                        SettingsCell {
                            Text("Agent").font(.ui(16)).foregroundStyle(palette.text)
                            Spacer()
                            Picker("Agent", selection: $creator) {
                                ForEach(Array(store.creators.enumerated()), id: \.offset) { index, entry in Text(entry.name).tag(index) }
                            }
                            .labelsHidden().tint(palette.muted)
                        }
                    }
                }
                SettingsSection {
                    SettingsCell {
                        TextField("Name", text: $name).font(.ui(16)).foregroundStyle(palette.text)
                    }
                    if task == nil || task?.prompt != nil {
                        SettingsDivider()
                        TextField("What should it do?", text: $prompt, axis: .vertical)
                            .font(.ui(16)).foregroundStyle(palette.text).lineLimit(3...10).padding(16)
                    }
                }
                SettingsSection(title: "When", footer: ScheduleText.schedule(when.schedule)) { whenFields }
                SettingsSection(title: "Send results to") { resultsFields }
                if let error { Text(error).font(.ui(14)).foregroundStyle(palette.error).padding(.horizontal, 8) }
            }
            .navigationTitle(task == nil ? "New scheduled task" : "Edit task")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : task == nil ? "Schedule" : "Save", systemImage: "checkmark") { save() }.disabled(saving)
                }
            }
        }
        .presentationDragIndicator(.visible)
        .onAppear(perform: load)
        .onChange(of: creator) { if !(listed?.can.deliverToOtter ?? true), results == .newChat { results = .off } }
    }

    @ViewBuilder
    private var whenFields: some View {
        SettingsCell {
            Text("Repeats").font(.ui(16)).foregroundStyle(palette.text)
            Spacer()
            Picker("Repeats", selection: $when.repeat) {
                // varys's routines repeat: a one-off isn't one.
                ForEach(WhenForm.Repeat.allCases.filter { $0 != .once || kind != .varys }) { Text($0.title).tag($0) }
            }
            .labelsHidden().tint(palette.muted)
        }
        SettingsDivider()
        switch when.repeat {
        case .weekly:
            SettingsCell {
                Text("On").font(.ui(16)).foregroundStyle(palette.text)
                Spacer()
                Picker("Day", selection: $when.weekday) {
                    ForEach(0..<7, id: \.self) { Text(Calendar.current.weekdaySymbols[$0]).tag($0) }
                }
                .labelsHidden().tint(palette.muted)
            }
            SettingsDivider()
        case .monthly:
            SettingsCell {
                Text("On day").font(.ui(16)).foregroundStyle(palette.text)
                Spacer()
                Picker("Day of the month", selection: $when.monthDay) { ForEach(1...31, id: \.self) { Text("\($0)").tag($0) } }
                    .labelsHidden().tint(palette.muted)
            }
            if when.monthDay > 28 {
                Text("It skips shorter months.").font(.ui(13)).foregroundStyle(palette.muted).padding(.horizontal, 16).padding(.bottom, 8)
            }
            SettingsDivider()
        default: EmptyView()
        }
        switch when.repeat {
        case .daily, .weekdays, .weekly, .monthly:
            SettingsCell {
                DatePicker("At", selection: Binding(
                    get: { Calendar.current.date(bySettingHour: when.hour, minute: when.minute, second: 0, of: .now) ?? .now },
                    set: { date in
                        when.hour = Calendar.current.component(.hour, from: date)
                        when.minute = Calendar.current.component(.minute, from: date)
                    }), displayedComponents: .hourAndMinute)
                    .font(.ui(16)).foregroundStyle(palette.text)
            }
        case .interval:
            SettingsCell {
                Stepper("Every \(when.every)", value: $when.every, in: 1...999).font(.ui(16)).foregroundStyle(palette.text)
            }
            SettingsDivider()
            SettingsCell {
                Picker("Unit", selection: $when.hours) {
                    Text(when.every == 1 ? "minute" : "minutes").tag(false)
                    Text(when.every == 1 ? "hour" : "hours").tag(true)
                }
                .pickerStyle(.segmented)
            }
        case .once:
            SettingsCell {
                DatePicker("On", selection: $when.once, in: Date.now...).font(.ui(16)).foregroundStyle(palette.text)
            }
        case .cron:
            SettingsCell {
                TextField("minute hour day month weekday", text: $when.cron)
                    .font(.mono(15)).foregroundStyle(palette.text).textInputAutocapitalization(.never).autocorrectionDisabled()
            }
        }
        if listed?.can.timeZones == true, ![.interval, .once].contains(when.repeat) {
            SettingsDivider()
            SettingsCell {
                Text("Time zone").font(.ui(16)).foregroundStyle(palette.text)
                Spacer()
                Picker("Time zone", selection: $when.tz) {
                    Text("The agent's time zone").tag("")
                    ForEach(TimeZone.knownTimeZoneIdentifiers, id: \.self) { Text($0.replacingOccurrences(of: "_", with: " ")).tag($0) }
                }
                .labelsHidden().tint(palette.muted)
            }
        }
    }

    @ViewBuilder
    private var resultsFields: some View {
        let channels = listed?.channels ?? []
        SettingsCell {
            Picker("Send results to", selection: $results) {
                if task != nil { Text("Where they go now").tag(Results.keep) }
                if listed?.can.deliverToOtter != false { Text("A new chat in Otter each time").tag(Results.newChat) }
                ForEach(channels) { Text($0.label).tag(Results.channel($0.id)) }
                if listed?.can.webhooks == true { Text("A webhook").tag(Results.webhook) }
                Text("Off").tag(Results.off)
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .tint(palette.text)
            Spacer()
        }
        if results == .keep, let task {
            Text(deliveryText(task.delivery)).font(.ui(13)).foregroundStyle(palette.muted).padding(.horizontal, 16).padding(.bottom, 12)
        }
        if case .channel(let id) = results {
            SettingsDivider()
            SettingsField(placeholder: "Who gets them (a channel, a chat, a number)", text: $to)
            let accounts = channels.first { $0.id == id }?.accounts ?? []
            if accounts.count > 1 {
                SettingsDivider()
                SettingsCell {
                    Text("Sent as").font(.ui(16)).foregroundStyle(palette.text)
                    Spacer()
                    Picker("Sent as", selection: $account) { ForEach(accounts, id: \.self) { Text($0).tag($0) } }.labelsHidden().tint(palette.muted)
                }
            }
        }
        if results == .webhook {
            SettingsDivider()
            SettingsField(placeholder: "https://example.com/hook", text: $url, url: true)
        }
    }

    private func load() {
        guard let task else {
            if listed?.can.deliverToOtter == false { results = .off }
            return
        }
        name = task.name
        prompt = task.prompt ?? ""
        if let form = WhenForm(task.schedule) { when = form }
        originalWhen = when
        results = .keep
        switch task.delivery {
        case .channel(_, _, let who, let from):
            to = who ?? ""
            account = from ?? ""
        case .webhook(let address): url = address
        default: break
        }
    }

    private func save() {
        if let problem { return error = problem }
        guard let kind else { return }
        let resultsTo: ResultsTo? = switch results {
        case .keep: nil
        case .newChat: .newChat
        case .off: .off
        case .webhook: .webhook(url: url.trimmingCharacters(in: .whitespaces))
        case .channel(let id): .channel(id: id, to: to.trimmingCharacters(in: .whitespaces), accountId: account.nilIfEmpty)
        }
        // An untouched schedule is saved back exactly as it was.
        let schedule = when == originalWhen ? task?.schedule ?? when.schedule : when.schedule
        let input = TaskInput(name: name.trimmingCharacters(in: .whitespaces),
                              prompt: task == nil || task?.prompt != nil ? prompt.trimmingCharacters(in: .whitespacesAndNewlines) : nil,
                              schedule: schedule, agent: task?.agent ?? store.creators[safe: creator]?.agent, resultsTo: resultsTo, revision: task?.revision)
        saving = true
        error = nil
        Task {
            do {
                let id = try await store.save(kind, id: task?.taskId, input)
                chats.notice = task == nil ? "\(input.name) is scheduled" : "Saved"
                dismiss()
                saved("\(kind.rawValue):\(id)")
            } catch {
                self.error = error.localizedDescription
            }
            saving = false
        }
    }
}
