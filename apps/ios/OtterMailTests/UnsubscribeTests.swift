import Foundation
import Testing
@testable import Otter_Mail

/** Answers one-click POSTs without the network: 200 from ok.test when the request is RFC 8058's, 500 otherwise. */
nonisolated final class OneClickProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let wellFormed = request.httpMethod == "POST"
            && request.value(forHTTPHeaderField: "Content-Type") == "application/x-www-form-urlencoded"
            && body == "List-Unsubscribe=One-Click"
        let status = request.url?.host == "ok.test" && wellFormed ? 200 : 500
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data())
        client?.urlProtocolDidFinishLoading(self)
    }

    private var body: String? {
        if let data = request.httpBody { return String(decoding: data, as: UTF8.self) }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: buffer.count)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return String(decoding: data, as: UTF8.self)
    }
}

@MainActor
struct UnsubscribeTests {
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OneClickProtocol.self]
        return URLSession(configuration: configuration)
    }()

    private func headers(_ list: String, oneClick: Bool = false) -> [String: String] {
        var headers = ["List-Unsubscribe": list]
        if oneClick { headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click" }
        return headers
    }

    @Test func parsesOneClick() throws {
        let unsubscribe = try #require(Unsubscribe(headers("<mailto:leave@list.test>, <https://ok.test/u?id=1>", oneClick: true)))
        #expect(unsubscribe.web?.absoluteString == "https://ok.test/u?id=1")
        #expect(unsubscribe.mail?.absoluteString == "mailto:leave@list.test")
        #expect(unsubscribe.oneClick)
    }

    @Test func parsesMailtoOnly() throws {
        let unsubscribe = try #require(Unsubscribe(headers("<mailto:leave@list.test?subject=stop>", oneClick: true)))
        #expect(unsubscribe.web == nil)
        #expect(unsubscribe.mail != nil)
        #expect(!unsubscribe.oneClick)
    }

    @Test func parsesHttpsOnlyWithoutOneClick() throws {
        let unsubscribe = try #require(Unsubscribe(headers("<https://ok.test/u>")))
        #expect(unsubscribe.web != nil)
        #expect(unsubscribe.mail == nil)
        #expect(!unsubscribe.oneClick)
    }

    @Test func noneWithoutALink() {
        #expect(Unsubscribe([:]) == nil)
        #expect(Unsubscribe(headers("")) == nil)
        #expect(Unsubscribe(headers("<http://plain.test/u>")) == nil)
        #expect(Unsubscribe(headers("mailto:leave@list.test")) == nil)
    }

    @Test func readsMailtoLikeCore() throws {
        #expect(try Unsubscribe.email(URL(string: "mailto:leave@list.test")!) == .init(to: "leave@list.test", subject: "unsubscribe", body: "unsubscribe"))
        #expect(try Unsubscribe.email(URL(string: "mailto:leave@list.test?subject=Stop%20please&body=bye")!) == .init(to: "leave@list.test", subject: "Stop please", body: "bye"))
    }

    @Test func rejectsMalformedMailto() {
        #expect(throws: Unsubscribe.Failure.notOneAddress) { try Unsubscribe.email(URL(string: "mailto:a@list.test,b@list.test")!) }
        #expect(throws: Unsubscribe.Failure.notOneAddress) { try Unsubscribe.email(URL(string: "mailto:nobody")!) }
        #expect(throws: Unsubscribe.Failure.malformed) {
            try Unsubscribe.email(URL(string: "mailto:leave@list.test?subject=hi%0D%0ABcc:%20x@evil.test")!)
        }
    }

    @Test func oneClickSucceeds() async throws {
        let unsubscribe = try #require(Unsubscribe(headers("<https://ok.test/u>, <mailto:leave@list.test>", oneClick: true)))
        var sent: [Unsubscribe.Email] = []
        let outcome = await unsubscribe.run(session: session, send: { sent.append($0) }, open: { _ in Issue.record("opened"); return true })
        #expect(outcome == .done)
        #expect(sent.isEmpty)
    }

    @Test func refusedOneClickFallsBackToEmail() async throws {
        let unsubscribe = try #require(Unsubscribe(headers("<https://refuse.test/u>, <mailto:leave@list.test?subject=stop>", oneClick: true)))
        var sent: [Unsubscribe.Email] = []
        let outcome = await unsubscribe.run(session: session, send: { sent.append($0) }, open: { _ in Issue.record("opened"); return true })
        #expect(outcome == .done)
        #expect(sent == [.init(to: "leave@list.test", subject: "stop", body: "unsubscribe")])
    }

    @Test func failedEmailIsReported() async throws {
        let unsubscribe = try #require(Unsubscribe(headers("<mailto:leave@list.test>")))
        let outcome = await unsubscribe.run(session: session, send: { _ in throw Draft.Failure.mailboxUnavailable }, open: { _ in true })
        #expect(outcome == .failed(Draft.Failure.mailboxUnavailable.localizedDescription))
    }

    @Test func httpsOnlyOpensThePage() async throws {
        let unsubscribe = try #require(Unsubscribe(headers("<https://ok.test/u>")))
        var opened: [URL] = []
        let outcome = await unsubscribe.run(session: session, send: { _ in Issue.record("sent") }, open: { opened.append($0); return true })
        #expect(outcome == .openedPage)
        #expect(opened == [URL(string: "https://ok.test/u")!])
    }

    @Test func plusInMailtoIsASpace() throws {
        let email = try Unsubscribe.email(URL(string: "mailto:leave@list.test?subject=please+remove&body=stop+mail")!)
        #expect(email.subject == "please remove")
        #expect(email.body == "stop mail")
    }

    /** As URLSearchParams reads it: an encoded "+" is a plus, and the rest decodes as before. */
    @Test func encodedPlusInMailtoStaysAPlus() throws {
        let email = try Unsubscribe.email(URL(string: "mailto:leave@list.test?subject=token%2Bvalue&body=a+b%20c%26d")!)
        #expect(email.subject == "token+value")
        #expect(email.body == "a b c&d")
    }

    @Test func refusedOneClickOpensThePageWhenThereIsNoMailto() async throws {
        let unsubscribe = try #require(Unsubscribe(headers("<https://bad.test/u>", oneClick: true)))
        var opened: URL?
        let outcome = await unsubscribe.run(session: session, send: { _ in Issue.record("should not send"); throw Failure() }, open: { opened = $0; return true })
        #expect(outcome == .openedPage)
        #expect(opened?.absoluteString == "https://bad.test/u")
    }

    @Test func openReturningFalseIsAFailure() async throws {
        let unsubscribe = try #require(Unsubscribe(headers("<https://ok.test/u>")))
        let outcome = await unsubscribe.run(session: session, send: { _ in }, open: { _ in false })
        #expect(outcome == .failed("Couldn't open the unsubscribe page."))
    }

    private struct Failure: Error {}
}
