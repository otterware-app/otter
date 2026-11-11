import CoreGraphics
import Foundation

/** The tab an OpenClaw agent browsed in last, as its browser tool reported it. */
nonisolated struct BrowserTab: Equatable, Sendable {
    var targetId: String
    var profile: String?
    var url: String?

    var params: [String: Any] {
        var params: [String: Any] = ["targetId": targetId]
        if let profile { params["profile"] = profile }
        return params
    }
}

/** A live view of that tab: where its screencast streams from (none when it's the tab already shown) and its page. */
nonisolated struct BrowserView: Equatable, Sendable {
    var tab: BrowserTab
    var socket: URL?
    var page: String?
}

nonisolated struct BrowserDialog: Equatable, Sendable {
    var kind: String
    var message: String
    var defaultPrompt: String

    init?(_ json: [String: Any]?) {
        guard let json else { return nil }
        kind = json["dialogType"] as? String ?? "alert"
        message = json["message"] as? String ?? ""
        defaultPrompt = json["defaultPrompt"] as? String ?? ""
    }
}

/** What happens on the tab, in page CSS px (the gateway plugin's control.js). */
nonisolated enum BrowserEvent: Equatable, Sendable {
    case pointer(CGPoint, click: Bool)
    case typing(CGRect)
    case dialog(BrowserDialog)
    case dialogClosed
    case clipboard(String)
    case fileChooser(multiple: Bool)
    /** What has focus in the page takes text, or stopped doing so. */
    case field(editable: Bool)

    init?(_ json: [String: Any]) {
        let number = { (key: String) in (json[key] as? NSNumber)?.doubleValue ?? 0 }
        switch json["type"] as? String {
        case "pointer": self = .pointer(CGPoint(x: number("x"), y: number("y")), click: json["phase"] as? String == "click")
        case "typing": self = .typing(CGRect(x: number("x"), y: number("y"), width: number("width"), height: number("height")))
        case "dialog":
            guard let dialog = BrowserDialog(json) else { return nil }
            self = .dialog(dialog)
        case "dialogClosed": self = .dialogClosed
        case "clipboard": self = .clipboard(json["text"] as? String ?? "")
        case "fileChooser": self = .fileChooser(multiple: json["multiple"] as? Bool == true)
        case "field": self = .field(editable: json["editable"] as? Bool == true)
        default: return nil
        }
    }
}

nonisolated struct BrowserEvents: Sendable {
    var run: String
    var seq: Int
    var dialog: BrowserDialog?
    /** What has focus in the page takes text. */
    var field = false
    var events: [BrowserEvent]
}

/** What you do on the live view, in page CSS px (apps/web's agent-browser-input.ts): change both together. */
nonisolated enum BrowserInput: Equatable, Sendable {
    case mouse(action: String, at: CGPoint, button: String, buttons: Int, clickCount: Int)
    case wheel(at: CGPoint, deltaX: Double, deltaY: Double)
    case key(action: String, key: String, code: String, keyCode: Int, text: String?)
    case text(String)
    case history(delta: Int)
    case reload
    case navigate(String)
    case dialog(accept: Bool, promptText: String?)

    var json: [String: Any] {
        switch self {
        case .mouse(let action, let at, let button, let buttons, let clickCount):
            return ["type": "mouse", "action": action, "x": at.x, "y": at.y, "button": button, "buttons": buttons, "clickCount": clickCount, "modifiers": 0]
        case .wheel(let at, let deltaX, let deltaY):
            return ["type": "wheel", "x": at.x, "y": at.y, "deltaX": deltaX, "deltaY": deltaY, "modifiers": 0]
        case .key(let action, let key, let code, let keyCode, let text):
            var json: [String: Any] = ["type": "key", "action": action, "key": key, "code": code, "keyCode": keyCode, "modifiers": 0]
            if let text { json["text"] = text }
            return json
        case .text(let text):
            return ["type": "text", "text": text]
        case .history(let delta):
            return ["type": "history", "delta": delta]
        case .reload:
            return ["type": "reload"]
        case .navigate(let url):
            return ["type": "navigate", "url": url]
        case .dialog(let accept, let promptText):
            var json: [String: Any] = ["type": "dialog", "accept": accept]
            if let promptText { json["promptText"] = promptText }
            return json
        }
    }

    /** A tap: the pointer goes there, presses and lets go. */
    static func tap(at point: CGPoint, clickCount: Int) -> [BrowserInput] {
        [.mouse(action: "move", at: point, button: "none", buttons: 0, clickCount: 0),
         .mouse(action: "down", at: point, button: "left", buttons: 1, clickCount: clickCount),
         .mouse(action: "up", at: point, button: "left", buttons: 0, clickCount: clickCount)]
    }

    /** A key going down and up: Return and Backspace, or a character with the key it's on where that's known. */
    static func press(_ key: String) -> [BrowserInput] {
        let (name, code, keyCode, text): (String, String, Int, String?) = switch key {
        case "\n", "\r": ("Enter", "Enter", 13, "\r")
        case "\u{8}": ("Backspace", "Backspace", 8, nil)
        case " ": (" ", "Space", 32, " ")
        default:
            if let ascii = key.unicodeScalars.first, key.unicodeScalars.count == 1, ascii.isASCII, ascii.properties.isAlphabetic {
                (key, "Key\(key.uppercased())", Int(key.uppercased().unicodeScalars.first!.value), key)
            } else if let ascii = key.unicodeScalars.first, key.unicodeScalars.count == 1, ("0" ... "9").contains(ascii) {
                (key, "Digit\(key)", Int(ascii.value), key)
            } else {
                (key, "", 0, key)
            }
        }
        return [.key(action: "down", key: name, code: code, keyCode: keyCode, text: text),
                .key(action: "up", key: name, code: code, keyCode: keyCode, text: nil)]
    }
}

