import SwiftUI

struct SettingsScreen: View {
    @Environment(\.palette) var palette
    @Environment(\.openURL) private var openURL
    @Environment(Account.self) var account
    @Environment(Preferences.self) private var preferences
    @Binding var path: [Route]

    var body: some View {
        @Bindable var preferences = preferences
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
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(palette.tertiary)
                    }
                    .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
            }
            SettingsSection(title: "Agents") {
                ForEach(agents.runnable) { agent in
                    Button { path.append(.agent(agent.id)) } label: {
                        SettingsRow(title: agent.name, value: agent.statusText) { AgentAvatar(agent: agent.id, size: 22) }
                    }
                    .buttonStyle(.plain)
                    if agent.kind == .openclaw {
                        ForEach(agent.models) { resolved in
                            SettingsDivider()
                            SettingsCell {
                                AgentAvatar(agent: agent.id, gatewayAgent: resolved.slug, size: 22)
                                Toggle(resolved.name, isOn: Binding(
                                    get: { agent.isGatewayAgentEnabled(resolved.slug) },
                                    set: { agents.setGatewayAgentEnabled(agent, resolved.slug, $0) }))
                                    .font(.ui(15)).foregroundStyle(palette.text)
                            }
                            .padding(.leading, 35)
                            .disabled(!agent.enabled)
                        }
                    }
                    SettingsDivider()
                }
                Menu {
                    ForEach(AgentKind.allCases) { kind in
                        Button(kind.name) { path.append(.agent(agents.add(kind).id)) }
                    }
                } label: {
                    SettingsRow("Add agent", symbol: "plus", chevron: false)
                }
                .buttonStyle(.plain)
            }
            SettingsSection {
                if !account.isDemo {
                    Button { path.append(.chatSettings) } label: { SettingsRow("Chat", symbol: "bubble.left.and.bubble.right") }.buttonStyle(.plain)
                }
                SettingsCell {
                    SettingsSymbol(name: "circle.lefthalf.filled").frame(width: 24)
                    Text("Color scheme").font(.ui(16)).foregroundStyle(palette.text)
                    Spacer()
                    Picker("Color scheme", selection: $preferences.scheme) {
                        ForEach(Preferences.Scheme.allCases) { Text($0.title).tag($0) }
                    }
                    .labelsHidden()
                    .tint(palette.muted)
                }
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
        return SettingsSection(footer: "When an agent finishes, needs your approval, has a question, or sends you a message. Notifications name the chat and the agent, never what was said.") {
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
        let choices = agents.runnable.filter(\.enabled)
        SettingsPage {
            if !choices.isEmpty {
                SettingsSection(footer: "The agent a new chat runs on. You can switch in the chat's agent picker.") {
                    SettingsCell {
                        Text("New chats start with").font(.ui(16)).foregroundStyle(palette.text)
                        Spacer()
                        Picker("New chats start with", selection: Binding(get: { agents.selected ?? "" }, set: { id in agents.agent(id).map(agents.select) })) {
                            ForEach(choices) { Text($0.name).tag($0.id) }
                        }
                        .labelsHidden()
                        .tint(palette.muted)
                    }
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
                SettingsSection(footer: "Your chats, agents and settings follow your Otter account to the Mac, the web and Otter Mail.") {
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
