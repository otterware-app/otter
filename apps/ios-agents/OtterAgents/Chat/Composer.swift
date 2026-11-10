import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/**
 * Where you write: Otter Code's glass pill, one row until the text wraps, then the text above
 * its controls. What a message carries (files, quotes, a skill) rides above the text.
 */
struct Composer: View {
    @Environment(\.palette) private var palette
    @Environment(ChatStore.self) private var store
    let chat: Chat
    var focused: FocusState<Bool>.Binding
    var onSent: () -> Void = {}

    @State private var skill: Skill?
    @State private var skills: [Skill] = []
    @State private var attachments: [Attachment] = []
    @State private var expanded = false
    @State private var showModels = false
    @State private var pickingPhotos = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var pickingFiles = false
    @State private var takingPhoto = false
    @State private var commenting: ChatCitation?
    @State private var comment = ""

    private var agents: Agents { store.agents }
    private var kind: AgentKind? { AgentKind(rawValue: chat.provider) }
    private var running: Bool { store.runs[chat.id] != nil }
    private var editing: Bool { store.editingQueued?.chatId == chat.id }
    private var citations: [ChatCitation] { store.citations[chat.id] ?? [] }
    private var draft: String { store.drafts[chat.id] ?? "" }
    private var hasContent: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || skill != nil || !attachments.isEmpty || !citations.isEmpty
    }
    private var steers: Bool { kind?.steers == true && attachments.isEmpty && !store.isCompacting(chat.id) }
    private var wantsSteer: Bool { store.agents.followUp == .steer && steers }
    private var carries: Bool { skill != nil || !attachments.isEmpty || !citations.isEmpty || editing }

    /** The skills a `/` at the start is choosing among. */
    private var matching: [Skill] {
        guard skill == nil, draft.hasPrefix("/"), !draft.contains(" "), !draft.contains("\n") else { return [] }
        let query = draft.dropFirst().lowercased()
        return Array(skills.filter { query.isEmpty || $0.name.lowercased().contains(query) }.prefix(8))
    }

    var body: some View {
        VStack(spacing: 7) {
            if !matching.isEmpty { skillMenu }
            VStack(alignment: .leading, spacing: 0) {
                if carries { carried }
                editor
            }
            .glassEffect(.regular, in: .rect(cornerRadius: 27))
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 6)
        .animation(.easeOut(duration: 0.22), value: expanded)
        .animation(.easeOut(duration: 0.18), value: carries)
        .sheet(isPresented: $showModels) { ModelSheet(chat: chat) }
        .photosPicker(isPresented: $pickingPhotos, selection: $photos, maxSelectionCount: Attachment.maxCount, matching: .images)
        .onChange(of: photos) { _, items in
            guard !items.isEmpty else { return }
            photos = []
            Task { for item in items { await add(photo: item) } }
        }
        .fileImporter(isPresented: $pickingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            for url in (try? result.get()) ?? [] { add(file: url) }
        }
        .fullScreenCover(isPresented: $takingPhoto) {
            CameraPicker { image in
                if let data = image.jpegData(compressionQuality: 0.85) { add(name: "Photo.jpg", mime: "image/jpeg", data: data) }
            }
            .ignoresSafeArea()
        }
        .alert("Comment on the quote", isPresented: .constant(commenting != nil)) {
            TextField("Add an optional comment…", text: $comment)
            Button("Cancel", role: .cancel) { commenting = nil }
            Button("Save") {
                if let commenting {
                    store.citations[chat.id] = citations.map { quote in
                        var quote = quote
                        if quote.id == commenting.id { quote.comment = comment.trimmingCharacters(in: .whitespaces).nilIfEmpty }
                        return quote
                    }
                }
                commenting = nil
            }
        }
        .task(id: chat.provider) {
            skills = await kind.asyncMap { await agents.skills(of: $0) } ?? []
        }
        .onChange(of: draft) { _, text in
            // "/name " picks the skill, as picking it from the list does.
            if skill == nil, text.hasPrefix("/"), text.hasSuffix(" "), let named = skills.first(where: { "/\($0.name) " == text }) {
                skill = named
                store.drafts[chat.id] = nil
            }
            if text.isEmpty { expanded = false }
        }
    }

    // MARK: The text and its controls

    private var editor: some View {
        @Bindable var store = store
        let placeholder = skills.isEmpty ? "Ask anything" : "Ask anything, / for skills"
        return TextField(placeholder, text: Binding(get: { store.drafts[chat.id] ?? "" }, set: { store.drafts[chat.id] = $0.isEmpty ? nil : $0 }), axis: .vertical)
            .font(.ui(16))
            .lineLimit(1...(expanded ? 6 : 4))
            .focused(focused)
            .foregroundStyle(palette.text)
            .tint(palette.focus)
            .onGeometryChange(for: Bool.self) { $0.size.height > 30 } action: { tall in if tall { expanded = true } }
            .padding(.leading, expanded ? 16 : (canAttach ? 46 : 18))
            .padding(.trailing, expanded ? 16 : 96)
            .padding(.top, expanded ? 12 : 0)
            .padding(.bottom, expanded ? 50 : 0)
            .frame(minHeight: 50)
            .overlay(alignment: .bottomLeading) { if canAttach { attachButton } }
            .overlay(alignment: .bottomTrailing) {
                HStack(spacing: 0) {
                    modelControl
                    sendButton
                }
                .padding(.trailing, 3)
            }
    }

    private var canAttach: Bool { kind?.attachments == true }

    private var attachButton: some View {
        Menu {
            Button("Photo Library", systemImage: "photo") { pickingPhotos = true }
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button("Take Photo", systemImage: "camera") { takingPhoto = true }
            }
            Button("Choose Files", systemImage: "folder") { pickingFiles = true }
            if UIPasteboard.general.hasImages {
                Button("Paste", systemImage: "doc.on.clipboard") {
                    for image in UIPasteboard.general.images ?? [] {
                        if let data = image.pngData() { add(name: "Pasted image.png", mime: "image/png", data: data) }
                    }
                }
            }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 19))
                .foregroundStyle(palette.text)
                .frame(width: 44, height: 50)
                .contentShape(.rect)
        }
        .accessibilityLabel("Attach files")
    }

    private var modelControl: some View {
        Button { showModels = true } label: {
            HStack(spacing: 5) {
                AgentAvatar(provider: chat.provider, agent: agents.agent(of: chat), size: 18)
                if expanded, let kind {
                    Text(kind == .openclaw ? agents.name(of: chat.provider, agent: agents.agent(of: chat)) : agents.model(of: kind)?.shortName ?? kind.name).font(.ui(14, .medium)).foregroundStyle(palette.text).lineLimit(1)
                    if let traits = agents.traits(of: kind) {
                        Text("· \(traits)").font(.ui(13)).foregroundStyle(palette.muted).lineLimit(1)
                    }
                }
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(palette.muted)
            }
            .padding(.horizontal, 8)
            .frame(height: 50)
            .frame(maxWidth: expanded ? 230 : nil)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Agent and model")
    }

    @ViewBuilder
    private var sendButton: some View {
        if running, !hasContent {
            Button { store.stop(chat.id) } label: {
                Image(systemName: "stop.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(palette.error)
                    .frame(width: 30, height: 30)
                    .background(palette.dangerFill, in: .circle)
                    .frame(width: 44, height: 50)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Stop agent")
        } else {
            let symbol = editing ? "checkmark" : running ? (wantsSteer ? "arrow.turn.left.up" : "list.number") : "arrow.up"
            let label = Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(hasContent ? palette.actionText : palette.text.opacity(0.38))
                .frame(width: 30, height: 30)
                .background(hasContent ? palette.action : palette.text.opacity(0.12), in: .circle)
                .frame(width: 44, height: 50)
                .contentShape(.rect)
            Group {
                if running, !editing, steers {
                    // A menu of the button's own: it opens from where it is, and the keyboard stays.
                    Menu {
                        Button("Queue", systemImage: "list.number") { send(opposite: store.agents.followUp == .steer) }
                        Button("Steer now", systemImage: "arrow.turn.left.up") { send(opposite: store.agents.followUp == .queue) }
                    } label: { label } primaryAction: { send(opposite: false) }
                } else {
                    Button { send(opposite: false) } label: { label }
                }
            }
            .buttonStyle(.plain)
            .disabled(!hasContent)
            .accessibilityLabel(editing ? "Update queued message" : running ? (wantsSteer ? "Steer message" : "Queue message") : "Send message")
        }
    }

    private func send(opposite: Bool) {
        guard hasContent else { return }
        Haptics.tap()
        store.send(draft, in: chat.id, skill: skill, attachments: attachments, opposite: opposite)
        skill = nil
        attachments = []
        expanded = false
        onSent()
    }

    // MARK: What the message carries

    private var carried: some View {
        VStack(alignment: .leading, spacing: 8) {
            if editing {
                HStack {
                    Label("Editing a queued message", systemImage: "pencil").font(.ui(13, .medium)).foregroundStyle(palette.muted)
                    Spacer()
                    Button("Cancel") { store.cancelQueuedEdit() }.font(.ui(13, .semibold)).foregroundStyle(palette.text)
                }
            }
            if !attachments.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 9) {
                        ForEach(attachments) { file in AttachmentTile(file: file) { attachments.removeAll { $0.id == file.id } } }
                    }
                }
                .scrollIndicators(.hidden)
                .scrollClipDisabled()
            }
            if skill != nil || !citations.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 6) {
                        if let skill {
                            chip(symbol: "wrench.and.screwdriver", text: "/\(skill.name)", mono: true) { self.skill = nil }
                        }
                        ForEach(citations) { quote in
                            Button {
                                comment = quote.comment ?? ""
                                commenting = quote
                            } label: {
                                chip(symbol: "text.quote", text: quote.comment.map { "\($0): \(quote.text)" } ?? quote.text, mono: false) {
                                    store.citations[chat.id] = citations.filter { $0.id != quote.id }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 12)
    }

    private func chip(symbol: String, text: String, mono: Bool, remove: @escaping () -> Void) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).font(.system(size: 12)).foregroundStyle(palette.muted)
            Text(text.replacingOccurrences(of: "\n", with: " ")).font(mono ? .mono(13, .medium) : .ui(13)).foregroundStyle(palette.text).lineLimit(1)
            Button("Remove", systemImage: "xmark", action: remove)
                .labelStyle(.iconOnly)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(palette.muted)
                .frame(width: 20, height: 24)
        }
        .padding(.leading, 10)
        .padding(.trailing, 4)
        .frame(height: 30)
        .frame(maxWidth: 240, alignment: .leading)
        .background(palette.text.opacity(0.07), in: .capsule)
    }

    private var skillMenu: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("SKILLS").font(.ui(11, .bold)).kerning(0.8).foregroundStyle(palette.muted).padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 4)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(matching) { skill in
                        Button {
                            self.skill = skill
                            store.drafts[chat.id] = nil
                        } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text("/\(skill.name)").font(.ui(16, .medium)).foregroundStyle(palette.text)
                                if !skill.description.isEmpty {
                                    Text(skill.description).font(.ui(13)).foregroundStyle(palette.muted).lineLimit(1)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 9)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(maxHeight: 180)
            .scrollBounceBehavior(.basedOnSize)
        }
        .glassEffect(.regular, in: .rect(cornerRadius: 16))
    }

    // MARK: Attaching

    private func add(photo: PhotosPickerItem) async {
        guard let data = try? await photo.loadTransferable(type: Data.self) else { return store.notice = "That photo could not be read." }
        let type = photo.supportedContentTypes.first { $0.preferredMIMEType.map(Attachment.imageTypes.contains) == true }
        if let type, let mime = type.preferredMIMEType {
            add(name: "Photo.\(type.preferredFilenameExtension ?? "jpg")", mime: mime, data: data)
        } else if let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.85) {
            // A format agents don't take (HEIC) goes as a JPEG.
            add(name: "Photo.jpg", mime: "image/jpeg", data: jpeg)
        }
    }

    private func add(file url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return store.notice = "'\(url.lastPathComponent)' is empty or could not be read." }
        add(name: url.lastPathComponent, mime: Attachment.mime(of: url), data: data)
    }

    private func add(name: String, mime: String, data: Data) {
        guard attachments.count < Attachment.maxCount else { return store.notice = "You can attach up to 10 files per message." }
        if let problem = Attachment.problem(name: name, mime: mime, size: data.count) { return store.notice = problem }
        var file = Attachment(name: name, mime: mime, data: data)
        if file.isImage, let image = UIImage(data: data) {
            let scale = min(1, 240 / max(image.size.width, image.size.height))
            let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            file.thumb = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }.jpegData(compressionQuality: 0.7)
        }
        attachments.append(file)
    }
}

