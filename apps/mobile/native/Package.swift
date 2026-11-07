// swift-tools-version: 6.2
import PackageDescription

// The notification service extension's code (all but its entry point), as a package so its
// tests run on the Mac: `swift test --package-path apps/mobile/native`.
let package = Package(
    name: "OtterMailNotifications",
    platforms: [.macOS(.v26), .iOS(.v26)],
    targets: [
        .target(
            name: "NotificationKit",
            path: ".",
            exclude: ["NotificationService/NotificationService.swift", "NotificationService/Info.plist",
                      "NotificationService/NotificationService.entitlements", "Tests"],
            sources: ["NotificationShared", "NotificationService/Imap"],
            swiftSettings: [.enableUpcomingFeature("ApproachableConcurrency")]
        ),
        .testTarget(name: "NotificationTests", dependencies: ["NotificationKit"], path: "Tests/NotificationTests"),
    ]
)
