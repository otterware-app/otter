import NaturalLanguage
import QuickLook
import SwiftUI
@preconcurrency import Translation

/**
 * One message of a conversation. Folded, it's who and a line of it; open,
 * the whole message, translated when it's in a language the user doesn't
 * read and Settings › Translate automatically is on (Apple's on-device
 * Translation, as on the Mac). Its text selects as anywhere in iOS; the
 * whole message's Translate and Copy are on its header.
 */
struct MessageView: View {
    /** The reader's side inset; Settings › Full-width messages takes it off the content. */
    static let inset: CGFloat = 20

    @Environment(Preferences.self) private var preferences
    @Environment(MailStore.self) private var store
    @Environment(\.palette) private var palette

    let message: Message
    let mailbox: Mailbox
    let open: Bool
    let onTap: () -> Void

    @State private var showTranslation = false
    @State private var translated: String?
    @State private var showOriginal = false
    @State private var translation: TranslationSession.Configuration?
    @State private var preview: URL?
    @State private var showQuote = false
    @State private var opening: String?
    @State private var sharing: SharedFile?
    @State private var attachmentError: String?

    var body: some View {
        let fullWidth = preferences.fullWidthMessages
        VStack(alignment: .leading, spacing: 12) {
            header
                .padding(.horizontal, Self.inset)
                .contentShape(.rect)
                .onTapGesture(perform: onTap)
                .contextMenu {
                    Button("Translate", systemImage: "translate") { showTranslation = true }
                    Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = message.text }
                }

            if open {
                if let translated, !showOriginal {
                    SelectableText(text: translated)
                        .padding(.horizontal, fullWidth ? 0 : Self.inset)
                } else if let html = message.html {
                    HTMLBody(html: html, inline: message.inline ?? [], cornerRadius: fullWidth ? 0 : 14) { image in
                        await store.sync?.inlineImage(image, of: message, in: mailbox.email)
                    }
                    .padding(.horizontal, fullWidth ? 0 : Self.inset)
                } else {
                    let (body, quote) = Quote.split(message.text)
                    SelectableText(text: showQuote ? message.text : body)
                        .padding(.horizontal, fullWidth ? 0 : Self.inset)
                    if quote != nil && !showQuote {
                        Button("Show quoted text", systemImage: "ellipsis") { showQuote = true }
                            .labelStyle(.iconOnly)
                            .font(.inter(.footnote).weight(.bold))
                            .foregroundStyle(palette.muted)
                            .frame(width: 36, height: 22)
                            .background(palette.surface, in: .capsule)
                            .overlay(Capsule().strokeBorder(palette.border))
                            .padding(.horizontal, Self.inset)
                    }
                }

                if translated != nil {
                    Button(showOriginal ? "Show translation" : "Translated · Show original") {
                        showOriginal.toggle()
                    }
                    .font(.inter(.footnote))
                    .foregroundStyle(palette.muted)
                    .padding(.horizontal, Self.inset)
                }

                if !message.attachments.isEmpty {
                    ScrollView(.horizontal) {
                        HStack(spacing: 8) {
                            ForEach(Array(message.attachments.enumerated()), id: \.offset) { _, attachment in
                                Button { open(attachment) } label: {
                                    AttachmentChip(attachment: attachment, loading: opening == attachment.filename)
                                }
                                .buttonStyle(.plain)
                                .disabled(attachment.id == nil || opening != nil)
                                .contextMenu {
                                    Button("Share or Save", systemImage: "square.and.arrow.up") { open(attachment, share: true) }
                                }
                            }
                        }
                    }
                    .scrollIndicators(.hidden)
                    .contentMargins(.horizontal, Self.inset, for: .scrollContent)
                }
            }
        }
        .quickLookPreview($preview)
        .sheet(item: $sharing) { file in FileShare(url: file.url) }
        .alert("Couldn't open attachment", isPresented: Binding(get: { attachmentError != nil }, set: { if !$0 { attachmentError = nil } })) {
            Button("OK") { attachmentError = nil }
        } message: { Text(attachmentError ?? "") }
        .translationPresentation(isPresented: $showTranslation, text: message.text)
        .translationTask(translation) { session in
            translated = try? await session.translate(message.text).targetText
        }
        .task(id: open && preferences.autoTranslate) {
            guard open, preferences.autoTranslate, message.html == nil, translated == nil else { return }
            let recognizer = NLLanguageRecognizer()
            recognizer.processString(message.text)
            guard let language = recognizer.dominantLanguage?.rawValue else { return }
            let read = preferences.effectiveReadLanguages
            guard !read.contains(where: { $0.hasPrefix(language) }), let target = read.first else { return }
            translation = .init(source: Locale.Language(identifier: language), target: Locale.Language(identifier: target))
        }
    }

    /** Downloads the file from Gmail and shows it in Quick Look. */
    private func open(_ attachment: Attachment, share: Bool = false) {
        guard opening == nil else { return }
        opening = attachment.filename
        Task {
            do {
                let url = try await store.attachmentURL(attachment, of: message, in: mailbox.email)
                if share { sharing = SharedFile(url: url) } else { preview = url }
            } catch { attachmentError = error.localizedDescription }
            opening = nil
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            SenderAvatar(person: message.from, size: 34)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(message.from.isAddress(mailbox.email) ? "Me" : message.from.label)
                        .font(.inter(.subheadline).weight(.semibold))
                        .foregroundStyle(palette.text)
                        .lineLimit(1)
                    if message.draft {
                        Text("Draft")
                            .font(.inter(.subheadline))
                            .foregroundStyle(palette.error)
                    }
                    Spacer()
                    Text(RelativeTime.short(message.date))
                        .font(.inter(.footnote))
                        .foregroundStyle(palette.muted)
                        .monospacedDigit()
                }
                Text(open ? recipients : message.snippet)
                    .font(.inter(.subheadline))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
            }
        }
    }

    private var recipients: String {
        let name = { (p: Person) in p.isAddress(mailbox.email) ? "me" : p.label }
        let to = "to " + message.to.map(name).joined(separator: ", ")
        return message.cc.isEmpty ? to : "\(to), cc \(message.cc.map(name).joined(separator: ", "))"
    }
}

