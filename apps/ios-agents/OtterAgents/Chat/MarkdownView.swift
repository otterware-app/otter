import SwiftUI
import UIKit

/**
 * What a tap on a link in a chat does, and what "Quote" on a selection does. Equal for the same
 * chat with the same abilities: closures never compare equal, and a new set each time the screen
 * redraws would redraw every bubble that reads them. The actions look the chat up when they run.
 */
struct ChatTextActions: Equatable {
    var chatId = ""
    var open: (URL) -> Void = { _ in }
    /** Nil where nothing can be quoted (a chat that only reads here). Who said it comes second. */
    var quote: ((String, String?) -> Void)?
    /** Reads an image the agent linked from where it runs; nil where this iPhone can't. */
    var image: ((String) async -> UIImage?)?

    static func == (a: Self, b: Self) -> Bool {
        a.chatId == b.chatId && (a.quote == nil) == (b.quote == nil) && (a.image == nil) == (b.image == nil)
    }
}

extension EnvironmentValues {
    @Entry var chatText = ChatTextActions()
    /** What "Find in chat" looks for, to mark where it is. */
    @Entry var chatFind = ""
    /** Who said the text around: "You", or the agent's name, for a quote's reply bar. */
    @Entry var quoteFrom: String?
}

struct MarkdownView: View {
    @Environment(\.palette) private var palette
    let segments: [[Markdown.Block]]
    var muted = false
    /** Room kept at the end of the last line for the time over it. */
    var reserve: String?

    init(source: String, muted: Bool = false) {
        segments = Markdown.segments(source)
        self.muted = muted
    }

