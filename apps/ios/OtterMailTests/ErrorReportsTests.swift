import Sentry
import Testing
@testable import Otter_Mail

struct ErrorReportsTests {
    @Test func hangsComeFromMetricKitNotTheHangTracker() {
        let options = Options()
        ErrorReports.configure(options)
        #expect(!options.enableAppHangTracking)
        #expect(options.enableMetricKit)
    }

    @Test func reportsSayWhatHappenedWithoutShowingTheScreen() {
        let options = Options()
        ErrorReports.configure(options)
        #expect(options.tracesSampleRate == 1)
        #expect(options.enableAutoPerformanceTracing)
        #expect(!options.attachScreenshot)
        #expect(!options.attachViewHierarchy)
        #expect(options.enableNetworkBreadcrumbs)
        #expect(options.enableAutoBreadcrumbTracking)
        #expect(options.sessionReplay.sessionSampleRate == 0)
        #expect(options.sessionReplay.onErrorSampleRate == 0)
        #expect(!options.enableMetricKitRawPayload)
        #expect(options.beforeSend != nil)
    }
}
