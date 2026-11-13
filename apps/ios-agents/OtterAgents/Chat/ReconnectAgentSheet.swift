import SwiftUI

struct ReconnectAgentSheet: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(ChatStore.self) private var store
    let chat: Chat
    var openSettings: () -> Void
    @State private var connecting: String?
    @State private var problem: String?

    private var gateways: [Agent] { store.agents.usable.filter { $0.kind == .openclaw } }

    var body: some View {
        NavigationStack {
            SettingsPage {
                if gateways.isEmpty {
                    SettingsSection(footer: "Connect the OpenClaw gateway this chat ran on, then come back here.") {
                        SettingsButton(title: "Open Settings") {
                            dismiss()
                            openSettings()
                        }
                    }
                } else {
                    SettingsSection(footer: "Choose the OpenClaw gateway this chat ran on. Its session and messages stay.") {
                        ForEach(Array(gateways.enumerated()), id: \.element.id) { index, agent in
                            if index > 0 { SettingsDivider() }
                            Button {
                                connecting = agent.id
                                problem = nil
                                Task {
                                    do {
                                        try await store.reconnect(chat.id, to: agent)
                                        dismiss()
                                    } catch {
                                        problem = error.localizedDescription
                                    }
                                    connecting = nil
                                }
                            } label: {
                                SettingsCell {
                                    AgentAvatar(agent: agent.id, size: 28)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(agent.name).font(.ui(16, .medium)).foregroundStyle(palette.text)
                                        Text(URL(string: agent.string("url"))?.host() ?? agent.string("url"))
                                            .font(.ui(13)).foregroundStyle(palette.muted)
                                    }
                                    Spacer()
                                    if connecting == agent.id { ProgressView() }
                                }
                            }
                            .buttonStyle(.plain)
                            .disabled(connecting != nil)
                        }
                    }
                }
                if let problem { Text(problem).font(.ui(14)).foregroundStyle(palette.error).padding(.horizontal, 8) }
            }
            .navigationTitle("Reconnect agent")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(connecting != nil) }
            }
        }
        .interactiveDismissDisabled(connecting != nil)
    }
}
