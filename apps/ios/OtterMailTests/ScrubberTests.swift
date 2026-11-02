import Testing
@testable import Otter_Mail

struct ScrubberTests {
    @Test func addressAndItsRoute() {
        #expect(Scrubber.scrub("GET https://gmail.googleapis.com/gmail/v1/users/me@gmail.com/threads/18c failed")
            == "GET https://gmail.googleapis.com/gmail/v1/users/[email] failed")
        #expect(Scrubber.scrub("From Jane.Doe+x@Example.CO.uk") == "From [email]")
    }

    @Test func encodedAddress() {
        #expect(Scrubber.scrub("/v1/accounts/me%40gmail.com/labels") == "/v1/accounts/[email]")
    }

    @Test func authorization() {
        #expect(Scrubber.scrub("Authorization: Bearer abc.def-123") == "Authorization: Bearer [redacted]")
        #expect(Scrubber.scrub("basic dXNlcjpwYXNz") == "basic [redacted]")
    }

    @Test func googleTokens() {
        #expect(Scrubber.scrub("token ya29.a0AfH6SMBx-y_z") == "token [token]")
        #expect(Scrubber.scrub("refresh 1//0gAbCdEfGhIjKlMnOpQrStUv") == "refresh [token]")
    }

    @Test func jwt() {
        #expect(Scrubber.scrub("id eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl") == "id [token]")
    }

    @Test func queryString() {
        #expect(Scrubber.scrub("https://relay.mail.otterware.app/v1/search?q=invoice&code=42 failed")
            == "https://relay.mail.otterware.app/v1/search failed")
    }

    @Test func homeFolder() {
        #expect(Scrubber.scrub("/Users/chris/Library/Developer/x.swift") == "/Users/[user]/Library/Developer/x.swift")
    }

    @Test func longOpaqueStrings() {
        #expect(Scrubber.scrub("key " + String(repeating: "a1", count: 30)) == "key [redacted]")
    }

    @Test func keepsWhatsUseful() {
        #expect(Scrubber.scrub("otter-mail-ios@0.8.0+1") == "otter-mail-ios@0.8.0+1")
        #expect(Scrubber.scrub("OtterMail/Mail/MailSync.swift:213 catchUp(_:notify:)") == "OtterMail/Mail/MailSync.swift:213 catchUp(_:notify:)")
        #expect(Scrubber.scrub("The relay answered 500.") == "The relay answered 500.")
    }
}