    init(blocks: [Markdown.Block], reserve: String? = nil) {
        segments = Markdown.group(blocks)
        self.reserve = reserve
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(segments.enumerated()), id: \.offset) { index, segment in
                switch segment[0] {
                case .code(let language, let code): CodeBlock(language: language, code: code)
                case .table(let header, let rows): TableBlock(header: header, rows: rows)
                case .rule: Rectangle().fill(palette.hairline).frame(height: 1).padding(.vertical, 4)
                case .image(let alt, let url): ChatImage(alt: alt, url: url)
                case .quote(let text):
                    HStack(alignment: .top, spacing: 12) {
                        RoundedRectangle(cornerRadius: 1).fill(palette.border).frame(width: 2)
                        MarkdownText(blocks: [.paragraph(text)], muted: true)
                    }
                default: MarkdownText(blocks: segment, muted: muted, reserve: index == segments.count - 1 ? reserve : nil)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/** A run of text blocks as one selectable piece. */
struct MarkdownText: View {
    @Environment(\.palette) private var palette
    @Environment(\.chatFind) private var find
    @Environment(\.dynamicTypeSize) private var typeSize
    let blocks: [Markdown.Block]
    var muted = false
    var reserve: String?

    var body: some View {
        SelectableText(text: Self.cached(blocks, palette: palette, muted: muted, find: find, reserve: reserve, typeSize: typeSize))
            .id(typeSize)
    }

    private struct Key: Hashable {
        let blocks: [Markdown.Block]
        let muted: Bool
        let find: String
        let reserve: String?
        let typeSize: DynamicTypeSize
        let colors: [Color]
    }

    /** Text already styled: a bubble drawn again (scrolled back to) doesn't parse its Markdown again. */
    private static var styled: [Key: NSAttributedString] = [:]

    private static func cached(_ blocks: [Markdown.Block], palette: Palette, muted: Bool, find: String, reserve: String?,
                               typeSize: DynamicTypeSize) -> NSAttributedString {
        let key = Key(blocks: blocks, muted: muted, find: find, reserve: reserve, typeSize: typeSize,
                      colors: [palette.text, palette.muted, palette.focus, palette.warning])
        if let text = styled[key] { return text }
        let text = attributed(blocks, palette: palette, muted: muted, find: find, reserve: reserve)
        if styled.count > 1000 { styled.removeAll() }
        styled[key] = text
        return text
    }

    static func attributed(_ blocks: [Markdown.Block], palette: Palette, muted: Bool, find: String, reserve: String? = nil) -> NSAttributedString {
        let out = NSMutableAttributedString()
        let color = UIColor(muted ? palette.muted : palette.text)
        for (index, block) in blocks.enumerated() {
            let last = index == blocks.count - 1
            let style = NSMutableParagraphStyle()
            let size: CGFloat
            var weight = UIFont.Weight.regular
            var text: String
            switch block {
            case .heading(let level, let words):
                size = [21, 19, 17, 15][min(level, 4) - 1]
                weight = .semibold
                text = words
                style.paragraphSpacingBefore = index == 0 ? 0 : 6
                style.paragraphSpacing = last ? 0 : 8
            case .item(let marker, let depth, let task, let words):
                size = 16
                let bullet = task.map { $0 ? "☑" : "☐" } ?? marker
                let inset = CGFloat(depth) * 18
                let hang: CGFloat = marker == "•" || task != nil ? 20 : 26
                style.firstLineHeadIndent = inset
                style.headIndent = inset + hang
                style.tabStops = [NSTextTab(textAlignment: .left, location: inset + hang)]
                text = "\(bullet)\t\(words.replacingOccurrences(of: "\n", with: " "))"
                if case .item? = blocks.dropFirst(index + 1).first { style.paragraphSpacing = 5 } else { style.paragraphSpacing = last ? 0 : 12 }
            case .paragraph(let words):
                size = 16
                text = words
                style.paragraphSpacing = last ? 0 : 12
            default:
                continue
            }
            let font = UIFont.ui(size, weight)
            let line = (size * 1.42).rounded()
            style.minimumLineHeight = line
            style.maximumLineHeight = line
            let piece = inline(text, font: font, color: color, palette: palette)
            piece.addAttributes([.paragraphStyle: style, .baselineOffset: (line - font.lineHeight) / 4], range: NSRange(location: 0, length: piece.length))
            out.append(piece)
            if !last { out.append(NSAttributedString(string: "\n", attributes: [.font: font, .paragraphStyle: style])) }
        }
        if let reserve {
            // WhatsApp's way of fitting the time in: clear text as wide as it, on the last line when there's room.
            out.append(NSAttributedString(string: "\u{2002}" + reserve.replacingOccurrences(of: " ", with: "\u{00A0}"), attributes: [.font: UIFont.ui(12), .foregroundColor: UIColor.clear]))
        }
        mark(find, in: out, palette: palette)
        return out
    }

    /** Bold, italic, code, strikethrough and links, from the system's inline Markdown. */
    static func inline(_ text: String, font: UIFont, color: UIColor, palette: Palette) -> NSMutableAttributedString {
        let out = NSMutableAttributedString()
        guard let parsed = try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) else {
            return NSMutableAttributedString(string: text, attributes: [.font: font, .foregroundColor: color])
        }
        for run in parsed.runs {
            var attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
            let intent = run.inlinePresentationIntent ?? []
            if intent.contains(.code) {
                attributes[.font] = UIFont.monospacedSystemFont(ofSize: font.pointSize * 0.9, weight: .regular)
                attributes[.foregroundColor] = UIColor(palette.muted)
            } else if intent.contains(.stronglyEmphasized) {
                attributes[.font] = UIFont.ui(font.pointSize / UIFontMetrics(forTextStyle: .body).scaledValue(for: 1), .semibold)
            }
            if intent.contains(.emphasized), let upright = attributes[.font] as? UIFont {
                // Inter has no italic of its own here: its letters, slanted.
                attributes[.font] = UIFont(descriptor: upright.fontDescriptor.withMatrix(CGAffineTransform(a: 1, b: 0, c: 0.2, d: 1, tx: 0, ty: 0)), size: upright.pointSize)
            }
            if intent.contains(.strikethrough) { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
            if let link = run.link {
                attributes[.link] = link
                attributes[.foregroundColor] = UIColor(palette.focus)
            }
            out.append(NSAttributedString(string: String(parsed[run.range].characters), attributes: attributes))
        }
        return out
    }

    static func mark(_ find: String, in text: NSMutableAttributedString, palette: Palette) {
        let needle = find.trimmingCharacters(in: .whitespaces)
        guard needle.count > 1 else { return }
        let string = text.string as NSString
        var range = NSRange(location: 0, length: string.length)
        while true {
            let found = string.range(of: needle, options: [.caseInsensitive, .diacriticInsensitive], range: range)
            guard found.location != NSNotFound else { break }
            text.addAttribute(.backgroundColor, value: UIColor(palette.warning).withAlphaComponent(0.35), range: found)
            range = NSRange(location: found.upperBound, length: string.length - found.upperBound)
        }
    }
}

/**
 * Text you can select a part of: a word, a sentence, any range across its paragraphs, with
 * Quote beside Copy where the chat takes quotes. Its links open through the chat.
 */
struct SelectableText: UIViewRepresentable {
    @Environment(\.chatText) private var actions
    @Environment(\.quoteFrom) private var from
    let text: NSAttributedString

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView(usingTextLayoutManager: true)
        view.isEditable = false
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.required, for: .vertical)
        view.delegate = context.coordinator
        view.linkTextAttributes = [:]
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        let coordinator = context.coordinator
        coordinator.actions = actions
        coordinator.from = from
        // Against what was set, not `view.attributedText`: TextKit adds its own attributes (fonts
        // for what Inter lacks), so that never equals the text, and each set lays it out again.
        guard coordinator.text != text else { return }
        view.attributedText = text
        coordinator.text = text
        coordinator.measured = nil
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width.isFinite, width > 0 else { return nil }
        if let measured = context.coordinator.measured, measured.width == width { return measured.size }
        let fitted = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        let size = CGSize(width: min(width, fitted.width.rounded(.up)), height: fitted.height.rounded(.up))
        context.coordinator.measured = (width, size)
        return size
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var actions = ChatTextActions()
        var from: String?
        var text: NSAttributedString?
        /** The size at the last width asked: measuring lays the whole text out, and a layout pass asks more than once. */
        var measured: (width: CGFloat, size: CGSize)?

        func textView(_ textView: UITextView, primaryActionFor textItem: UITextItem, defaultAction: UIAction) -> UIAction? {
            guard case .link(let url) = textItem.content else { return defaultAction }
            return UIAction { [actions] _ in actions.open(url) }
        }

        func textView(_ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
            guard let quote = actions.quote, range.length > 0 else { return nil }
            let selected = (textView.text as NSString).substring(with: range)
            let action = UIAction(title: "Reply", image: UIImage(systemName: "arrowshape.turn.up.left")) { [from] _ in
                quote(selected, from)
                textView.selectedRange = NSRange(location: range.upperBound, length: 0)
            }
            return UIMenu(children: [action] + suggestedActions)
        }
    }
}

struct CodeBlock: View {
    @Environment(\.palette) private var palette
    let language: String?
    let code: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language ?? "code").font(.mono(11)).foregroundStyle(palette.muted)
                Spacer()
                Button(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc") {
                    UIPasteboard.general.string = code
                    copied = true
                    Haptics.done()
                    Task {
                        try? await Task.sleep(for: .seconds(1.2))
                        copied = false
                    }
                }
                .labelStyle(.iconOnly)
                .font(.system(size: 12))
                .foregroundStyle(palette.muted)
                .frame(width: 28, height: 24)
            }
            .padding(.leading, 12)
            .padding(.trailing, 4)
            .padding(.top, 4)
            ScrollView(.horizontal) {
                Text(code)
                    .font(.mono(13.5))
                    .foregroundStyle(palette.text)
                    .textSelection(.enabled)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 12)
                    .padding(.top, 2)
            }
            .scrollIndicators(.hidden)
        }
        .background(palette.card, in: .rect(cornerRadius: 8))
        .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(palette.hairline, lineWidth: 1) }
    }
}

