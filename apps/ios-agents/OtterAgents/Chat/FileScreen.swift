import QuickLook
import SwiftUI

/** A file an agent linked in a chat, by the link it wrote. */
struct FileLink: Hashable, Identifiable {
    var chatId: String
    var href: String
    var id: String { "\(chatId)\n\(href)" }

    var name: String { (path as NSString).lastPathComponent }
    var path: String { (try? ChatFile.path(href)) ?? href }
    /** The line the link points at (`notes.md:12`). */
    var line: Int? {
        guard let match = href.range(of: ":(\\d+)(?:-\\d+)?$", options: .regularExpression) else { return nil }
        return Int(href[match].dropFirst().prefix { $0.isNumber })
    }
}

extension ChatFile {
    /** How much of a text file is shown. */
    static let textLimit = 1024 * 1024

    private static let textTypes: Set<String> = ["application/json", "application/xml", "application/yaml", "application/x-yaml", "application/javascript",
                                                 "application/typescript", "application/x-sh", "application/toml", "application/sql", "application/x-ndjson"]
    private static let documents: Set<String> = ["pdf", "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "heic", "svg", "doc", "docx", "xls", "xlsx", "ppt",
                                                 "pptx", "pages", "numbers", "key", "rtf", "zip", "mp3", "m4a", "wav", "mp4", "mov"]

    var isMarkdown: Bool { ["md", "markdown", "mdx"].contains((name as NSString).pathExtension.lowercased()) }

    /** Its text, when it is text: what the source view shows. Other files open in Quick Look. */
    var text: String? {
        let type = mimeType.lowercased().split(separator: ";").first.map(String.init) ?? ""
        if Self.documents.contains((name as NSString).pathExtension.lowercased()) { return nil }
        if !type.hasPrefix("text/"), !Self.textTypes.contains(type), type != "application/octet-stream" { return nil }
        return String(data: data.prefix(Self.textLimit), encoding: .utf8)
    }

    /** A copy on this iPhone, for Quick Look and the share sheet. */
    func saved() throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appending(path: "Files/\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appending(path: name.replacingOccurrences(of: "/", with: "-"))
        try data.write(to: url)
        return url
    }
}

/** A file from where the agent runs: its text with line numbers, Markdown as it reads, anything else in Quick Look. */
struct FileScreen: View {
    @Environment(\.palette) private var palette
    @Environment(ChatStore.self) private var store
    let link: FileLink
    @State private var file: ChatFile?
    @State private var failure: String?
    @State private var local: URL?
    @State private var preview: URL?
    @State private var source = false
    @AppStorage("file:wrap") private var wrap = true

    private var chat: Chat? { store.chat(link.chatId) }

    var body: some View {
        Group {
            if let file {
                if let text = file.text {
                    if file.isMarkdown, !source {
                        ScrollView { MarkdownView(source: text).padding(.horizontal, 16).padding(.vertical, 12) }
                    } else {
                        SourceText(text: text, wrap: wrap, line: link.line)
                    }
                } else {
                    document(file)
                }
            } else if let failure {
                ContentUnavailableView("Couldn't open this file", systemImage: "doc.questionmark", description: Text(failure))
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(palette.canvas)
        .safeAreaBar(edge: .top) { if let file, file.text != nil, file.data.count > ChatFile.textLimit { partial } }
        .navigationTitle(link.name)
        .navigationSubtitle(subtitle)
        .toolbarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("File actions", systemImage: "ellipsis") {
                    if let file, let text = file.text {
                        if file.isMarkdown {
                            Picker("View", selection: $source) {
                                Label("Preview", systemImage: "doc.richtext").tag(false)
                                Label("Source", systemImage: "chevron.left.forwardslash.chevron.right").tag(true)
                            }
                        }
                        if !file.isMarkdown || source { Toggle("Word wrap", systemImage: "text.word.spacing", isOn: $wrap) }
                        Divider()
                        Button(file.data.count > ChatFile.textLimit ? "Copy preview" : "Copy contents", systemImage: "doc.on.doc") { UIPasteboard.general.string = text }
                    }
                    Button("Copy path", systemImage: "link") { UIPasteboard.general.string = link.path }
                    if let local { ShareLink("Save or share", item: local) }
                    Divider()
                    Button("Refresh", systemImage: "arrow.clockwise") { Task { await load() } }
                }
            }
        }
        .quickLookPreview($preview)
        .task { await load() }
    }

    private var subtitle: String {
        let folder = (link.path as NSString).deletingLastPathComponent
        let agent = chat.map { store.agents.name(of: $0.provider, agent: store.agents.agent(of: $0)) } ?? ""
        return [agent, (folder as NSString).lastPathComponent].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var partial: some View {
        Text("Partial file. Preview limited to the first 1 MB.")
            .font(.ui(13))
            .foregroundStyle(palette.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(palette.card)
    }

    private func document(_ file: ChatFile) -> some View {
        Button { preview = local } label: {
            HStack(spacing: 12) {
                Image(systemName: "doc")
                    .font(.system(size: 20))
                    .foregroundStyle(palette.muted)
                    .frame(width: 40, height: 48)
                    .background(palette.text.opacity(0.07), in: .rect(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 2) {
                    Text(file.name).font(.ui(15, .medium)).foregroundStyle(palette.text).lineLimit(1)
                    Text("\((file.name as NSString).pathExtension.uppercased()) · \(ChatText.size(file.data.count))").font(.ui(13)).foregroundStyle(palette.muted)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(palette.muted.opacity(0.5))
            }
            .padding(12)
            .frame(width: 280)
            .background(palette.card, in: .rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(palette.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func load() async {
        guard let chat else { return }
        failure = nil
        do {
            let loaded = try await store.file(link.href, in: chat)
            local = try? loaded.saved()
            let first = file == nil
            file = loaded
            // A document opens at once, as tapping it in the list would.
            if first, loaded.text == nil { preview = local }
        } catch {
            if file == nil { failure = error.localizedDescription }
        }
    }
}

/** A text file as it is: a line each, numbered, the one a link named marked. */
private struct SourceText: View {
    @Environment(\.palette) private var palette
    let text: String
    let wrap: Bool
    let line: Int?

    var body: some View {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        let gutter = CGFloat(String(lines.count).count) * 7.5 + 12
        ScrollViewReader { reader in
            ScrollView(wrap ? .vertical : [.vertical, .horizontal]) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(lines.enumerated()), id: \.offset) { index, content in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text("\(index + 1)")
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(palette.muted.opacity(0.7))
                                .frame(width: gutter, alignment: .trailing)
                            Text(content.isEmpty ? " " : String(content))
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(palette.text)
                                .fixedSize(horizontal: !wrap, vertical: true)
                                .textSelection(.enabled)
                        }
                        .padding(.vertical, 1.5)
                        .padding(.trailing, 14)
                        .frame(maxWidth: wrap ? .infinity : nil, alignment: .leading)
                        .background(index + 1 == line ? palette.focus.opacity(0.1) : .clear)
                        .id(index + 1)
                    }
                }
                .padding(.vertical, 10)
            }
            .onAppear { if let line { reader.scrollTo(line, anchor: .center) } }
        }
    }
}