/** A file on a message: its kind, name and size, compact (the desktop's attachment chip). */
struct AttachmentChip: View {
    @Environment(\.palette) private var palette
    let attachment: Attachment
    var loading = false

    var body: some View {
        HStack(spacing: 10) {
            Group {
                if loading { ProgressView() } else { Image(systemName: symbol) }
            }
            .font(.system(size: 18))
            .foregroundStyle(palette.muted)
            .frame(width: 32, height: 32)
            .background(palette.surface, in: .rect(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 1) {
                Text(attachment.filename)
                    .font(.inter(.subheadline).weight(.medium))
                    .foregroundStyle(palette.text)
                    .lineLimit(1)
                Text(ByteCountFormatStyle().format(Int64(attachment.size)))
                    .font(.inter(.caption))
                    .foregroundStyle(palette.muted)
            }
        }
        .padding(6)
        .padding(.trailing, 8)
        .frame(maxWidth: 240, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(palette.border))
    }

    private var symbol: String {
        switch attachment.mimeType {
        case let type where type.hasPrefix("image/"): "photo"
        case "application/pdf": "doc.richtext"
        case "text/calendar": "calendar"
        case "text/csv": "tablecells"
        default: "doc"
        }
    }
}

/**
 * A plain-text body in UIKit's text view, which selects like Mail: hold to
 * pick a word, drag the handles, then Copy, Translate or Share. (SwiftUI's
 * selectable Text only copies all of it.)
 */
private struct SelectableText: UIViewRepresentable {
    @Environment(\.palette) private var palette
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let text: String

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        // Setting the text again would drop the user's selection.
        let shown = Shown(text: text, color: palette.text, size: dynamicTypeSize)
        guard context.coordinator.shown != shown else { return }
        context.coordinator.shown = shown
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 4
        view.attributedText = NSAttributedString(string: text, attributes: [
            .font: UIFont.inter(.callout),
            .foregroundColor: UIColor(palette.text),
            .paragraphStyle: paragraph,
        ])
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width else { return nil }
        return CGSize(width: width, height: ceil(uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height))
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var shown: Shown?
    }

    nonisolated struct Shown: Equatable {
        let text: String
        let color: Color
        let size: DynamicTypeSize
    }
}

private struct SharedFile: Identifiable {
    let id = UUID()
    let url: URL
}

/** The native share sheet includes Save to Files, AirDrop, and installed destinations. */
private struct FileShare: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
