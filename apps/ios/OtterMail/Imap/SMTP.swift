import Foundation

/**
 * Sending over SMTP (RFC 5321): TLS or STARTTLS, AUTH PLAIN, LOGIN or
 * XOAUTH2, then the message with its lines dot-stuffed. One connection per
 * message; the phone sends too rarely to keep one open.
 */
nonisolated enum SMTP {
    static func send(_ message: Data, from: String, to recipients: [String], server: MailServer, username: String, auth: MailAuth) async throws {
        let socket = try await session(server, username: username, auth: auth)
        defer { socket.close() }
        try await expect(socket, "MAIL FROM:<\(from)>", 250)
        for recipient in recipients { try await expect(socket, "RCPT TO:<\(recipient)>", 250, 251) }
        try await expect(socket, "DATA", 354)
        try await socket.write(stuffed(message))
        try await expect(socket, ".", 250)
        _ = try? await reply(socket, "QUIT")
    }

    /** Logs in and out, to check the settings before saving them. */
    static func verify(_ server: MailServer, username: String, auth: MailAuth) async throws {
        let socket = try await session(server, username: username, auth: auth)
        _ = try? await reply(socket, "QUIT")
        socket.close()
    }

    private static func session(_ server: MailServer, username: String, auth: MailAuth) async throws -> MailSocket {
        let socket = try await MailSocket.open(server)
        do {
            guard try await reply(socket, nil).code == 220 else { throw ImapError.protocolError("\(server.host) isn't answering as a mail server.") }
            var extensions = try await ehlo(socket)
            if server.security == .starttls {
                guard extensions.contains("STARTTLS") else {
                    throw ImapError.protocolError("\(server.host) doesn't offer STARTTLS. Try port 465 with TLS.")
                }
                try await expect(socket, "STARTTLS", 220)
                try await socket.startTLS()
                extensions = try await ehlo(socket)
            }
            let methods = Set(extensions.first { $0.hasPrefix("AUTH ") }?.split(separator: " ").dropFirst().map(String.init) ?? [])
            do {
                switch auth {
                case .oauth:
                    try await expect(socket, "AUTH XOAUTH2 \(auth.sasl(username))", 235)
                case .password(let password) where !methods.contains("PLAIN") && methods.contains("LOGIN"):
                    try await expect(socket, "AUTH LOGIN", 334)
                    try await expect(socket, Data(username.utf8).base64EncodedString(), 334)
                    try await expect(socket, Data(password.utf8).base64EncodedString(), 235)
                case .password:
                    try await expect(socket, "AUTH PLAIN \(auth.sasl(username))", 235)
                }
            } catch ImapError.server(let text) {
                throw ImapError.authentication(text)
            }
            return socket
        } catch {
            socket.close()
            throw error
        }
    }

    private static func ehlo(_ socket: MailSocket) async throws -> [String] {
        let (code, lines) = try await reply(socket, "EHLO [127.0.0.1]")
        guard code == 250 else { throw ImapError.server(lines.joined(separator: " ")) }
        return lines.dropFirst().map { $0.uppercased() }
    }

    private static func expect(_ socket: MailSocket, _ command: String, _ codes: Int...) async throws {
        let (code, lines) = try await reply(socket, command)
        guard codes.contains(code) else { throw ImapError.server(lines.joined(separator: " ")) }
    }

    private static func reply(_ socket: MailSocket, _ command: String?) async throws -> (code: Int, lines: [String]) {
        if let command { try await socket.write("\(command)\r\n") }
        var lines: [String] = []
        while true {
            let line = String(decoding: try await socket.readLine(), as: UTF8.self)
            lines.append(String(line.dropFirst(4)))
            if line.count < 4 || line[line.index(line.startIndex, offsetBy: 3)] != "-" {
                return (Int(line.prefix(3)) ?? 0, lines)
            }
        }
    }

    /** CRLF line ends, and a dot doubled at the start of a line (so a lone "." can end the message). */
    static func stuffed(_ message: Data) -> Data {
        let text = String(decoding: message, as: UTF8.self)
            .replacingOccurrences(of: "\r\n", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.hasPrefix(".") ? ".\($0)" : String($0) }
            .joined(separator: "\r\n")
        return Data((text.hasSuffix("\r\n") ? text : text + "\r\n").utf8)
    }
}