/** One message of the screencast: `[uint32 big-endian header length][JSON meta][JPEG]`. */
nonisolated struct BrowserFrame: Equatable, Sendable {
    /** The page's size in CSS px, which input is sent in. */
    var cssSize: CGSize?
    var jpeg: Data

    init?(_ message: Data) {
        guard message.count >= 4 else { return nil }
        let header = message.prefix(4).reduce(0) { $0 << 8 | Int($1) }
        guard message.count - 4 >= header else { return nil }
        let body = message.dropFirst(4)
        let meta = (try? JSONSerialization.jsonObject(with: body.prefix(header))) as? [String: Any]
        if let width = (meta?["cssWidth"] as? NSNumber)?.doubleValue, let height = (meta?["cssHeight"] as? NSNumber)?.doubleValue, width > 0, height > 0 {
            cssSize = CGSize(width: width, height: height)
        }
        jpeg = Data(body.dropFirst(header))
    }
}

/** Where the frame sits in its view, fitted and against the top, and what a point of one is in the other. */
nonisolated struct BrowserFit: Equatable, Sendable {
    /** The frame, in the view. */
    var rect: CGRect
    /** View points per page CSS px. */
    var scale: CGFloat
    var css: CGSize

    init?(view: CGSize, image: CGSize, css: CGSize) {
        guard view.width > 0, view.height > 0, image.width > 0, image.height > 0, css.width > 0, css.height > 0 else { return nil }
        let fit = min(view.width / image.width, view.height / image.height)
        let size = CGSize(width: image.width * fit, height: image.height * fit)
        rect = CGRect(x: (view.width - size.width) / 2, y: 0, width: size.width, height: size.height)
        scale = size.width / css.width
        self.css = css
    }

    /** The page's point under a point of the view: none outside the frame, unless clamped to it. */
    func page(_ point: CGPoint, clamped: Bool = false) -> CGPoint? {
        let x = (point.x - rect.minX) / rect.width * css.width
        let y = (point.y - rect.minY) / rect.height * css.height
        if !clamped, x < 0 || y < 0 || x > css.width || y > css.height { return nil }
        return CGPoint(x: min(max(x, 0), css.width), y: min(max(y, 0), css.height))
    }

    func view(_ point: CGPoint) -> CGPoint {
        CGPoint(x: rect.minX + point.x * scale, y: rect.minY + point.y * scale)
    }
}

