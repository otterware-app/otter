import SwiftUI
import WebKit

/**
 * A mailbox's signature as Gmail keeps it, HTML, edited in place (links, sizes
 * and all), as the desktop's rich-text signature editor does.
 */
struct SignatureEditor: View {
    @Environment(\.palette) private var palette
    @Environment(\.colorScheme) private var colorScheme
    let html: String
    /** Where saving puts it ("Gmail", "your Otter account"). */
    var savedIn = "Gmail"
    /** Signs the mailbox in again, for a sign-in that may not save signatures in Gmail. */
    var signIn: (() async throws -> Void)?
    let onSave: (String) async throws -> Void

    @State private var page = WebPage()
    @State private var height: CGFloat = 120
    @State private var status: String?
    @State private var needsSignIn = false
    @State private var loaded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            WebView(page)
                .scrollDisabled(true)
                .frame(height: height)
                // WebKit's blank page is white: shown once the signature (in the row's colors) is in.
                .opacity(loaded ? 1 : 0)
                .task(id: html) { await load() }
                // Light and dark swap without reloading what's being typed.
                .onChange(of: colors) { _, colors in
                    Task { _ = try? await page.callJavaScript("document.getElementById('colors').textContent = css", arguments: ["css": colors]) }
                }
            HStack {
                if let status {
                    Text(status).font(.inter(.footnote)).foregroundStyle(palette.muted)
                }
                Spacer()
                if needsSignIn, let signIn {
                    Button("Sign in again") {
                        Task {
                            do {
                                try await signIn()
                                needsSignIn = false
                                await save()
                            } catch GoogleAuth.Failure.cancelled {} catch {
                                status = error.localizedDescription
                            }
                        }
                    }
                    .buttonStyle(.glass)
                }
                Button("Save signature") { Task { await save() } }
                    .buttonStyle(.glass)
            }
        }
    }

    /**
     * The row's colors: WebKit paints its own (white) page otherwise, a white
     * box with the dark palette's pale text in it.
     */
    private var colors: String {
        """
        html, body { background: \(palette.card.hex); color-scheme: \(colorScheme == .dark ? "dark" : "light"); }
        #e { color: \(palette.text.hex); caret-color: \(palette.focus.hex); }
        #e a { color: \(palette.focus.hex); }
        """
    }

    private func load() async {
        let css = """
            html, body { margin: 0; }
            #e { font: 17px -apple-system; outline: none; min-height: 88px; padding: 4px 0; }
            """
        let document = """
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>\(css)</style>
            <style id="colors">\(colors)</style>
            <div id="e" contenteditable="true">\(html)</div>
            """
        do {
            for try await event in page.load(html: document, baseURL: URL(string: "about:blank")!) where event == .finished {
                await measure()
                loaded = true
            }
        } catch {}
        // Keep the frame as tall as what's being typed.
        while !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(500))
            await measure()
        }
    }

    private func measure() async {
        if let value = try? await page.callJavaScript("return document.documentElement.scrollHeight") as? Double {
            height = max(value, 100)
        }
    }

    private func save() async {
        guard let edited = try? await page.callJavaScript("return document.getElementById('e').innerHTML") as? String else { return }
        do {
            status = "Saving…"
            try await onSave(edited)
            status = "Saved in \(savedIn)"
        } catch let failure as GmailAPI.Failure where failure.insufficientScope {
            status = "Sign in to this account again to allow saving signatures in Gmail."
            needsSignIn = true
        } catch {
            status = error.localizedDescription
        }
    }
}
