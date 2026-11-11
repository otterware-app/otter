import SwiftUI
import UIKit

/** Where a chat's live browser comes from: its OpenClaw gateway, or the demo's picture of one. */
enum BrowserSource {
    case gateway(OpenClaw, session: String)
    case demo

    /** None for a chat whose agent never browsed, or isn't OpenClaw's. */
    init?(_ chat: Chat, agents: Agents) {
        guard chat.provider == "openclaw", Self.activity(in: chat, demo: agents.demo) > 0 else { return nil }
        if agents.demo {
            self = .demo
        } else if let session = chat.sessionId, agents.isUsable(.openclaw), let gateway = agents.openClawClient {
            self = .gateway(gateway, session: session)
        } else {
            return nil
        }
    }

    /**
     * Changes when the agent browses again, and when that step ends: it may be on another tab by then.
     * Its browser tool's steps are titled "Browser", as the Mac and web apps tell them (chat-workspace.tsx).
     */
    static func activity(in chat: Chat, demo: Bool) -> Int {
        chat.turns.reduce(0) { count, turn in
            count + turn.items.reduce(0) { sum, item in
                guard let step = item.step, demo ? step.kind == "web" : step.title == "Browser" else { return sum }
                return sum + (item.isRunning ? 1 : 2)
            }
        }
    }

    func hasTab() async throws -> Bool {
        switch self {
        case .demo: true
        case .gateway(let gateway, let session): try await gateway.browserView(session: session, width: 320, height: 320) != nil
        }
    }
}

/** OpenClaw's screencast: a WebSocket of JPEG frames, about 20 a second. */
nonisolated enum BrowserStream {
    enum Message: Sendable {
        case page(String)
        case frame(UIImage, css: CGSize?)
    }

    /**
     * Streams until the socket closes, and returns its close code. Frames are decoded here, off the
     * main actor; one that arrives while another decodes or is being shown replaces the one waiting,
     * so a slow phone skips frames rather than falling behind.
     */
    @concurrent static func run(_ url: URL, receive: @escaping @Sendable (Message) async -> Void) async -> Int {
        let socket = URLSession.shared.webSocketTask(with: url)
        socket.maximumMessageSize = 16 * 1024 * 1024
        socket.resume()
        let (frames, waiting) = AsyncStream.makeStream(of: Data.self, bufferingPolicy: .bufferingNewest(1))
        async let shown: Void = show(frames, receive)
        await withTaskCancellationHandler {
            while let message = try? await socket.receive() {
                switch message {
                case .data(let data): waiting.yield(data)
                case .string(let text):
                    let json = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any]
                    if let page = json?["url"] as? String, ["ready", "meta"].contains(json?["type"] as? String) { await receive(.page(page)) }
                @unknown default: break
                }
            }
        } onCancel: {
            socket.cancel(with: .goingAway, reason: nil)
        }
        waiting.finish()
        await shown
        return socket.closeCode.rawValue
    }

    @concurrent private static func show(_ frames: AsyncStream<Data>, _ receive: @escaping @Sendable (Message) async -> Void) async {
        for await message in frames {
            guard let frame = BrowserFrame(message), let image = UIImage(data: frame.jpeg)?.preparingForDisplay() else { continue }
            await receive(.frame(image, css: frame.cssSize))
        }
    }
}

/**
 * The agent's browser tab, live (apps/web's agent-browser.tsx: change both together). It streams
 * from `start` to `stop`. Taking control sends your taps and keys to the tab (the Otter plugin on
 * the gateway replays them), and the agent's browser waits until you hand it back.
 */
@Observable
final class BrowserSession {
    enum Status: Equatable {
        case connecting
        case live
        case closed
        case failed(String)
    }

    struct Problem: Equatable {
        var title: String
        var message: String
    }

    struct Pointer: Equatable {
        var at: CGPoint
        var clicks: Int
        var seen: Date
    }

    struct Typing: Equatable {
        var box: CGRect
        var seen: Date
    }

    /** Held tabs are let go a while after the last heartbeat, so a closed app never keeps one. */
    private static let heartbeat = Duration.seconds(10)
    /** How long one request for what happens on the tab waits for something to. */
    private static let eventsWaitMs = 20_000

