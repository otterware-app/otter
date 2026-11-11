import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/**
 * Where you write, laid out as WhatsApp's: ＋ for what a message can carry (its panel takes the
 * keyboard's place), the text in its pill with the agent beside it, and Send. What you reply to
 * rides above, in a bar of its own.
 */
struct Composer: View {
    @Environment(\.palette) private var palette
    @Environment(\.colorScheme) private var scheme
    @Environment(ChatStore.self) private var store
    let chat: Chat
    var focused: FocusState<Bool>.Binding
    /** The panel under ＋ is open: the chat lets the keyboard pass over it, so nothing moves while they swap. */
    @Binding var panel: Bool
    var onSent: () -> Void = {}

    @State private var skill: Skill?
    @State private var skills: [Skill] = []
    @State private var attachments: [Attachment] = []
    @State private var keyboardUp = false
    @State private var showModels = false
    @State private var pickingPhotos = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var pickingFiles = false
    @State private var takingPhoto = false
    /** The keyboard's height when it was last up: the panel under ＋ takes its place, as tall. */
    @AppStorage("keyboard-height") private var keyboardHeight = 336.0

    private var agents: Agents { store.agents }
    private var kind: AgentKind? { AgentKind(rawValue: chat.provider) }
    private var running: Bool { store.runs[chat.id] != nil }
    private var editing: Bool { store.editingQueued?.chatId == chat.id }
    private var citations: [ChatCitation] { store.citations[chat.id] ?? [] }
    private var mail: [MailContext] { store.mail[chat.id] ?? [] }
    private var draft: String { store.drafts[chat.id] ?? "" }
    private var hasContent: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || skill != nil || !attachments.isEmpty || !citations.isEmpty || !mail.isEmpty
    }
    private var steers: Bool { kind != nil && attachments.isEmpty && !store.isCompacting(chat.id) }
    private var wantsSteer: Bool { store.agents.followUp == .steer && steers }
    private var carries: Bool { skill != nil || !attachments.isEmpty || !citations.isEmpty || !mail.isEmpty || editing }

    /** The skills a `/` at the start is choosing among. */
    private var matching: [Skill] {
        guard skill == nil, draft.hasPrefix("/"), !draft.contains(" "), !draft.contains("\n") else { return [] }
        let query = draft.dropFirst().lowercased()
        return Array(skills.filter { query.isEmpty || $0.name.lowercased().contains(query) }.prefix(8))
    }

    var body: some View {
        VStack(spacing: 7) {
            if !matching.isEmpty { skillMenu }
            if carries { carried }
            HStack(alignment: .bottom, spacing: 8) {
                plusButton
                editor
                sendButton
            }
            if panel { attachPanel }
        }
        .padding(.horizontal, 10)
        .padding(.top, 6)
        .padding(.bottom, 6)
        .animation(.easeOut(duration: 0.18), value: carries)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { note in
            keyboardUp = true
            // A hardware keyboard shows only its thin bar: keep the on-screen one's height.
            if let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect, frame.height > 200 { keyboardHeight = frame.height }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardUp = false }
        // The keyboard is all the way up over the panel: the panel can go without the composer moving.
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
            if panel { withTransaction(Transaction(animation: nil)) { panel = false } }
        }
        .onChange(of: focused.wrappedValue) { _, now in
            guard now, panel else { return }
            // No keyboard comes (a hardware one): the panel goes anyway.
            Task {
                try? await Task.sleep(for: .milliseconds(600))
                if focused.wrappedValue, panel, !keyboardUp { withAnimation(.easeOut(duration: 0.22)) { panel = false } }
            }
        }
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
        .task(id: chat.provider) {
            skills = await kind.asyncMap { await agents.skills(of: $0) } ?? []
        }
        .onChange(of: draft) { _, text in
            // "/name " picks the skill, as picking it from the list does.
            if skill == nil, text.hasPrefix("/"), text.hasSuffix(" "), let named = skills.first(where: { "/\($0.name) " == text }) {
                skill = named
                store.drafts[chat.id] = nil
            }
        }
    }

    // MARK: The row

    private var plusButton: some View {
        Button {
            Haptics.tap()
            if panel {
                // The keyboard comes up over the panel; the panel leaves once it's there.
                focused.wrappedValue = true
            } else if keyboardUp {
                // The panel is there before the keyboard leaves, under it, as tall: nothing jumps.
                withTransaction(Transaction(animation: nil)) { panel = true }
                focused.wrappedValue = false
            } else {
                withAnimation(.easeOut(duration: 0.25)) { panel = true }
            }
        } label: {
            Image(systemName: panel ? "keyboard" : "plus")
                .font(.system(size: panel ? 17 : 20))
                .foregroundStyle(palette.text)
                .contentTransition(.symbolEffect(.replace))
                .frame(width: 46, height: 46)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
        .accessibilityLabel(panel ? "Show keyboard" : "Attach and more")
    }

    private var editor: some View {
        @Bindable var store = store
        return HStack(alignment: .bottom, spacing: 0) {
            TextField("Message", text: Binding(get: { store.drafts[chat.id] ?? "" }, set: { store.drafts[chat.id] = $0.isEmpty ? nil : $0 }), axis: .vertical)
                .font(.ui(16))
                .lineSpacing(3)
                .lineLimit(1...6)
                .focused(focused)
                .foregroundStyle(palette.text)
                .tint(palette.focus)
                .padding(.leading, 16)
                .padding(.vertical, 12)
            modelControl
        }
        .frame(minHeight: 46)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 23))
    }

    private var canAttach: Bool { kind?.attachments == true }

    /**
     * A chat not started yet can go to any agent; one under way stays on its agent (two OpenClaw
     * agents aren't interchangeable), and only its model and effort can change, where it has a choice.
     */
    private var choosesModel: Bool {
        guard let kind else { return false }
        if chat.isBlank { return true }
        return kind != .openclaw && (agents.models(of: kind).count > 1 || agents.traits(of: kind) != nil)
    }

    @ViewBuilder
    private var modelControl: some View {
        if choosesModel {
            Button { showModels = true } label: {
                HStack(spacing: 4) {
                    // The agent's mark: which model and effort it runs are a tap away.
                    AgentAvatar(provider: chat.provider, agent: agents.agent(of: chat), size: 18)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(palette.muted)
                }
                .padding(.leading, 6)
                .padding(.trailing, 12)
                .frame(maxWidth: 140, minHeight: 46, alignment: .trailing)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(chat.isBlank ? "Agent and model" : "Model")
        } else {
            Color.clear.frame(width: 12, height: 46)
        }
    }

    @ViewBuilder
    private var sendButton: some View {
        if running, !hasContent {
            Button { store.stop(chat.id) } label: {
                Image(systemName: "stop.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(palette.error)
                    .frame(width: 46, height: 46)
                    .background(palette.dangerFill, in: .circle)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Stop agent")
        } else {
            let symbol = editing ? "checkmark" : running ? (wantsSteer ? "arrow.turn.left.up" : "list.number") : "arrow.up"
            let label = Image(systemName: symbol)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(palette.actionText)
                .frame(width: 46, height: 46)
                .background(palette.action, in: .circle)
                .opacity(hasContent ? 1 : 0.45)
                .contentShape(.circle)
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
        panel = false
        onSent()
    }

    // MARK: The panel under ＋

    private var attachPanel: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 18) {
            if canAttach {
                tile("Photos", "photo.on.rectangle.angled", Color(UIColor.systemBlue)) { pickingPhotos = true }
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    tile("Camera", "camera.fill", palette.text) { takingPhoto = true }
                }
                tile("Document", "doc.fill", Color(UIColor.systemTeal)) { pickingFiles = true }
                if UIPasteboard.general.hasImages {
                    tile("Paste", "doc.on.clipboard.fill", Color(UIColor.systemPurple)) {
                        for image in UIPasteboard.general.images ?? [] {
                            if let data = image.pngData() { add(name: "Pasted image.png", mime: "image/png", data: data) }
                        }
                    }
                }
            }
            if !skills.isEmpty, draft.isEmpty {
                tile("Skills", "wand.and.sparkles", Color(UIColor.systemOrange)) {
                    store.drafts[chat.id] = "/"
                    focused.wrappedValue = true
                }
            }
            if choosesModel {
                tile(chat.isBlank ? "Agent" : "Model", chat.isBlank ? "person.crop.circle.fill" : "cpu", palette.action) { showModels = true }
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 18)
        .frame(height: keyboardHeight - Self.bottomInset - 7, alignment: .top)
        .background(alignment: .top) {
            // Down past the home indicator, as the keyboard goes.
            Color.clear
                .glassEffect(.regular, in: .rect(cornerRadius: 32))
                .frame(height: keyboardHeight - 1)
                .padding(.horizontal, -4)
        }
    }

    private static var bottomInset: CGFloat {
        (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.keyWindow?.safeAreaInsets.bottom ?? 34
    }

    private func tile(_ title: String, _ symbol: String, _ color: Color, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            VStack(spacing: 7) {
                Image(systemName: symbol)
                    .font(.system(size: 24))
                    .foregroundStyle(color)
                    .frame(width: 60, height: 60)
                    .background(palette.incoming(scheme), in: .circle)
                    .overlay { Circle().strokeBorder(palette.hairline, lineWidth: 0.5) }
                Text(title).font(.ui(13)).foregroundStyle(palette.text)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
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
            ForEach(citations) { quote in
                HStack(alignment: .center, spacing: 6) {
                    QuotedReply(text: quote.text, from: quote.from ?? store.agents.name(of: chat.provider, agent: store.agents.agent(of: chat)), lines: 2)
                    Button("Remove reply", systemImage: "xmark") {
                        withAnimation(.easeOut(duration: 0.18)) { store.citations[chat.id] = citations.filter { $0.id != quote.id } }
                    }
                    .labelStyle(.iconOnly)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(palette.muted)
                    .frame(width: 32, height: 32)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
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
            if skill != nil || !mail.isEmpty {
                ScrollView(.horizontal) {
                    HStack(spacing: 6) {
                        ForEach(mail, id: \.self) { about in
                            chip(symbol: about.quote != nil ? "text.quote" : about.kind == "draft" ? "square.and.pencil" : "envelope", text: about.quote ?? about.subject, mono: false) {
                                store.mail[chat.id] = mail.filter { $0 != about }
                            }
                        }
                        if let skill {
                            chip(symbol: "wrench.and.screwdriver", text: "/\(skill.name)", mono: true) { self.skill = nil }
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
        .padding(10)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
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
