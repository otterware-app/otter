import Foundation

/**
 * The Markdown agents write, as far as a chat shows it (the desktop's react-markdown with GFM):
 * headings, paragraphs, lists, quotes, code blocks, tables, rules and images. Text runs join
 * into one piece, so a selection can cross paragraphs; what isn't text stands apart.
 */
nonisolated enum Markdown {
    enum Block: Hashable {
        case heading(Int, String)
        case paragraph(String)
        /** `marker`: "•" or "1.", `depth` from 0; `task`: a checkbox, ticked or not. */
        case item(marker: String, depth: Int, task: Bool?, String)
        case quote(String)
        case code(language: String?, String)
        case table(header: [String], rows: [[String]])
        case rule
        case image(alt: String, url: String)

        var isText: Bool {
            switch self {
            case .heading, .paragraph, .item: true
            default: false
            }
        }
    }

    /** Runs of text blocks, and each other block on its own. */
    static func segments(_ source: String) -> [[Block]] { group(parse(source)) }

    static func group(_ blocks: [Block]) -> [[Block]] {
        var segments: [[Block]] = []
        for block in blocks {
            if block.isText, let last = segments.last, last.first?.isText == true {
                segments[segments.count - 1].append(block)
            } else {
                segments.append([block])
            }
        }
        return segments
    }

    /**
     * A reply as WhatsApp would show it, a bubble each: a paragraph, a list, a heading with what
     * follows it; code, a table, a quote or an image alone. Rules part bubbles and aren't drawn.
     */
    static func bubbles(_ source: String) -> [[Block]] {
        var bubbles: [[Block]] = []
        var heading: Block?
        for block in parse(source) {
            switch block {
            case .rule: continue
            case .heading:
                if let heading { bubbles.append([heading]) }
                heading = block
            case .item where heading == nil && { if case .item? = bubbles.last?.last { true } else { false } }():
                bubbles[bubbles.count - 1].append(block)
            default:
                bubbles.append((heading.map { [$0] } ?? []) + [block])
                heading = nil
            }
        }
        if let heading { bubbles.append([heading]) }
        return bubbles
    }

    /** What a bubble says, to quote it. */
    static func plain(_ blocks: [Block]) -> String {
        blocks.map { block in
            switch block {
            case .heading(_, let text), .paragraph(let text), .quote(let text): text
            case .item(let marker, let depth, _, let text): String(repeating: "  ", count: depth) + "\(marker) \(text)"
            case .code(_, let code): code
            case .table(let header, let rows): ([header] + rows).map { $0.joined(separator: " | ") }.joined(separator: "\n")
            case .rule: ""
            case .image(let alt, let url): alt.isEmpty ? url : alt
            }
        }.joined(separator: "\n")
    }

    static func parse(_ source: String) -> [Block] {
        var blocks: [Block] = []
        var paragraph: [String] = []
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var index = 0

        func flush() {
            guard !paragraph.isEmpty else { return }
            let text = paragraph.joined(separator: "\n")
            if let image = wholeImage(text) { blocks.append(image) } else { blocks.append(.paragraph(text)) }
            paragraph = []
        }

        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                flush()
                let fence = String(trimmed.prefix(3))
                let language = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                var code: [String] = []
                index += 1
                // An open fence takes what's left: the rest is still being written.
                while index < lines.count, !lines[index].trimmingCharacters(in: .whitespaces).hasPrefix(fence) {
                    code.append(lines[index])
                    index += 1
                }
                blocks.append(.code(language: language.isEmpty ? nil : language, code.joined(separator: "\n")))
                index += 1
                continue
            }
            if trimmed.isEmpty {
                flush()
                index += 1
                continue
            }
            if let level = heading(trimmed) {
                flush()
                blocks.append(.heading(level, String(trimmed.dropFirst(level)).trimmingCharacters(in: .whitespaces)))
                index += 1
                continue
            }
            if isRule(trimmed) {
                flush()
                blocks.append(.rule)
                index += 1
                continue
            }
            if trimmed.hasPrefix(">") {
                flush()
                var quoted: [String] = []
                while index < lines.count, lines[index].trimmingCharacters(in: .whitespaces).hasPrefix(">") {
                    quoted.append(String(lines[index].trimmingCharacters(in: .whitespaces).dropFirst()).trimmingCharacters(in: .whitespaces))
                    index += 1
                }
                blocks.append(.quote(quoted.joined(separator: "\n")))
                continue
            }
            if trimmed.hasPrefix("|"), index + 1 < lines.count, isDivider(lines[index + 1]) {
                flush()
                let header = cells(trimmed)
                var rows: [[String]] = []
                index += 2
                while index < lines.count, lines[index].trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                    rows.append(cells(lines[index]))
                    index += 1
                }
                blocks.append(.table(header: header, rows: rows))
                continue
            }
            if let item = listItem(line) {
                flush()
                var text = item.text
                index += 1
                // A line under an item, indented past its marker, goes on with it.
                while index < lines.count {
                    let next = lines[index]
                    let nextTrimmed = next.trimmingCharacters(in: .whitespaces)
                    guard !nextTrimmed.isEmpty, listItem(next) == nil, indent(next) >= item.indent + 2,
                          !nextTrimmed.hasPrefix("```"), heading(nextTrimmed) == nil else { break }
                    text += "\n" + nextTrimmed
                    index += 1
                }
                blocks.append(.item(marker: item.marker, depth: item.indent / 2, task: item.task, text))
                continue
            }
            paragraph.append(trimmed)
            index += 1
        }
        flush()
        return blocks
    }

    private static func heading(_ line: String) -> Int? {
        let hashes = line.prefix { $0 == "#" }.count
        guard (1...6).contains(hashes), line.dropFirst(hashes).first == " " else { return nil }
        return hashes
    }

    private static func isRule(_ line: String) -> Bool {
        let marks = line.filter { !$0.isWhitespace }
        guard marks.count >= 3, let first = marks.first, "-*_".contains(first) else { return false }
        return marks.allSatisfy { $0 == first }
    }

    private static func indent(_ line: String) -> Int {
        line.prefix { $0 == " " || $0 == "\t" }.reduce(0) { $0 + ($1 == "\t" ? 2 : 1) }
    }

    private static func listItem(_ line: String) -> (marker: String, indent: Int, task: Bool?, text: String)? {
        let depth = indent(line)
        let body = line.trimmingCharacters(in: .whitespaces)
        var marker: String, rest: Substring
        if let first = body.first, "-*+".contains(first), body.dropFirst().first == " " {
            marker = "•"
            rest = body.dropFirst(2)
        } else {
            let digits = body.prefix { $0.isNumber }
            guard !digits.isEmpty, digits.count <= 9, let mark = body.dropFirst(digits.count).first, mark == "." || mark == ")",
                  body.dropFirst(digits.count + 1).first == " " else { return nil }
            marker = "\(digits)."
            rest = body.dropFirst(digits.count + 2)
        }
        var task: Bool?
        for (box, done) in [("[ ] ", false), ("[x] ", true), ("[X] ", true)] where rest.hasPrefix(box) {
            task = done
            rest = rest.dropFirst(box.count)
        }
        return (marker, depth, task, String(rest).trimmingCharacters(in: .whitespaces))
    }

    private static func isDivider(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        return trimmed.hasPrefix("|") && trimmed.contains("-") && trimmed.allSatisfy { "|-: ".contains($0) }
    }

    private static func cells(_ line: String) -> [String] {
        var row = line.trimmingCharacters(in: .whitespaces)
        if row.hasPrefix("|") { row.removeFirst() }
        if row.hasSuffix("|") { row.removeLast() }
        return row.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    /** A paragraph that is one image and nothing else. */
    private static func wholeImage(_ text: String) -> Block? {
        guard text.hasPrefix("!["), text.hasSuffix(")"), let close = text.range(of: "]("), !text[close.upperBound...].dropLast().contains(")") else { return nil }
        let alt = String(text[text.index(text.startIndex, offsetBy: 2)..<close.lowerBound])
        let url = String(text[close.upperBound...].dropLast()).components(separatedBy: " ").first ?? ""
        return url.isEmpty ? nil : .image(alt: alt, url: url.trimmingCharacters(in: CharacterSet(charactersIn: "<>")))
    }

    /** The words alone, for copying and searching. */
    static func plain(_ source: String) -> String {
        (try? AttributedString(markdown: source, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            .map { String($0.characters) } ?? source
    }
}
