import SwiftUI

struct SettingsScreen: View {
    @Environment(\.palette) var palette
    @Environment(\.openURL) private var openURL
    @Environment(Account.self) var account
    @Environment(Preferences.self) private var preferences
    @Binding var path: [Route]

    var body: some View {
        let agents = account.agents
        SettingsPage {
            SettingsSection {
                Button { path.append(.account) } label: {
                    SettingsCell {
                        Text(String((account.user?.name ?? account.user?.email ?? "D").prefix(1)).uppercased())
                            .font(.ui(17, .semibold))
                            .foregroundStyle(palette.actionText)
                            .frame(width: 38, height: 38)
                            .background(palette.action, in: .circle)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(account.isDemo ? "Demo" : account.user?.name ?? "Otter account").font(.ui(16, .medium)).foregroundStyle(palette.text)
                            Text(account.isDemo ? "Pretend chats, on this iPhone only" : account.user?.email ?? "").font(.ui(14)).foregroundStyle(palette.muted).lineLimit(1)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(palette.muted.opacity(0.45))
                    }
                    .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
            }
            if !account.isDemo {
                SettingsSection(title: "Agents") {
                    ForEach(AgentKind.allCases) { kind in
                        Button { path.append(.agent(kind)) } label: {
                            SettingsRow(title: kind.name, value: agents.statusText(kind)) { AgentAvatar(provider: kind.rawValue, size: 22) }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            SettingsSection {
                if !account.isDemo {
                    Button { path.append(.chatSettings) } label: { SettingsRow("Chat", symbol: "bubble.left.and.bubble.right") }.buttonStyle(.plain)
                }
                Button { path.append(.appearance) } label: {
                    SettingsRow("Appearance", symbol: "paintbrush", value: preferences.scheme.title)
                }
                .buttonStyle(.plain)
            }
            notifications
            SettingsSection(title: "About") {
                SettingsRow("Version", symbol: "info.circle", value: Bundle.main.version, chevron: false)
                Button { openURL(URL(string: "https://otterware.app/mail/privacy")!) } label: { SettingsRow("Privacy policy", symbol: "hand.raised") }.buttonStyle(.plain)
                Button { openURL(URL(string: "https://otterware.app/mail/terms")!) } label: { SettingsRow("Terms", symbol: "doc.text") }.buttonStyle(.plain)
                Button { path.append(.licenses) } label: { SettingsRow("Open-source licenses", symbol: "doc.plaintext") }.buttonStyle(.plain)
            }
        }
        .navigationTitle("Settings")
    }
}

extension SettingsScreen {
    private var notifications: some View {
        @Bindable var account = account
        return SettingsSection(footer: "When an agent finishes, needs your approval, has a question, or sends you a message. Notifications show the chat and a preview, read directly from your agent on this iPhone.") {
            SettingsCell {
                SettingsSymbol(name: "bell.badge").frame(width: 24)
                Toggle("Notifications", isOn: $account.notifications).font(.ui(16)).foregroundStyle(palette.text)
            }
        }
    }
}

struct ChatSettings: View {
    @Environment(\.palette) private var palette
    @Environment(Account.self) private var account

    var body: some View {
        @Bindable var agents = account.agents
        SettingsPage {
            SettingsSection(footer: "The agent a new chat runs on. You can switch in the chat's model picker.") {
                SettingsCell {
                    Text("New chats start with").font(.ui(16)).foregroundStyle(palette.text)
                    Spacer()
                    Picker("New chats start with", selection: $agents.selected) {
                        ForEach(AgentKind.allCases.filter(agents.isEnabled)) { Text($0.name).tag($0.rawValue) }
                    }
                    .labelsHidden()
                    .tint(palette.muted)
                }
            }
            SettingsSection(footer: "Queue follow-ups while the agent runs or steer the current run. Touch and hold Send to do the opposite for one message.") {
                SettingsCell {
                    Text("Follow-up behavior").font(.ui(16)).foregroundStyle(palette.text)
                    Spacer()
                    Picker("Follow-up behavior", selection: $agents.followUp) {
                        ForEach(Agents.FollowUp.allCases) { Text($0.title).tag($0) }
                    }
                    .labelsHidden()
                    .tint(palette.muted)
                }
            }
        }
        .navigationTitle("Chat")
    }
}

struct AppearanceSettings: View {
    @Environment(\.palette) private var palette
    @Environment(Preferences.self) private var preferences

    var body: some View {
        @Bindable var preferences = preferences
        VStack(spacing: 0) {
            Picker("Appearance", selection: $preferences.scheme) {
                ForEach(Preferences.Scheme.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            ThemeSettings()
        }
        .background(palette.canvas)
        .navigationTitle("Appearance")
        .toolbarTitleDisplayMode(.inline)
    }
}

struct AccountSettings: View {
    @Environment(\.palette) private var palette
    @Environment(Account.self) private var account
    @State private var deleting = false
    @State private var error: String?

    var body: some View {
        SettingsPage {
            if account.isDemo {
                SettingsSection(footer: "The demo's chats are made up and stay on this iPhone. Sign in to chat with your own agents.") {
                    SettingsButton(title: "Leave the demo") { account.leaveDemo() }
                }
            } else if let user = account.user {
                SettingsSection(footer: "Your chats, agents and themes follow your Otter account to the Mac, the web and Otter Mail.") {
                    SettingsRow("Signed in as", symbol: "person.crop.circle", value: user.email, chevron: false)
                }
                SettingsSection {
                    SettingsButton(title: "Sign out") { Task { await account.signOut() } }
                }
                SettingsSection(footer: "Deletes your Otter account everywhere: its chats, linked mailboxes and settings. Your mail itself stays with your mail provider.") {
                    SettingsButton(title: "Delete Otter account…", destructive: true) { deleting = true }
                }
            }
        }
        .navigationTitle("Otter account")
        .confirmationDialog("Delete your Otter account?", isPresented: $deleting, titleVisibility: .visible) {
            Button("Delete account", role: .destructive) {
                Task { do { try await account.deleteAccount() } catch { self.error = error.localizedDescription } }
            }
        } message: {
            Text("This can't be undone.")
        }
        .alert("Couldn't delete the account", isPresented: .constant(error != nil)) {
            Button("OK") { error = nil }
        } message: {
            Text(error ?? "")
        }
    }
}
