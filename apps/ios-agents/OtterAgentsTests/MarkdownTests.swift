import Testing
@testable import Otter_Agents

struct MarkdownTests {
    @Test func blocks() {
        let blocks = Markdown.parse("""
        # Title

        A paragraph
        on two lines.

        - one
        - [x] done
          1. nested
        > quoted
        > again

        | A | B |
        | --- | :-: |
        | 1 | 2 |

        ---
        ```swift
        let x = 1
        ```
        ![alt](https://otterware.app/a.png)
        """)
        #expect(blocks == [
            .heading(1, "Title"),
            .paragraph("A paragraph\non two lines."),
            .item(marker: "•", depth: 0, task: nil, "one"),
            .item(marker: "•", depth: 0, task: true, "done"),
            .item(marker: "1.", depth: 1, task: nil, "nested"),
            .quote("quoted\nagain"),
            .table(header: ["A", "B"], rows: [["1", "2"]]),
            .rule,
            .code(language: "swift", "let x = 1"),
            .image(alt: "alt", url: "https://otterware.app/a.png"),
        ])
    }

    @Test func anAnswerStillBeingWrittenRendersWhatItHas() {
        // An open fence takes the rest: the code shows as it streams.
        #expect(Markdown.parse("Here:\n```sh\ngog draft") == [.paragraph("Here:"), .code(language: "sh", "gog draft")])
        #expect(Markdown.parse("It was 2026. A year, not a list") == [.paragraph("It was 2026. A year, not a list")])
    }

    @Test func aReplyBeingWrittenShowsWholeBubblesThatStay() {
        let reply = "Here's where things stand.\n\n## Decided\n\n- One\n- Two\n  more\n1. Three\n\n---\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```sh\ngog draft\n\nmore\n```\n\nSay *send it*.\n\n___\n\nBye."
        var shown: [[Markdown.Block]] = []
        for end in reply.indices {
            let now = Markdown.written(String(reply[...end]))
            #expect(Array(now.prefix(shown.count)) == shown, "a bubble shown went away or changed at \(reply[...end].count) characters")
            shown = now
        }
        #expect(shown == Array(Markdown.bubbles(reply).dropLast()))
    }

    @Test func textRunsJoinSoASelectionCanCrossThem() {
        let segments = Markdown.segments("# A\n\nb\n\n- c\n\n```\nd\n```\n\ne")
        #expect(segments.map(\.count) == [3, 1, 1])
        #expect(Markdown.plain("**Bold** and `code`") == "Bold and code")
    }
}
