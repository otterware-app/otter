import Foundation
import UniformTypeIdentifiers

/** The agents this iPhone can run a chat on. Claude and Codex run on a Mac: their chats read here. */
nonisolated enum AgentKind: String, CaseIterable, Identifiable {
    case hermes, openclaw, varys

    var id: String { rawValue }
    var name: String { Self.name(of: rawValue) }

    static func name(of provider: String) -> String {
        switch provider {
        case "hermes": "Hermes"
        case "openclaw": "OpenClaw"
        case "varys": "varys"
        case "claude": "Claude"
        case "codex": "Codex"
        default: provider.capitalized
        }
    }

    /** A turn the app left is picked up again. */
    var resumes: Bool { self == .openclaw || self == .varys }
    var skills: Bool { self == .hermes || self == .varys }
    var attachments: Bool { self != .varys }
}

/** An agent asking before it does something. */
nonisolated struct Approval: Equatable, Identifiable {
    var id: String
    /** command, fileChange, permission or tool. */
    var kind = "tool"
    var title = ""
    var detail: String?
    var reason: String?
    /** once, session, always, deny. */
    var choices: [String]
}

typealias Question = OpenClaw.Question

nonisolated struct Skill: Identifiable, Hashable {
    var name: String
    var description: String
    var category: String?
    var id: String { name }
}

/** A file picked for the next message, held in memory until it's sent. */
nonisolated struct Attachment: Identifiable, Equatable {
    static let maxCount = 10
    static let maxImageBytes = 10 * 1024 * 1024
    static let maxFileBytes = 50 * 1024 * 1024
    static let imageTypes: Set<String> = ["image/gif", "image/jpeg", "image/png", "image/webp"]

    var id = UUID()
    var name: String
    var mime: String
    var data: Data
    /** A small JPEG of an image, for the transcript. */
    var thumb: Data?

    var isImage: Bool { mime.hasPrefix("image/") }
    var size: Int { data.count }
    var kindLabel: String {
        if isImage { return "Image" }
        let ext = (name as NSString).pathExtension.uppercased()
        return ext.isEmpty ? ChatText.size(size) : "\(ext) · \(ChatText.size(size))"
    }

    var sent: ChatSentAttachment {
        ChatSentAttachment(name: name, isImage: isImage, size: size, thumb: thumb.map { "data:image/jpeg;base64,\($0.base64EncodedString())" })
    }

    /** Nil when it can be attached, else why not, as the desktop says it. */
    static func problem(name: String, mime: String, size: Int) -> String? {
        if size == 0 { return "'\(name)' is empty or could not be read." }
        if mime.hasPrefix("image/") {
            if !imageTypes.contains(mime) { return "'\(name)' is not a supported image type. Attach GIF, JPEG, PNG, or WebP images." }
            if size > maxImageBytes { return "'\(name)' exceeds the 10 MB attachment limit." }
        } else if size > maxFileBytes {
            return "'\(name)' exceeds the 50 MB attachment limit."
        }
        return nil
    }

    static func mime(of url: URL) -> String {
        UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    }
}

/** A message of a session the agent keeps, read to show a chat that started elsewhere. */
nonisolated struct SessionMessage: Equatable {
    var role: String
    var text: String
    var steps: [(id: String?, step: ChatStep, output: String?)] = []

    static func == (a: SessionMessage, b: SessionMessage) -> Bool {
        a.role == b.role && a.text == b.text && a.steps.map(\.step) == b.steps.map(\.step)
    }
}

/** What a running turn tells the chat (core's `ChatEvent`). */
nonisolated enum ChatEvent {
    case session(String)
    case title(String)
    case delta(String)
    case tool(id: String?, ChatStep)
    case toolResult(id: String?, String)
    /** The whole reply so far, from an agent that tells it that way (OpenClaw, varys). */
    case reply(text: String, steps: [(id: String?, step: ChatStep, output: String?)])
    case approval(Approval)
    case approvalResolved(String)
    case question(Question)
    case questionResolved(String)
    /** The run handed off to background work (OpenClaw's yield): the turn stays open, waiting on the subagents it started, each by its name when it has one. */
    case waiting([String?])
    /** The run that work's completion started is going. */
    case working
    /** How far the agent's run got, for a turn picked up again: it replaces what's shown after the message. */
    case transcript([SessionMessage])
    /** The agent finished before taking a steer. */
    case steerReturned(String)
    case done
    /** A code (`friendlyError`), or `agent_error: …` for the agent's own words. */
    case error(String)
}

nonisolated enum AgentError {
    /** Sending again wouldn't help. */
    static let final: Set<String> = ["not_configured", "provider_disabled", "unauthorized", "cancelled", "pairing_required"]
    /** The turn couldn't be followed now: it's picked up again later, not over. */
    static let detached = "detached"

    static func friendly(_ code: String, provider: String) -> String {
        let name = AgentKind.name(of: provider)
        switch code {
        case "not_configured": return "\(name) isn't set up. Connect it in Settings."
        case "provider_disabled": return "\(name) is turned off in Settings."
        case "unauthorized":
            return provider == "openclaw" ? "The OpenClaw gateway refused this iPhone. Reconnect it in Settings." : "The API key was rejected. Update it in Settings."
        case "unreachable":
            if provider == "openclaw" { return "Can't reach the OpenClaw gateway." }
            return "Can't reach \(name). Are you on Tailscale?"
        case "timeout": return "\(name) went quiet for too long, so the run was stopped."
        case "cancelled": return "Stopped."
        case "pairing_required": return "Approve this iPhone on the OpenClaw gateway. The command is in Settings."
        case "session_not_found": return "This chat's \(name) session no longer exists. Send again to start a new one."
        case "not_received": return "\(name) never got this message. Send it again."
        default:
            return code.hasPrefix("agent_error: ") ? String(code.dropFirst("agent_error: ".count)) : "\(name) answered with an error (\(code))."
        }
    }
}