    let source: BrowserSource
    private(set) var status = Status.connecting
    private(set) var tab: BrowserTab?
    private(set) var page: String?
    private(set) var frame: UIImage?
    private(set) var cssSize: CGSize?
    private(set) var controlling = false
    private(set) var pointer: Pointer?
    private(set) var typing: Typing?
    private(set) var dialog: BrowserDialog?
    /** The page asks for files while you hold it: whether it takes several. */
    private(set) var chooser: Bool?
    /** What has focus in the page takes text: known while watching too, so taking control finds the field the agent left. */
    private var field = false
    /** The iPhone keyboard is for the page's field while you hold the tab. */
    var keyboard: Bool { controlling && field }
    var problem: Problem?

    private var stream: Task<Void, Never>?
    private var watching: Task<Void, Never>?
    private var holding: Task<Void, Never>?
    /** Which time control was taken: what an earlier one still had under way no longer counts. */
    private var hold = 0
    private var seq = 0
    private var queue: [BrowserInput] = []
    private var flushing: Task<Void, Never>?

    init(source: BrowserSource) {
        self.source = source
    }

    // MARK: The stream

    func start() {
        stop()
        stream = Task { await run() }
    }

    func stop() {
        releaseControl()
        stream?.cancel()
        stream = nil
        watching?.cancel()
        watching = nil
    }

    /** The agent browsed again: a new stream only when it's on another tab, or the view had closed. */
    func browsedAgain() {
        guard stream != nil, case .gateway(let gateway, let session) = source else { return }
        guard let current = tab?.targetId else { return start() }
        Task {
            do {
                let view = try await gateway.browserView(session: session, width: 320, height: 320, except: current)
                if view?.tab.targetId != current, tab?.targetId == current, stream != nil { start() }
            } catch {}
        }
    }

    private func run() async {
        guard case .gateway(let gateway, let session) = source else { return await demo() }
        var failures = 0
        while !Task.isCancelled {
            status = .connecting
            let view: BrowserView?
            do {
                view = try await gateway.browserView(session: session, width: 2000, height: 2000)
            } catch {
                if !Task.isCancelled { status = .failed(error.localizedDescription) }
                return
            }
            guard !Task.isCancelled else { return }
            guard let view, let socket = view.socket else {
                show(nil)
                status = .closed
                return
            }
            show(view.tab)
            page = view.page
            let code = await BrowserStream.run(socket) { [weak self] in await self?.received($0) }
            guard !Task.isCancelled else { return }
            if code == 4003 { return status = .failed("OpenClaw stopped the view: it doesn't allow that address.") }
            if code == 4005 { return status = .failed("This browser can't be watched live.") }
            // The tab closed (4004) or the stream dropped: ask again, as often as it keeps working.
            failures = status == .live ? 1 : failures + 1
            try? await Task.sleep(for: code == 4004 ? .milliseconds(300) : .seconds(min(pow(2, Double(failures)), 15)))
        }
    }

    private func received(_ message: BrowserStream.Message) {
        guard !Task.isCancelled else { return }
        switch message {
        case .page(let url):
            if status == .live { page = url }
        case .frame(let image, let css):
            frame = image
            cssSize = css ?? cssSize ?? image.size
            status = .live
        }
    }

    private func show(_ next: BrowserTab?) {
        if next != tab {
            releaseControl()
            watching?.cancel()
            watching = nil
            tab = next
            pointer = nil
            typing = nil
            dialog = nil
        }
        // From the moment the tab is known: a page held up by a pop-up sends no frames until it's answered.
        if watching == nil, let next { watching = Task { await watch(next) } }
    }

    private func demo() async {
        status = .connecting
        guard (try? await Task.sleep(for: .milliseconds(500))) != nil else { return }
        tab = BrowserTab(targetId: "demo")
        page = DemoBrowser.page
        frame = DemoBrowser.picture
        cssSize = DemoBrowser.size
        status = .live
    }

    // MARK: What happens on the tab

    private func watch(_ tab: BrowserTab) async {
        guard case .gateway(let gateway, _) = source else { return }
        var since: Int?
        var run: String?
        var failures = 0
        while !Task.isCancelled {
            do {
                let result = try await gateway.browserEvents(tab, since: since, run: run, waitMs: since == nil ? 0 : Self.eventsWaitMs)
                guard !Task.isCancelled else { return }
                // A first answer, or the plugin started over: take its state as it is.
                if since == nil || result.run != run {
                    dialog = result.dialog
                    field = result.field
                }
                run = result.run
                result.events.forEach(handle)
                since = result.seq
                failures = 0
            } catch {
                // A gateway being updated, or without the plugin's events yet: ask again, less often.
                failures += 1
                let later: Double = error.localizedDescription.contains("update the Otter plugin") ? 60 : 15
                try? await Task.sleep(for: .seconds(min(pow(2, Double(failures)), later)))
            }
        }
    }