private struct AttachmentTile: View {
    @Environment(\.palette) private var palette
    let file: Attachment
    let remove: () -> Void

    var body: some View {
        Group {
            if let thumb = file.thumb, let image = UIImage(data: thumb) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                VStack(spacing: 4) {
                    Image(systemName: "doc").font(.system(size: 20)).foregroundStyle(palette.muted)
                    Text(file.name).font(.ui(11)).foregroundStyle(palette.text).lineLimit(1).padding(.horizontal, 6)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(palette.text.opacity(0.07))
            }
        }
        .frame(width: 72, height: 72)
        .clipShape(.rect(cornerRadius: 16))
        .overlay(alignment: .topTrailing) {
            Button("Remove \(file.name)", systemImage: "xmark", action: remove)
                .labelStyle(.iconOnly)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 22, height: 22)
                .background(.black.opacity(0.55), in: .circle)
                .padding(4)
        }
        .accessibilityLabel("\(file.name), \(file.kindLabel)")
    }
}

private struct CameraPicker: UIViewControllerRepresentable {
    @Environment(\.dismiss) private var dismiss
    let taken: (UIImage) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.taken(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}

extension Optional {
    func asyncMap<T>(_ transform: (Wrapped) async -> T) async -> T? {
        if let self { await transform(self) } else { nil }
    }
}
