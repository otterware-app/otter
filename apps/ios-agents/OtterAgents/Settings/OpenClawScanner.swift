import AVFoundation
import SwiftUI
import Vision
import VisionKit

struct OpenClawScanner: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    let scanned: (String) -> Void
    @State private var ready = false
    @State private var problem: String?
    @State private var denied = false
    @State private var invalid = false

    var body: some View {
        NavigationStack {
            ZStack {
                palette.canvas.ignoresSafeArea()
                if ready {
                    QRScanner { code in
                        guard OpenClaw.setupCode(code) != nil else {
                            invalid = true
                            return false
                        }
                        scanned(code)
                        return true
                    } failed: { message in
                        ready = false
                        problem = message
                    }
                    .ignoresSafeArea(edges: .bottom)
                    .overlay(alignment: .bottom) {
                        Text(invalid ? "That isn't an OpenClaw setup code. Scan the QR code from Pair a device or openclaw qr." : "Point your camera at the gateway's pairing QR code.")
                            .font(.ui(15, .medium))
                            .multilineTextAlignment(.center)
                            .padding(20)
                            .background(.regularMaterial, in: .rect(cornerRadius: 20))
                            .padding(20)
                    }
                } else if let problem {
                    ContentUnavailableView {
                        Label("Camera unavailable", systemImage: "camera")
                    } description: {
                        Text(problem)
                    } actions: {
                        if denied {
                            Button("Open Settings") { openURL(URL(string: UIApplication.openSettingsURLString)!) }
                        }
                    }
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Scan QR code")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .task(id: scenePhase) {
                ready = false
                guard scenePhase == .active else { return }
                problem = nil
                denied = false
                guard DataScannerViewController.isSupported else {
                    problem = "QR scanning isn't available on this device. Paste a setup code on the previous screen."
                    return
                }
                let granted = AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined
                    ? await AVCaptureDevice.requestAccess(for: .video)
                    : AVCaptureDevice.authorizationStatus(for: .video) == .authorized
                guard !Task.isCancelled else { return }
                guard granted else {
                    denied = AVCaptureDevice.authorizationStatus(for: .video) == .denied
                    problem = "Allow camera access to scan a QR code, or paste a setup code on the previous screen."
                    return
                }
                ready = DataScannerViewController.isAvailable
                if !ready { problem = "The camera isn't available right now. Try again or paste a setup code on the previous screen." }
            }
        }
    }
}

private struct QRScanner: UIViewControllerRepresentable {
    let scanned: (String) -> Bool
    let failed: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let controller = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            recognizesMultipleItems: false,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true)
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {
        guard !controller.isScanning else { return }
        do { try controller.startScanning() } catch {
            Task { failed("Couldn't start the camera. Try again or paste a setup code.") }
        }
    }

    static func dismantleUIViewController(_ controller: DataScannerViewController, coordinator: Coordinator) {
        controller.stopScanning()
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let parent: QRScanner
        private var finished = false
        init(_ parent: QRScanner) { self.parent = parent }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !finished else { return }
            for case .barcode(let barcode) in addedItems {
                guard let code = barcode.payloadStringValue else { continue }
                if parent.scanned(code) {
                    finished = true
                    dataScanner.stopScanning()
                    break
                }
            }
        }

        func dataScanner(_ dataScanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
            parent.failed("The camera is no longer available. Try again or paste a setup code.")
        }
    }
}