struct TableBlock: View {
    @Environment(\.palette) private var palette
    @Environment(\.dynamicTypeSize) private var typeSize
    let header: [String]
    let rows: [[String]]

    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(header.enumerated()), id: \.offset) { _, cell in self.cell(cell, bold: true) }
                }
                .background(palette.card)
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    Rectangle().fill(palette.hairline).frame(height: 1)
                    GridRow {
                        ForEach(0..<header.count, id: \.self) { column in self.cell(column < row.count ? row[column] : "", bold: false) }
                    }
                }
            }
            .clipShape(.rect(cornerRadius: 8))
            .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(palette.hairline, lineWidth: 1) }
        }
        .scrollIndicators(.hidden)
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
    }

    private struct Key: Hashable {
        let text: String
        let bold: Bool
        let typeSize: DynamicTypeSize
        let colors: [Color]
    }

    /** Cells already styled: parsing a cell's Markdown and converting it for `Text` is slow, and a table has many. */
    private static var styled: [Key: AttributedString] = [:]

    private func styled(_ text: String, bold: Bool) -> AttributedString {
        let key = Key(text: text, bold: bold, typeSize: typeSize, colors: [palette.text, palette.muted, palette.focus])
        if let cell = Self.styled[key] { return cell }
        let cell = AttributedString(MarkdownText.inline(text, font: .ui(14, bold ? .semibold : .regular), color: UIColor(palette.text), palette: palette))
        if Self.styled.count > 2000 { Self.styled.removeAll() }
        Self.styled[key] = cell
        return cell
    }

    private func cell(_ text: String, bold: Bool) -> some View {
        Text(styled(text, bold: bold))
            .font(.ui(14, bold ? .semibold : .regular))
            .foregroundStyle(palette.text)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: 260, alignment: .leading)
    }
}

