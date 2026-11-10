import SwiftUI

/** One agent: whether it's on, how this iPhone reaches it, and what it runs chats with. */
struct AgentSettings: View {
    @Environment(\.palette) private var palette
    @Environment(\.openURL) private var openURL
    @Environment(Account.self) private var account
    let kind: AgentKind

    @State private var url = ""
    @State private var key = ""
    @State private var code = ""
    @State private var token = ""
    @State private var alternate = false
    @State private var connecting = false
    @State private var error: String?

    private var agents: Agents { account.agents }
    private var status: Agents.Status { agents.status(of: kind) }

    var body: some View {
        SettingsPage {
            SettingsSection {
                SettingsCell {
                    AgentAvatar(provider: kind.rawValue, size: 30)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(kind.name).font(.ui(16, .medium)).foregroundStyle(palette.text)
                        Text(agents.statusText(kind)).font(.ui(14))
                            .foregroundStyle(status == .ready && agents.isEnabled(kind) ? Status.done : { if case .failed = status { palette.error } else { palette.muted } }())
                    }
                    Spacer()
                    Toggle(kind.name, isOn: Binding(get: { agents.isEnabled(kind) }, set: { agents.setEnabled(kind, $0) })).labelsHidden()
                }
                .padding(.vertical, 6)
            }
            if agents.isEnabled(kind) {
                switch kind {
                case .openrouter: openRouter
                case .hermes: hermes
                case .openclaw: openClaw
                case .varys: varys
                }
                if let problem {
                    Text(problem).font(.ui(14)).foregroundStyle(palette.error).padding(.horizontal, 8)
                }
            }
        }
        .navigationTitle(kind.name)
        .onAppear { url = kind == .hermes ? agents.hermes.baseUrl : "" }
        .task(id: agents.isEnabled(kind)) { await agents.check(kind) }
    }

    private var problem: String? {
        if let error { return error }
        if case .failed(let message) = status { return message }
        return nil
    }

    private func run(_ work: @escaping () async throws -> Void) {
        connecting = true
        error = nil
        Task {
            do {
                try await work()
                key = ""
                code = ""
                token = ""
            } catch {
                self.error = error.localizedDescription
            }
            connecting = false
        }
    }

    @ViewBuilder
    private func modelPicker(_ title: String, default label: String, labelled: @escaping (Hermes.Model) -> String = { $0.name }) -> some View {
        let models = agents.models(of: kind).filter { !$0.slug.isEmpty }
        if !models.isEmpty {
            SettingsCell {
                Text(title).font(.ui(16)).foregroundStyle(palette.text)
                Spacer()
                Picker(title, selection: Binding(get: { agents.chosenModel(kind) }, set: { agents.choose(model: $0, for: kind) })) {
                    Text(label).tag("")
                    ForEach(models) { Text(labelled($0)).tag($0.slug) }
                }
                .labelsHidden()
                .tint(palette.muted)
            }
        }
    }

    // MARK: Otter's agent

    @ViewBuilder
    private var openRouter: some View {
        let signedIn = account.relay.isSignedIn
        SettingsSection(footer: signedIn
            ? "Otter's own agent, run for your Otter account through OpenRouter. The API key stays on Otter's server. Your prompts go to Otter's server, OpenRouter and the model's provider; chats stay until you delete them or your Otter account. Usage is billed to your OpenRouter account."
            : "Sign in to your Otter account to connect OpenRouter.") {
            SettingsField(placeholder: "OpenRouter API key", text: $key, secret: true)
            SettingsDivider()
            SettingsButton(title: connecting ? "Connecting…" : agents.hasOpenRouterKey ? "Update key" : "Connect") {
                run { try await agents.connectOpenRouter(key: key) }
            }
            .disabled(key.isEmpty || connecting || !signedIn)
        }
        if agents.hasOpenRouterKey {
            SettingsSection {
                modelPicker("Model", default: "Server default")
                SettingsDivider()
                SettingsButton(title: "Disconnect", destructive: true) { run { try await agents.disconnectOpenRouter() } }
            }
        }
        SettingsSection {
            Button { openURL(URL(string: "https://openrouter.ai/settings/keys")!) } label: { SettingsRow("Get an API key", symbol: "key") }.buttonStyle(.plain)
            Button { openURL(URL(string: "https://openrouter.ai/activity")!) } label: { SettingsRow("Usage and credits", symbol: "chart.bar") }.buttonStyle(.plain)
        }
    }

    // MARK: Hermes

    @ViewBuilder
    private var hermes: some View {
        @Bindable var agents = account.agents
        let footer = "Your agent server, reached from every device. Chats live on it, so they're the same here, on the Mac and on the web. The key follows your Otter account, sealed."
        if agents.hasHermesKey, !agents.hermes.baseUrl.isEmpty {
            SettingsSection(footer: footer) {
                SettingsRow("Server", symbol: "server.rack", value: URL(string: agents.hermes.baseUrl)?.host() ?? agents.hermes.baseUrl, chevron: false)
                modelPicker("Model", default: "Hermes' default") { model in model.subProvider.map { "\(model.name) · \($0)" } ?? model.name }
                if let model = agents.model(of: .hermes), model.reasoning {
                    SettingsCell {
                        Text("Reasoning").font(.ui(16)).foregroundStyle(palette.text)
                        Spacer()
                        Picker("Reasoning", selection: $agents.hermes.reasoningEffort) {
                            ForEach(Agents.efforts(model), id: \.id) { Text($0.label).tag($0.id) }
                        }
                        .labelsHidden()
                        .tint(palette.muted)
                    }
                }
                if let model = agents.model(of: .hermes), model.fast {
                    SettingsCell {
                        Toggle("Fast", isOn: Binding(get: { agents.hermes.serviceTier == "priority" }, set: { agents.hermes.serviceTier = $0 ? "priority" : "default" }))
                            .font(.ui(16)).foregroundStyle(palette.text)
                    }
                }
                SettingsDivider()
                SettingsButton(title: "Disconnect", destructive: true) { agents.disconnectHermes() }
            }
        } else {
            SettingsSection(footer: footer) {
                SettingsField(placeholder: "https://hermes.example:8642", text: $url, url: true)
                SettingsDivider()
                SettingsField(placeholder: "API key", text: $key, secret: true)
                SettingsDivider()
                SettingsButton(title: connecting ? "Connecting…" : "Connect") { run { await agents.connectHermes(url: url, key: key) } }
                    .disabled(url.isEmpty || key.isEmpty || connecting)
            }
        }
    }

    // MARK: OpenClaw

    @ViewBuilder
    private var openClaw: some View {
        let footer = "Your OpenClaw gateway, usually over Tailscale. Make a setup code on it with openclaw qr --setup-code-only and paste it here, then approve this iPhone there. Chats live on the gateway, so they're the same everywhere; this iPhone's key and tokens stay on it."
        if status == .ready {
            SettingsSection(footer: footer) {
                SettingsRow("Gateway", symbol: "network", value: URL(string: agents.openclaw.url)?.host() ?? agents.openclaw.url, chevron: false)
                modelPicker("Agent", default: "The gateway's default")
                SettingsDivider()
                SettingsButton(title: "Disconnect", destructive: true) { agents.disconnectOpenClaw() }
            }
            if agents.openClawFullAccess == false {
                if let request = agents.openClawFullAccessRequest {
                    approve("Approve full access on the gateway:", request: request)
                } else {
                    SettingsSection(footer: "This iPhone was paired with less than OpenClaw's own apps have, so the agent won't use your devices for what you ask here, and its questions may not reach you.") {
                        SettingsButton(title: "Allow full access") { Task { await agents.allowOpenClawFullAccess() } }
                    }
                }
            }
        } else if let request = agents.openClawPairing {
            approve("Approve this iPhone on the gateway:", request: request)
            SettingsSection {
                SettingsButton(title: "Check again") { Task { await agents.check(.openclaw) } }
                SettingsDivider()
                SettingsButton(title: "Disconnect", destructive: true) { agents.disconnectOpenClaw() }
            }
        } else {
            SettingsSection(footer: footer) {
                SettingsField(placeholder: "Setup code", text: $code, secret: true)
                SettingsDivider()
                SettingsButton(title: connecting ? "Connecting…" : "Connect") { run { try await agents.connectOpenClaw(code: code) } }
                    .disabled(code.isEmpty || connecting)
            }
            SettingsSection {
                SettingsButton(title: alternate ? "Use a setup code" : "Use the gateway's token instead") { withAnimation { alternate.toggle() } }
                if alternate {
                    SettingsDivider()
                    SettingsField(placeholder: "wss://computer.tailnet.ts.net", text: $url, url: true)
                    SettingsDivider()
                    SettingsField(placeholder: "Gateway token", text: $token, secret: true)
                    SettingsDivider()
                    SettingsButton(title: "Connect with the token") { run { await agents.connectOpenClaw(url: url, token: token) } }
                        .disabled(url.isEmpty || token.isEmpty || connecting)
                }
                if !agents.openclaw.url.isEmpty {
                    SettingsDivider()
                    SettingsButton(title: "Disconnect", destructive: true) { agents.disconnectOpenClaw() }
                }
            }
        }
    }

    private func approve(_ title: String, request: String) -> some View {
        let command = "openclaw devices approve \(request)"
        return SettingsSection {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.ui(16)).foregroundStyle(palette.text)
                Text(command).font(.mono(13)).foregroundStyle(palette.muted).textSelection(.enabled)
            }
            .padding(16)
            SettingsDivider()
            SettingsButton(title: "Copy the command") { UIPasteboard.general.string = command }
        }
    }

    // MARK: varys

    @ViewBuilder
    private var varys: some View {
        let paired = !agents.varys.address.isEmpty
        if paired, status == .ready {
            SettingsSection(footer: "This iPhone has access of its own, listed in varys. Disconnecting revokes it there and forgets varys here.") {
                SettingsRow("Address", symbol: "network", value: URL(string: agents.varys.address)?.host() ?? agents.varys.address, chevron: false)
                SettingsDivider()
                SettingsButton(title: "Disconnect", destructive: true) { Task { await agents.disconnectVarys() } }
            }
        } else {
            SettingsSection(footer: "Your varys agent, usually served on your tailnet with Tailscale Serve, so this iPhone needs Tailscale too. In varys, open Settings → Sharing & access → Connect an app. Choose Works as you and the Chat client preset, then paste the pairing link here. It works once.") {
                SettingsField(placeholder: "Pairing link", text: $code, secret: true)
                SettingsDivider()
                SettingsButton(title: connecting ? "Connecting…" : paired ? "Pair again" : "Connect") { run { try await agents.connectVarys(link: code) } }
                    .disabled(code.isEmpty || connecting)
            }
            SettingsSection {
                SettingsButton(title: alternate ? "Use a pairing link" : "Type the address and code instead") { withAnimation { alternate.toggle() } }
                if alternate {
                    SettingsDivider()
                    SettingsField(placeholder: "https://computer.tailnet.ts.net", text: $url, url: true)
                    SettingsDivider()
                    SettingsField(placeholder: "Code", text: $token, secret: true)
                    SettingsDivider()
                    SettingsButton(title: "Connect with the code") { run { try await agents.connectVarys(address: url, code: token) } }
                        .disabled(url.isEmpty || token.isEmpty || connecting)
                }
                if paired {
                    SettingsDivider()
                    SettingsButton(title: "Disconnect", destructive: true) { Task { await agents.disconnectVarys() } }
                }
            }
        }
    }
}
