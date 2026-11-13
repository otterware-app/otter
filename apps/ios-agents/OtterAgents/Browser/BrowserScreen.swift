import SwiftUI
import UniformTypeIdentifiers

/**
 * The agent's browser tab, to watch and to take over: T3 Code's phone browser preview (its
 * BrowserPreviewRouteScreen and PreviewStreamWebView), over OpenClaw's screencast. It streams
 * while it's on screen and the app is open.
 */
struct BrowserScreen: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    let agent: String
    /** The agent is at work in this chat. */
    let working: Bool
    /** Changes when the agent browses again. */
    let activity: Int
    @State private var session: BrowserSession
    @State private var draft: String?
    @State private var selection: TextSelection?
    @FocusState private var addressFocused: Bool
    @State private var promptText = ""
    @State private var choosing = false

    init(source: BrowserSource, agent: String, working: Bool, activity: Int) {
        self.agent = agent
        self.working = working
        self.activity = activity
        _session = State(initialValue: BrowserSession(source: source))
    }

    private var live: Bool { scenePhase != .background }
    /** Frames show and the tab is yours: what you do reaches the page. */
    private var ready: Bool { session.status == .live && session.controlling }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if session.tab == nil {
                    waiting
                } else {
                    addressBar
                    VStack(spacing: 0) {
                        controlStrip
                        BrowserPage(session: session, typing: !addressFocused) { addressFocused = false }
                            .overlay { waiting }
                    }
                    .overlay(alignment: .top) { cards }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(palette.canvas)
            .navigationTitle(BrowserAddress.host(session.page) ?? "Browser")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close browser", systemImage: "xmark") { dismiss() } }
            }
        }
        .onChange(of: live, initial: true) { start() }
        .onChange(of: activity) { session.browsedAgain() }
        .onChange(of: session.dialog) { promptText = session.dialog?.defaultPrompt ?? "" }
        .onDisappear { session.stop() }
        .alert(session.problem?.title ?? "", isPresented: Binding { session.problem != nil } set: { if !$0 { session.problem = nil } },
               presenting: session.problem) { _ in
            Button("OK") {}
        } message: {
            Text($0.message)
        }
        .fileImporter(isPresented: $choosing, allowedContentTypes: [.item], allowsMultipleSelection: session.chooser == true) { result in
            let files = (try? result.get()) ?? []
            Task { await session.choose(files) }
        } onCancellation: {
            Task { await session.choose([]) }
        }
    }

    private func start() {
        guard live else { return session.stop() }
        session.start()
    }

    // MARK: Address

    private var addressBar: some View {
        HStack(spacing: 4) {
            round("Back", "chevron.left") { session.go(.history(delta: -1)) }
            round("Forward", "chevron.right") { session.go(.history(delta: 1)) }
            TextField("Enter a URL", text: Binding { draft ?? session.page ?? "" } set: { if addressFocused { draft = $0 } }, selection: $selection,
                      prompt: Text("Enter a URL").foregroundStyle(palette.muted))
                .font(.ui(14))
                .foregroundStyle(palette.text)
                .keyboardType(.URL)
                .submitLabel(.go)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($addressFocused)
                .onSubmit(open)
                .padding(.horizontal, 16)
                .frame(height: 40)
                .background(palette.input, in: .capsule)
                .overlay { Capsule().strokeBorder(palette.border) }
                .accessibilityLabel("Address")
            round("Reload page", "arrow.clockwise") { session.go(.reload) }
            Menu {
                Button("Paste", systemImage: "doc.on.clipboard") { session.paste() }
            } label: {
                RoundIcon(symbol: "ellipsis")
            }
            .accessibilityLabel("Browser tab options")
        }
        .disabled(!ready)
        .padding(.horizontal, 8)
        .padding(.bottom, 8)
        .onChange(of: addressFocused) {
            guard addressFocused, let page = session.page else { return draft = nil }
            draft = page
            // Once the field has put its cursor where it was tapped.
            Task { selection = TextSelection(range: page.startIndex ..< page.endIndex) }
        }
    }

    private func round(_ label: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { RoundIcon(symbol: symbol) }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
    }

    private func open() {
        let typed = draft ?? session.page ?? ""
        draft = nil
        guard let url = BrowserAddress.url(typed) else {
            return session.problem = .init(title: "Could not open this address", message: "Enter an http or https URL.")
        }
        session.go(.navigate(url))
    }

    // MARK: Control

    private var controlStrip: some View {
        HStack(spacing: 8) {
            Text(controlLabel).font(.ui(12)).foregroundStyle(palette.muted)
            Spacer(minLength: 8)
            Button(session.controlling ? "Release control" : "Take control") {
                Haptics.tap()
                if session.controlling { session.releaseControl() } else { session.takeControl() }
            }
            .buttonStyle(Tone())
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(palette.hairline).frame(height: 1) }
    }

    private var controlLabel: String {
        if session.controlling { "You have control" }
        else if session.status != .live { "Connecting..." }
        else if working { "Agent has control" }
        else { "Watching" }
    }

    // MARK: Over the page

    @ViewBuilder
    private var waiting: some View {
        if session.status != .live {
            VStack(spacing: 16) {
                switch session.status {
                case .connecting, .live:
                    ProgressView()
                    Text("Connecting to browser...")
                case .closed:
                    Text("\(agent)'s browser is closed. It shows here when \(agent) browses again.")
                    Button("Reconnect", action: start).buttonStyle(Tone())
                case .failed(let message):
                    Text(message).textSelection(.enabled)
                    Button("Try again", action: start).buttonStyle(Tone())
                }
            }
            .font(.ui(14))
            .foregroundStyle(palette.muted)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(palette.canvas)
        }
    }

    /** What the page asks: its file picker, and its alert, confirm or prompt, answered by whoever holds the tab. */
    private var cards: some View {
        VStack(spacing: 8) {
            if let multiple = session.chooser, session.controlling {
                card {
                    Text("The page asks for \(multiple ? "files" : "a file").").font(.ui(14)).foregroundStyle(palette.text)
                    HStack(spacing: 12) {
                        Spacer()
                        Button("Cancel") { Task { await session.choose([]) } }.buttonStyle(Tone(filled: false))
                        Button("Choose \(multiple ? "files" : "file")") { choosing = true }.buttonStyle(Tone())
                    }
                }
            }
            if let dialog = session.dialog {
                card {
                    Text(dialog.message.isEmpty ? "The page is asking." : dialog.message).font(.ui(14)).foregroundStyle(palette.text)
                    if session.controlling {
                        if dialog.kind == "prompt" {
                            TextField("", text: $promptText)
                                .font(.ui(15))
                                .foregroundStyle(palette.text)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(palette.input, in: .rect(cornerRadius: 8))
                                .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(palette.border) }
                                .accessibilityLabel("Dialog response")
                        }
                        HStack(spacing: 12) {
                            Spacer()
                            Button("Dismiss") { session.answer(accept: false) }.buttonStyle(Tone(filled: false))
                            Button("Accept") { session.answer(accept: true, text: dialog.kind == "prompt" ? promptText : nil) }.buttonStyle(Tone())
                        }
                    } else {
                        Text("Take control to respond.").font(.ui(12)).foregroundStyle(palette.muted)
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 64)
    }

    private func card(@ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 12, content: content)
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.card, in: .rect(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(palette.border) }
    }
}

private struct RoundIcon: View {
    @Environment(\.palette) private var palette
    let symbol: String

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(palette.text)
            .frame(width: 44, height: 44)
            .background(palette.text.opacity(0.08), in: .circle)
            .contentShape(.circle)
    }
}

/** T3 Code's secondary button, and its text one. */
private struct Tone: ButtonStyle {
    @Environment(\.palette) private var palette
    var filled = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.ui(13, .semibold))
            .foregroundStyle(palette.text)
            .padding(.horizontal, filled ? 14 : 4)
            .frame(minHeight: 32)
            .background(palette.text.opacity(filled ? 0.08 : 0), in: .capsule)
            .contentShape(.capsule)
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}
