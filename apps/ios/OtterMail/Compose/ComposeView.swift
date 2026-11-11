import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct ComposeView: View {
    @Environment(MailStore.self) private var store
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    @State private var draft: Draft
    @State private var initialDraft: Draft
    @State private var showCc = false
    @State private var showBcc = false
    @State private var confirmClose = false
    @State private var sending = false
    @State private var importing = false
    @State private var finished = false
    @State private var hadRecovery = false
    @State private var error: String?
    @State private var recoveryError: String?
    @State private var filePicker = false
    @State private var photos: [PhotosPickerItem] = []
    @FocusState private var bodyFocused: Bool
    @State private var selection: TextSelection? = TextSelection(insertionPoint: "".startIndex)

    init(draft: Draft) {
        _draft = State(initialValue: draft)
        _initialDraft = State(initialValue: draft)
    }

    private var needsCloseConfirmation: Bool {
        draft != initialDraft && (!draft.isEmpty || draft.messageID != nil)
    }
    private var recipients: Set<String> { Set([draft.to, draft.cc, draft.bcc].flatMap(Draft.people).map { $0.email.lowercased() }) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    fields
                    TextField("Subject", text: $draft.subject, axis: .vertical)
                        .font(.inter(.title2).weight(.semibold))
                        .foregroundStyle(palette.text)
                        .padding(.top, 20).padding(.bottom, 10)
                    TextField("Message", text: $draft.body, selection: $selection, axis: .vertical)
                        .focused($bodyFocused)
                        .font(.inter(.body)).foregroundStyle(palette.text).lineSpacing(3)
                        .frame(maxWidth: .infinity, minHeight: 220, alignment: .topLeading)
                    attachments
                    if let recoveryError {
                        Text(recoveryError).font(.inter(.footnote)).foregroundStyle(palette.error).padding(.top, 12)
                    } else if store.recoveredDrafts.contains(where: { $0.id == draft.id }) {
                        Label("Saved on this iPhone", systemImage: "checkmark")
                            .font(.inter(.footnote)).foregroundStyle(palette.muted).padding(.top, 12)
                    }
                }
                .padding(.horizontal, 20)
                .disabled(sending)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(palette.canvas)
            .navigationTitle(draft.threadID == nil ? "New message" : "Reply")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") {
                        if needsCloseConfirmation { confirmClose = true } else { dismiss() }
                    }
                    .disabled(sending || importing)
                    .confirmationDialog("Keep this message?", isPresented: $confirmClose) {
                        Button("Save to Drafts") { save() }
                        Button("Keep on This iPhone") {
                            if persist() { finished = true; dismiss() }
                        }
                        Button("Delete Draft", role: .destructive) {
                            finished = true
                            let draft = draft
                            dismiss()
                            Task { await store.discard(draft) }
                        }
                    }
                }
                if MailContext.agentsInstalled, let context = MailContext(draft) {
                    ToolbarItem(placement: .topBarTrailing) { SendToAgent(mail: [context]) }
                    ToolbarSpacer(.fixed, placement: .topBarTrailing)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button { send() } label: {
                        if sending { ProgressView() }
                        else { Image(systemName: "arrow.up").foregroundStyle(palette.actionText) }
                    }
                    .accessibilityLabel("Send")
                    .buttonStyle(.glassProminent)
                    .disabled(!draft.canSend || sending || importing)
                }
            }
            .onAppear {
                selection = TextSelection(insertionPoint: draft.body.startIndex)
                bodyFocused = !draft.to.isEmpty
                hadRecovery = store.recoveredDrafts.contains { $0.id == draft.id }
            }
        }
        .interactiveDismissDisabled(needsCloseConfirmation || sending || importing)
        .onChange(of: draft) { _, _ in
            guard !finished else { return }
            if draft != initialDraft || hadRecovery { _ = persist() }
            else { store.removeRecovery(draft) }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active && !finished && draft != initialDraft { _ = persist() }
        }
        .fileImporter(isPresented: $filePicker, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls): importFiles(urls)
            case .failure(let failure): error = failure.localizedDescription
            }
        }
        .onChange(of: photos) { _, items in
            guard !items.isEmpty else { return }
            importing = true
            Task {
                do {
                    for item in items {
                        guard let data = try await item.loadTransferable(type: Data.self) else { throw DraftFile.Failure.unavailable }
                        guard draft.files.reduce(0, { $0 + $1.size }) + data.count <= DraftFile.limit else { throw DraftFile.Failure.tooLarge }
                        let type = item.supportedContentTypes.first ?? .image
                        let file = try await Task.detached {
                            try DraftFile.imported(data, filename: "Photo-\(UUID().uuidString.prefix(8)).\(type.preferredFilenameExtension ?? "jpg")", mimeType: type.preferredMIMEType ?? "image/jpeg")
                        }.value
                        draft.files.append(file)
                    }
                } catch { self.error = error.localizedDescription }
                photos = []
                importing = false
            }
        }
        .alert("Couldn't finish", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            Button("OK") { error = nil }
        } message: { Text(error ?? "") }
    }

    private var fields: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                Text("From").foregroundStyle(palette.muted).frame(width: 44, alignment: .leading)
                let senders = senders
                if senders.count > 1 {
                    Picker("From", selection: Binding(get: { sender(in: senders) }, set: pick)) {
                        let mailboxes = senders.map(\.mailbox).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
                        if mailboxes.count > 1 {
                            ForEach(mailboxes, id: \.self) { mailbox in
                                Section(store.mailbox(mailbox)?.displayName ?? mailbox) {
                                    ForEach(senders.filter { $0.mailbox == mailbox }, id: \.self) { Text($0.address).tag($0) }
                                }
                            }
                        } else {
                            ForEach(senders, id: \.self) { Text($0.address).tag($0) }
                        }
                    }
                    .labelsHidden().tint(palette.text).padding(.leading, -11)
                } else { Text(draft.address ?? draft.from).foregroundStyle(palette.text) }
                Spacer()
            }.frame(minHeight: 46)
            Divider().overlay(palette.border)
            RecipientField("To", value: $draft.to, from: draft.from, excluded: recipients)
            if showCc || !draft.cc.isEmpty { RecipientField("Cc", value: $draft.cc, from: draft.from, excluded: recipients) }
            if showBcc || !draft.bcc.isEmpty { RecipientField("Bcc", value: $draft.bcc, from: draft.from, excluded: recipients) }
            HStack {
                Spacer()
                if !showCc && draft.cc.isEmpty { Button("Cc") { showCc = true } }
                if !showBcc && draft.bcc.isEmpty { Button("Bcc") { showBcc = true } }
            }.font(.inter(.subheadline)).foregroundStyle(palette.muted)
        }
    }

    private struct Sender: Hashable {
        var mailbox: String
        var address: String
    }

    private var senders: [Sender] {
        let mailboxes = draft.messageID == nil && draft.threadID == nil ? store.shownMailboxes : store.mailbox(draft.from).map { [$0] } ?? []
        return mailboxes.flatMap { mailbox in store.addresses(of: mailbox.email).map { Sender(mailbox: mailbox.email, address: $0) } }
    }

    private func sender(in senders: [Sender]) -> Sender {
        let picked = Sender(mailbox: draft.from, address: (draft.address ?? draft.from).lowercased())
        return senders.contains(picked) ? picked : Sender(mailbox: draft.from, address: draft.from.lowercased())
    }

    /** A signature not in the body yet goes where `Draft.new` puts it, while the body is untouched. */
    private func pick(_ sender: Sender) {
        let before = Signature.plainText(store.signature(of: draft))
        draft.from = sender.mailbox
        draft.address = sender.address == sender.mailbox.lowercased() ? nil : sender.address
        let after = Signature.plainText(store.signature(of: draft))
        guard before != after else { return }
        if !before.isEmpty, let range = draft.body.range(of: before) {
            draft.body.replaceSubrange(range, with: after)
        } else if before.isEmpty, draft.body == initialDraft.body {
            draft.body = "\n\n\(after)" + draft.body
        }
    }

    private var attachments: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(draft.files) { file in
                HStack {
                    AttachmentChip(attachment: file.attachment)
                    Spacer()
                    Button("Remove \(file.filename)", systemImage: "xmark.circle.fill") {
                        draft.files.removeAll { $0.id == file.id }
                    }.labelStyle(.iconOnly).foregroundStyle(palette.muted)
                }
            }
            HStack(spacing: 20) {
                Button("Files", systemImage: "paperclip") { filePicker = true }
                PhotosPicker(selection: $photos, maxSelectionCount: 10, matching: .images) {
                    Label("Photos", systemImage: "photo")
                }
                if importing { ProgressView() }
            }
            .font(.inter(.subheadline)).foregroundStyle(palette.text)
            .disabled(importing)
            .padding(.vertical, 10)
        }
    }

    @discardableResult
    private func persist() -> Bool {
        do { try store.saveRecovery(draft); recoveryError = nil; return true }
        catch { recoveryError = "Couldn't save a recovery copy: \(error.localizedDescription)"; return false }
    }

    private func save() {
        sending = true
        Task {
            do { try await store.save(draft); finished = true; dismiss() }
            catch { self.error = error.localizedDescription }
            sending = false
        }
    }

    private func send() {
        sending = true
        Task {
            do { try await store.send(draft); finished = true; dismiss() }
            catch { self.error = error.localizedDescription }
            sending = false
        }
    }

    private func importFiles(_ urls: [URL]) {
        importing = true
        Task {
            do {
                for url in urls {
                    let remaining = DraftFile.limit - draft.files.reduce(0) { $0 + $1.size }
                    let file = try await Task.detached { try DraftFile.imported(url, remaining: remaining) }.value
                    draft.files.append(file)
                }
            } catch { self.error = error.localizedDescription }
            importing = false
        }
    }
}