    private func handle(_ event: BrowserEvent) {
        switch event {
        case .pointer(let at, let click): pointer = Pointer(at: at, clicks: (pointer?.clicks ?? 0) + (click ? 1 : 0), seen: .now)
        case .typing(let box): typing = Typing(box: box, seen: .now)
        case .dialog(let opened): dialog = opened
        case .dialogClosed: dialog = nil
        case .clipboard(let text): if controlling { UIPasteboard.general.string = text }
        case .fileChooser(let multiple): if controlling { chooser = multiple }
        case .field(let editable): field = editable
        }
    }

    // MARK: Control

    func takeControl() {
        guard let tab, !controlling else { return }
        controlling = true
        hold += 1
        seq = 0
        guard case .gateway(let gateway, _) = source else { return }
        holding = Task { [hold] in
            while !Task.isCancelled {
                do {
                    try await gateway.browserControl(tab, take: true)
                } catch {
                    return lost(error, hold)
                }
                try? await Task.sleep(for: Self.heartbeat)
            }
        }
    }

    func releaseControl() {
        guard controlling, let tab else { return }
        flush()
        controlling = false
        chooser = nil
        holding?.cancel()
        holding = nil
        if case .gateway(let gateway, _) = source { Task { try? await gateway.browserControl(tab, take: false) } }
    }

    private func lost(_ error: Error, _ held: Int) {
        guard controlling, held == hold else { return }
        releaseControl()
        problem = Problem(title: "Lost control of the browser", message: error.localizedDescription)
    }

    /** Wheel turns are merged into one batch a frame; the rest goes at once, in the order it happened. */
    func send(_ inputs: [BrowserInput]) {
        guard controlling else { return }
        var scrolling = !inputs.isEmpty
        for input in inputs {
            if case .wheel(let at, let deltaX, let deltaY) = input {
                if case .wheel(_, let x, let y) = queue.last {
                    queue[queue.count - 1] = .wheel(at: at, deltaX: x + deltaX, deltaY: y + deltaY)
                    continue
                }
            } else {
                scrolling = false
            }
            queue.append(input)
        }
        guard scrolling else { return flush() }
        flushing = flushing ?? Task {
            guard (try? await Task.sleep(for: .milliseconds(16))) != nil else { return }
            flush()
        }
    }

    /** Going elsewhere: the field that had focus goes with the page. */
    func go(_ input: BrowserInput) {
        field = false
        send([input])
    }

    func answer(accept: Bool, text: String? = nil) {
        send([.dialog(accept: accept, promptText: text)])
        dialog = nil
    }

    func paste() {
        guard let text = UIPasteboard.general.string, !text.isEmpty else { return }
        send([.text(text)])
    }

    /** The files for the page's own picker: none cancels it. */
    func choose(_ files: [URL]) async {
        chooser = nil
        guard let tab, case .gateway(let gateway, _) = source else { return }
        do {
            var picked: [(name: String, data: Data)] = []
            for file in files {
                let scoped = file.startAccessingSecurityScopedResource()
                defer { if scoped { file.stopAccessingSecurityScopedResource() } }
                let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                guard picked.reduce(size, { $0 + $1.data.count }) <= OpenClaw.maxUploadBytes else {
                    try? await gateway.browserUpload(tab, files: [])
                    throw OpenClaw.Failure(message: "Those files are too large to send to the agent's browser (10 MB at most).")
                }
                picked.append((file.lastPathComponent, try Data(contentsOf: file)))
            }
            try await gateway.browserUpload(tab, files: picked)
        } catch {
            problem = Problem(title: "Could not send the files to the page", message: error.localizedDescription)
        }
    }

    private func flush() {
        flushing?.cancel()
        flushing = nil
        guard !queue.isEmpty else { return }
        let batch = queue
        queue = []
        guard let tab, case .gateway(let gateway, _) = source else { return }
        seq += 1
        Task { [seq, hold] in
            do {
                try await gateway.browserInput(tab, seq: seq, events: batch)
            } catch {
                lost(error, hold)
            }
        }
    }
}
