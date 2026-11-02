import StoreKit
import SwiftUI

struct WelcomeView: View {
    @Environment(Session.self) private var session
    @Environment(\.palette) private var palette
    @State private var error: String?
    @State private var offersDemo = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            Image("OtterMark")
                .resizable()
                .scaledToFill()
                .frame(width: 112, height: 112)
                .clipShape(.rect(cornerRadius: 26))
                .padding(.bottom, 28)
            Text("Otter Mail")
                .font(.inter(size: 34, weight: .semibold))
                .foregroundStyle(palette.text)
            Text("A calm, fast Gmail client.")
                .font(.inter(.title3))
                .foregroundStyle(palette.muted)
                .padding(.top, 6)
            Spacer()

            VStack(spacing: 12) {
                Button {
                    Task {
                        do {
                            try await session.signIn()
                            await session.requestNotifications()
                        } catch GoogleAuth.Failure.cancelled {
                        } catch {
                            self.error = error.localizedDescription
                        }
                    }
                } label: {
                    Label(session.busy ?? "Sign in with Google", systemImage: "person.crop.circle")
                        .font(.inter(.headline))
                        .foregroundStyle(palette.actionText)
                        .frame(maxWidth: .infinity, minHeight: 34)
                }
                .buttonStyle(.glassProminent)
                .disabled(session.busy != nil)

                if offersDemo {
                    Button {
                        session.tryDemo()
                    } label: {
                        Text("Try the demo mailbox")
                            .font(.inter(.headline))
                            .frame(maxWidth: .infinity, minHeight: 34)
                    }
                    .buttonStyle(.glass)
                    .disabled(session.busy != nil)
                }

                Text("Your mail goes straight between this iPhone and Gmail. Your mailboxes, themes and settings follow your Otter account to the Mac and the web.")
                    .font(.inter(.footnote))
                    .foregroundStyle(palette.muted)
                    .multilineTextAlignment(.center)
                    .padding(.top, 8)
            }
            .padding(.horizontal, 28)
            .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity)
        .background(palette.canvas)
        .task {
            guard let result = try? await AppTransaction.shared else { return offersDemo = true }
            let environment = switch result {
            case .verified(let transaction), .unverified(let transaction, _): transaction.environment
            }
            offersDemo = environment != .production
        }
        .alert("Couldn't sign in", isPresented: .constant(error != nil)) {
            Button("OK") { error = nil }
        } message: {
            Text(error ?? "")
        }
    }
}

