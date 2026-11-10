import StoreKit
import SwiftUI

struct WelcomeView: View {
    @Environment(Account.self) private var account
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
            HStack(spacing: 8) {
                Text("Otter").foregroundStyle(palette.text)
                Text("Agents").foregroundStyle(palette.muted)
            }
            .font(.ui(34, .semibold))
            .tracking(-0.8)
            Text("Your agents, wherever you are.")
                .font(.ui(19))
                .foregroundStyle(palette.muted)
                .padding(.top, 6)
            Spacer()

            VStack(spacing: 12) {
                Button {
                    Task {
                        do { try await account.signIn() } catch GoogleSignIn.Failure.cancelled {} catch { self.error = error.localizedDescription }
                    }
                } label: {
                    Label(account.busy ?? "Sign in with Google", systemImage: "person.crop.circle")
                        .font(.ui(17, .semibold))
                        .foregroundStyle(palette.actionText)
                        .frame(maxWidth: .infinity, minHeight: 34)
                }
                .buttonStyle(.glassProminent)
                .disabled(account.busy != nil)

                if offersDemo {
                    Button { account.tryDemo() } label: {
                        Text("Try the demo").font(.ui(17, .semibold)).frame(maxWidth: .infinity, minHeight: 34)
                    }
                    .buttonStyle(.glass)
                    .disabled(account.busy != nil)
                }

                Text("Chat with the agents on your Otter account: Otter's own, Hermes, OpenClaw and varys. Every chat is the same here, on the Mac and on the web.")
                    .font(.ui(13))
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
            // The demo is for trying a build, not for the App Store's.
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