/** An image an answer shows: one on the web, or one written into the answer. */
private struct ChatImage: View {
    @Environment(\.palette) private var palette
    @Environment(\.chatText) private var actions
    let alt: String
    let url: String
    @State private var read: UIImage?

    var body: some View {
        if url.hasPrefix("data:image/"), let comma = url.firstIndex(of: ","), let data = Data(base64Encoded: String(url[url.index(after: comma)...])),
           let image = UIImage(data: data) {
            Image(uiImage: image).resizable().scaledToFit().clipShape(.rect(cornerRadius: 14)).frame(maxHeight: 320)
                .accessibilityLabel(alt)
        } else if let remote = URL(string: url), remote.scheme?.hasPrefix("http") == true {
            AsyncImage(url: remote) { phase in
                switch phase {
                case .success(let image): image.resizable().scaledToFit().clipShape(.rect(cornerRadius: 14))
                case .failure: label("Couldn't load this image")
                default: label("Loading image…")
                }
            }
            .frame(maxHeight: 320)
            .accessibilityLabel(alt)
        } else if let read {
            Image(uiImage: read).resizable().scaledToFit().clipShape(.rect(cornerRadius: 14)).frame(maxHeight: 320)
                .accessibilityLabel(alt)
        } else {
            // A file where the agent runs: read from there when this iPhone can.
            label(alt.isEmpty ? (url as NSString).lastPathComponent : alt)
                .task(id: url) { read = await actions.image?(url) }
        }
    }

    private func label(_ text: String) -> some View {
        Label(text, systemImage: "photo")
            .font(.ui(14))
            .foregroundStyle(palette.muted)
            .padding(.horizontal, 12)
            .frame(height: 40)
            .background(palette.card, in: .rect(cornerRadius: 10))
    }
}