nonisolated enum BrowserAddress {
    /** What the address field opens (T3 Code's normalizePreviewUrl): http or https, https for a bare host, http for this machine's. */
    static func url(_ typed: String) -> String? {
        let trimmed = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let matches = { (pattern: String) in trimmed.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil }
        let local = matches(#"^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::|/|$)"#)
        let candidate = matches(#"^[a-z][a-z\d+.-]*://"#) ? trimmed : "\(local ? "http" : "https")://\(trimmed)"
        guard let parts = URLComponents(string: candidate), ["http", "https"].contains(parts.scheme?.lowercased() ?? ""),
              let host = parts.percentEncodedHost, !host.isEmpty, !host.contains("%"), let url = parts.url else { return nil }
        return url.absoluteString
    }

    /** The page's host, as the title shows it. */
    static func host(_ page: String?) -> String? {
        guard let host = page.flatMap(URL.init(string:))?.host(), !host.isEmpty else { return nil }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}

/** What the Mac and web apps' OpenClaw provider does for the live browser (extensions/openclaw/core/openclaw.ts): change both together. */
extension OpenClaw {
    static let maxUploadBytes = 10 * 1024 * 1024

    nonisolated static func browserTab(of rows: [[String: Any]]) -> BrowserTab? {
        for row in rows.reversed() {
            guard let tab = (row["details"] as? [String: Any])?["browserTab"] as? [String: Any],
                  let targetId = tab["targetId"] as? String, tab["target"] as? String != "node" else { continue }
            return BrowserTab(targetId: targetId, profile: tab["profile"] as? String, url: tab["url"] as? String)
        }
        return nil
    }

    /** A screencast of the session's tab, at most `width` by `height` px. None when its browser is closed. */
    func browserView(session: String, width: Int, height: Int, except: String? = nil) async throws -> BrowserView? {
        let history = try await request("chat.history", ["sessionKey": session, "limit": 200]) as? [String: Any]
        // Without a tab in its history (runtimes that keep no tool results): the browser's current one.
        let tab = Self.browserTab(of: history?["messages"] as? [[String: Any]] ?? [])
        if let tab, tab.targetId == except { return BrowserView(tab: tab) }
        var body: [String: Any] = ["maxWidth": width, "maxHeight": height, "quality": 70]
        if let tab { body["targetId"] = tab.targetId }
        var params: [String: Any] = ["method": "POST", "path": "/screencast", "body": body]
        if let profile = tab?.profile { params["query"] = ["profile": profile] }
        let view: [String: Any]?
        do {
            view = try await request("browser.request", params) as? [String: Any]
        } catch let error as Failure where error.message.range(of: "not running|not found|no such|closed", options: [.regularExpression, .caseInsensitive]) != nil {
            // Its tabs are cleaned up after a while, or the browser was stopped.
            return nil
        }
        guard let view, let path = view["wsPath"] as? String, let targetId = view["targetId"] as? String ?? tab?.targetId else { return nil }
        let shown = BrowserTab(targetId: targetId, profile: tab?.profile)
        if tab == nil, targetId == except { return BrowserView(tab: shown) }
        var base = URLComponents(url: url, resolvingAgainstBaseURL: false) ?? URLComponents()
        if !base.path.hasSuffix("/") { base.path += "/" }
        let socket = URL(string: path.replacingOccurrences(of: "^/", with: "", options: .regularExpression), relativeTo: base.url ?? url)
        return BrowserView(tab: shown, socket: socket?.absoluteURL, page: view["url"] as? String ?? tab?.url)
    }

    // Through the Otter plugin on the gateway (otter.browser.*), which replays it in Chromium.

    /** Takes the tab (again every few seconds, or the gateway lets it go) or hands it back to the agent. */
    func browserControl(_ tab: BrowserTab, take: Bool) async throws {
        try await plugin("otter.browser.control", tab.params.merging(["take": take]) { $1 })
    }

    func browserInput(_ tab: BrowserTab, seq: Int, events: [BrowserInput]) async throws {
        try await plugin("otter.browser.input", tab.params.merging(["seq": seq, "events": events.map(\.json)]) { $1 })
    }

    /** What happened on the tab since `since`, waiting up to `waitMs` for something to. */
    func browserEvents(_ tab: BrowserTab, since: Int?, run: String?, waitMs: Int) async throws -> BrowserEvents {
        var params = tab.params
        params["waitMs"] = waitMs
        if let since { params["since"] = since }
        if let run { params["run"] = run }
        let result = try await plugin("otter.browser.events", params, timeout: TimeInterval(waitMs) / 1000 + 15) as? [String: Any] ?? [:]
        return BrowserEvents(run: result["run"] as? String ?? "", seq: result["seq"] as? Int ?? 0, dialog: BrowserDialog(result["dialog"] as? [String: Any]),
                             field: result["field"] as? Bool ?? false, events: (result["events"] as? [[String: Any]] ?? []).compactMap(BrowserEvent.init))
    }

    /** The files picked for the page's own picker: none cancels it. */
    func browserUpload(_ tab: BrowserTab, files: [(name: String, data: Data)]) async throws {
        let encoded = files.map { ["name": $0.name, "data": $0.data.base64EncodedString()] }
        try await plugin("otter.browser.upload", tab.params.merging(["files": encoded]) { $1 }, timeout: 60)
    }

    @discardableResult
    private func plugin(_ method: String, _ params: [String: Any], timeout: TimeInterval = 30) async throws -> Any? {
        do {
            return try await request(method, params, timeout: timeout)
        } catch let error as Failure where error.message.range(of: "unknown method", options: .caseInsensitive) != nil {
            throw Failure(message: "To take control, update the Otter plugin on the OpenClaw gateway: openclaw plugins update @otterware/openclaw-otter")
        }
    }
}
