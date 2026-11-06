import Foundation
import Network
import Security
import Testing
@testable import Otter_Mail

struct ConnectionLossTests {
    @Test func abortedIsLost() {
        let error = NWTransport.lost(.posix(.ECONNABORTED)) as? URLError
        #expect(error?.code == .networkConnectionLost)
        #expect(error?.userInfo[NSUnderlyingErrorKey] as? NWError == .posix(.ECONNABORTED))
        #expect((NWTransport.lost(.posix(.ECONNRESET)) as? URLError)?.code == .networkConnectionLost)
        #expect((NWTransport.lost(.posix(POSIXErrorCode(rawValue: 57)!)) as? URLError)?.code == .networkConnectionLost)
    }

    @Test func offlineAndTimeout() {
        #expect((NWTransport.lost(.posix(.ENETDOWN)) as? URLError)?.code == .notConnectedToInternet)
        #expect((NWTransport.lost(.posix(.ETIMEDOUT)) as? URLError)?.code == .timedOut)
    }

    @Test func othersStay() {
        #expect(NWTransport.lost(.posix(.ECANCELED)) as? NWError == .posix(.ECANCELED))
        #expect(NWTransport.lost(.posix(.ECONNREFUSED)) as? NWError == .posix(.ECONNREFUSED))
        #expect(NWTransport.lost(.tls(errSSLBadCert)) as? NWError == .tls(errSSLBadCert))
    }

    @Test func cancelledAfterTheNetworkFailedItIsThatFailure() {
        #expect((NWTransport.lost(.posix(.ECANCELED), failure: .posix(.ECONNABORTED)) as? URLError)?.code == .networkConnectionLost)
        #expect((NWTransport.lost(.posix(.ECANCELED), failure: .posix(.ENETDOWN)) as? URLError)?.code == .notConnectedToInternet)
        #expect(NWTransport.lost(.posix(.ECANCELED), failure: .tls(errSSLBadCert)) as? NWError == .tls(errSSLBadCert))
        #expect((NWTransport.lost(.posix(.ECONNRESET), failure: .posix(.ENETDOWN)) as? URLError)?.code == .networkConnectionLost)
    }

    @Test func aServerHangingUpIsTheConnectionNotTheSync() {
        #expect(ImapError.closed.isConnectionFailure)
        #expect(ImapError.timedOut.isConnectionFailure)
        #expect(!ImapError.server("NO").isConnectionFailure)
        #expect(!ImapError.protocolError("Bad").isConnectionFailure)
    }

    @Test func onlyADroppedConnectionIsTriedAgain() {
        #expect(ImapProvider.lostConnection(ImapError.closed))
        #expect(ImapProvider.lostConnection(URLError(.networkConnectionLost)))
        #expect(!ImapProvider.lostConnection(ImapError.timedOut))
        #expect(!ImapProvider.lostConnection(ImapError.server("NO")))
        #expect(!ImapProvider.lostConnection(URLError(.cancelled)))
    }
}
