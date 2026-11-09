import SwiftUI

/**
 * Leaving a mailing list, from its List-Unsubscribe header (core's
 * unsubscribe.ts): one click when the sender supports it (RFC 8058), else an
 * email to its unsubscribe address, else its page.
 */
struct Unsubscribe {
    let web: URL?
    let mail: URL?
    let oneClick: Bool

    enum Outcome: Equatable {
        case done
        case openedPage
        case failed(String)
    }

    struct Email: Equatable {
        let to: String
        let subject: String
        let body: String
    }

    enum Failure: LocalizedError {
        case notOneAddress, malformed
        var errorDescription: String? {
            switch self {
            case .notOneAddress: "This message's unsubscribe address isn't one address."
            case .malformed: "This message's unsubscribe link is malformed."
            }
        }
    }

    init?(_ headers: [String: String]) {
        guard let header = headers["List-Unsubscribe"] else { return nil }
        let links = header.matches(of: #/<([^>]+)>/#).compactMap { URL(string: $0.1.trimmingCharacters(in: .whitespaces)) }
        web = links.first { $0.scheme?.lowercased() == "https" }
        mail = links.first { $0.scheme?.lowercased() == "mailto" }
        oneClick = web != nil && headers["List-Unsubscribe-Post"]?.localizedCaseInsensitiveContains("One-Click") == true
        if web == nil && mail == nil { return nil }
    }

    /** The email a mailto link asks for, as core's `unsubscribeEmail` reads it. */
    static func email(_ mailto: URL) throws -> Email {
        guard let components = URLComponents(url: mailto, resolvingAgainstBaseURL: false) else { throw Failure.malformed }
        // URLSearchParams turns a bare "+" into a space before it decodes, so "%2B" stays a "+".
        let query = { (name: String) -> String? in
            guard let raw = components.percentEncodedQueryItems?.first(where: { $0.name.lowercased() == name })?.value else { return nil }
            let spaced = raw.replacingOccurrences(of: "+", with: " ")
            return spaced.removingPercentEncoding ?? spaced
        }
        let to = components.path.trimmingCharacters(in: .whitespaces)
        let subject = query("subject") ?? "unsubscribe"
        let body = query("body") ?? "unsubscribe"
        let part = #"[^\s@<>()\[\]\\,;:"]+"#
        guard to.range(of: "^\(part)@\(part)\\.\(part)$", options: .regularExpression) != nil else { throw Failure.notOneAddress }
        guard !subject.contains(where: \.isNewline) else { throw Failure.malformed }
        return Email(to: to, subject: subject, body: body)
    }

    func run(
        session: URLSession = .shared,
        send: (Email) async throws -> Void,
        open: (URL) async -> Bool = { await UIApplication.shared.open($0) }
    ) async -> Outcome {
        if oneClick, let web {
            var request = URLRequest(url: web, timeoutInterval: 15)
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data("List-Unsubscribe=One-Click".utf8)
            if let (_, response) = try? await session.data(for: request),
               (200..<300).contains((response as? HTTPURLResponse)?.statusCode ?? 0) {
                return .done
            }
        }
        if let mail {
            do {
                try await send(Self.email(mail))
                return .done
            } catch is CancellationError {
                return .failed("Cancelled.")
            } catch {
                return .failed(error.localizedDescription)
            }
        }
        if let web {
            return await open(web) ? .openedPage : .failed("Couldn't open the unsubscribe page.")
        }
        return .failed("This message has no unsubscribe link.")
    }

    /** Sends the mailto request from `mailbox` through the store, like any sent mail. */
    func run(from mailbox: Mailbox, store: MailStore) async -> Outcome {
        // The demo's lists are made up: nothing is posted, sent or opened.
        guard !store.isDemo else { return .done }
        return await run(send: { email in
            var draft = Draft.new(from: mailbox, to: email.to)
            draft.subject = email.subject
            draft.body = email.body
            try await store.send(draft)
        })
    }
}

extension Unsubscribe.Outcome {
    func notice(from sender: String) -> String {
        switch self {
        case .done: "Unsubscribed from \(sender)"
        case .openedPage: "Finish unsubscribing from \(sender) on their page"
        case .failed(let reason): "Couldn't unsubscribe: \(reason)"
        }
    }

    func haptic() {
        UINotificationFeedbackGenerator().notificationOccurred(self == .done || self == .openedPage ? .success : .error)
    }
}

/** A passing note at the bottom, styled like the Undo banner. */
struct NoticeBanner: View {
    @Environment(\.palette) private var palette
    let text: String

    var body: some View {
        Text(text)
            .font(.inter(.subheadline))
            .lineLimit(2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .foregroundStyle(palette.text)
            .padding(16)
            .background(palette.raised, in: .rect(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(palette.border))
            .padding(.horizontal, 16)
            .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}
