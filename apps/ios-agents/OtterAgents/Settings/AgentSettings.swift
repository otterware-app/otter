import PhotosUI
import SwiftUI

/** One agent: its name and picture, whether it's on, how this iPhone reaches it, and what it runs chats with. */
struct AgentSettings: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(Account.self) private var account
    let id: String

    @State private var name = ""
    @State private var url = ""
    @State private var key = ""
    @State private var code = ""
    @State private var token = ""
    @State private var alternate = false
    @State private var connecting = false
    @State private var error: String?
    @State private var choosingPicture = false
    @State private var picture: PhotosPickerItem?
    @State private var removing = false

    private var agents: Agents { account.agents }

    var body: some View {
        if let agent = agents.agent(id) {
            page(agent)
        }
    }

    private func page(_ agent: Agent) -> some View {
        let status = agent.status
        return SettingsPage {
            SettingsSection {
                SettingsCell {
                    Menu {
                        Button("Choose a picture", systemImage: "photo") { choosingPicture = true }
                        if agent.avatar != nil {
                            Button("Remove picture", systemImage: "trash", role: .destructive) { agents.setAvatar(agent, nil) }
                        }
                    } label: {
                        AgentAvatar(agent: agent.id, size: 44)
                            .overlay(alignment: .bottomTrailing) {
                                Image(systemName: "pencil.circle.fill").font(.system(size: 16)).foregroundStyle(palette.text, palette.card).offset(x: 4, y: 4)
                            }
                    }
                    .accessibilityLabel("Picture")
                    VStack(alignment: .leading, spacing: 1) {
                        TextField(agent.kind?.name ?? "Name", text: $name)
                            .font(.ui(16, .medium)).foregroundStyle(palette.text)
                            .submitLabel(.done)
                            .onSubmit { agents.rename(agent, to: name) }
                            .accessibilityLabel("Name")
                        Text(agent.statusText).font(.ui(14))
                            .foregroundStyle(status == .ready && agent.enabled ? Status.done : { if case .failed = status { palette.error } else { palette.muted } }())
                    }
                    Spacer()
                    Toggle(agent.name, isOn: Binding(get: { agent.enabled }, set: { agents.setEnabled(agent, $0) })).labelsHidden()
                }
                .padding(.vertical, 8)
            }
            if agent.enabled {
                switch agent.kind {
                case .hermes: hermes(agent)
                case .openclaw: openClaw(agent)
                case .varys: varys(agent)
                case nil: EmptyView()
                }
                if let problem = problem(agent) {
                    Text(problem).font(.ui(14)).foregroundStyle(palette.error).padding(.horizontal, 8)
                }
            }
            SettingsSection(footer: "\(agent.name) goes from your agents on every device\(agent.kind == .varys ? ", and this iPhone's access to it ends" : ""). Its chats stay.") {
                SettingsButton(title: "Remove agent", destructive: true) { removing = true }
            }
        }
        .navigationTitle(agent.name)
        .onAppear {
            name = agent.name
            url = agent.kind == .hermes ? agent.string("baseUrl") : ""
        }
        .onDisappear { agents.rename(agent, to: name) }
        .task(id: agent.enabled) { await agents.check(agent) }
        .photosPicker(isPresented: $choosingPicture, selection: $picture, matching: .images)
        .onChange(of: picture) { _, item in
            guard let item else { return }
            picture = nil
            Task {
                do {
                    guard let data = try await item.loadTransferable(type: Data.self) else { throw AgentPicture.Failure(message: "Couldn't read that image. Choose a PNG, JPEG or WebP.") }
                    agents.setAvatar(agent, try AgentPicture.make(from: data))
                } catch {
                    self.error = error.localizedDescription
                }
            }
        }
        .confirmationDialog("Remove \(agent.name)?", isPresented: $removing, titleVisibility: .visible) {
            Button("Remove agent", role: .destructive) {
                agents.remove(agent)
                dismiss()
            }
        } message: {
            Text("It goes from every device, with its connection on this iPhone. Its chats stay.")
        }
    }

    private func problem(_ agent: Agent) -> String? {
        if let error { return error }
        if case .failed(let message) = agent.status { return message }
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
    private func modelPicker(_ agent: Agent, _ title: String, default label: String, labelled: @escaping (Hermes.Model) -> String = { $0.name }) -> some View {
        let models = agent.models.filter { !$0.slug.isEmpty }
        if !models.isEmpty {
            SettingsCell {
                Text(title).font(.ui(16)).foregroundStyle(palette.text)
                Spacer()
                Picker(title, selection: Binding(get: { agent.string("model") }, set: { agents.set(agent, "model", .string($0)) })) {
                    Text(label).tag("")
                    ForEach(models) { Text(labelled($0)).tag($0.slug) }
                }
                .labelsHidden()
                .tint(palette.muted)
            }
        }
    }

    // MARK: Hermes

    private func setting(_ agent: Agent, _ key: String) -> Binding<String> {
        Binding(get: { agent.string(key) }, set: { agents.set(agent, key, .string($0)) })
    }

    @ViewBuilder
    private func hermes(_ agent: Agent) -> some View {
        let footer = "\(agent.name)'s server, reached from every device. Chats live on it, so they're the same here, on the Mac and on the web. The key follows your Otter account, sealed."
        let address = agent.string("baseUrl")
        if agents.demo || agent.secret("key") != nil, !address.isEmpty {
            SettingsSection(footer: footer) {
                SettingsRow("Server", symbol: "server.rack", value: URL(string: address)?.host() ?? address, chevron: false)
                modelPicker(agent, "Model", default: "Default") { model in model.subProvider.map { "\(model.name) · \($0)" } ?? model.name }
                if let model = agent.model, model.reasoning {
                    SettingsCell {
                        Text("Reasoning").font(.ui(16)).foregroundStyle(palette.text)
                        Spacer()
                        Picker("Reasoning", selection: setting(agent, "reasoningEffort")) {
                            ForEach(Agents.efforts(model), id: \.id) { Text($0.label).tag($0.id) }
                        }
                        .labelsHidden()
                        .tint(palette.muted)
                    }
                }
                if let model = agent.model, model.fast {
                    SettingsCell {
                        Toggle("Fast", isOn: Binding(get: { agent.string("serviceTier") == "priority" }, set: { agents.set(agent, "serviceTier", .string($0 ? "priority" : "default")) }))
                            .font(.ui(16)).foregroundStyle(palette.text)
                    }
                }
                SettingsDivider()
                SettingsButton(title: "Disconnect", destructive: true) { agents.disconnectHermes(agent) }
            }
        } else {
            SettingsSection(footer: footer) {
                SettingsField(placeholder: "https://hermes.example:8642", text: $url, url: true)
                SettingsDivider()
                SettingsField(placeholder: "API key", text: $key, secret: true)
                SettingsDivider()
                SettingsButton(title: connecting ? "Connecting…" : "Connect") { run { await agents.connectHermes(agent, url: url, key: key) } }
                    .disabled(url.isEmpty || key.isEmpty || connecting)
            }
        }
    }

    // MARK: OpenClaw

    @ViewBuilder
    private func openClaw(_ agent: Agent) -> some View {
        let footer = "\(agent.name)'s gateway, usually over Tailscale. Make a setup code on it with openclaw qr --setup-code-only and paste it here, then approve this iPhone there. Chats live on the gateway, so they're the same everywhere; this iPhone's key and tokens stay on it."
        let address = agent.string("url")
        if agent.status == .ready {
            SettingsSection(footer: footer) {
                SettingsRow("Gateway", symbol: "network", value: URL(string: address)?.host() ?? address, chevron: false)
                modelPicker(agent, "Agent", default: "The gateway's default")
                SettingsDivider()
                SettingsButton(title: "Disconnect", destructive: true) { agents.disconnectOpenClaw(agent) }
            }
            if agent.fullAccess == false {
                if let request = agent.fullAccessRequest {
                    approve("Approve full access on the gateway:", request: request)
                } else {
                    SettingsSection(footer: "This iPhone was paired with less than OpenClaw's own apps have, so \(agent.name) won't use your devices for what you ask here, and its questions may not reach you.") {
                        SettingsButton(title: "Allow full access") { Task { await agents.allowFullAccess(agent) } }
                    }
                }
            }
        } else if let request = agent.pairing {
            approve("Approve this iPhone on the gateway:", request: request)
            SettingsSection {
                SettingsButton(title: "Check again") { Task { await agents.check(agent) } }
                SettingsDivider()
                SettingsButton(title: "Disconnect", destructive: true) { agents.disconnectOpenClaw(agent) }
            }
        } else {
            SettingsSection(footer: footer) {
                SettingsField(placeholder: "Setup code", text: $code, secret: true)
                SettingsDivider()
                SettingsButton(title: connecting ? "Connecting…" : "Connect") { run { try await agents.connectOpenClaw(agent, code: code) } }
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
                    SettingsButton(title: "Connect with the token") { run { await agents.connectOpenClaw(agent, url: url, token: token) } }
                        .disabled(url.isEmpty || token.isEmpty || connecting)
                }
                if !address.isEmpty {
                    SettingsDivider()
                    SettingsButton(title: "Disconnect", destructive: true) { agents.disconnectOpenClaw(agent) }
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
    private func varys(_ agent: Agent) -> some View {
        let address = agent.string("address")
        let paired = !address.isEmpty
        if paired, agent.status == .ready {
            SettingsSection(footer: "This iPhone has access of its own, listed in \(agent.name). Disconnecting revokes it there and forgets it here.") {
                SettingsRow("Address", symbol: "network", value: URL(string: address)?.host() ?? address, chevron: false)
                SettingsDivider()
                SettingsButton(title: "Disconnect", destructive: true) { Task { await agents.disconnectVarys(agent) } }
            }
        } else {
            SettingsSection(footer: "Your varys agent, usually served on your tailnet with Tailscale Serve, so this iPhone needs Tailscale too. In varys, open Settings → Sharing & access → Connect an app. Choose Works as you and the Chat client preset, then paste the pairing link here. It works once.") {
                SettingsField(placeholder: "Pairing link", text: $code, secret: true)
                SettingsDivider()
                SettingsButton(title: connecting ? "Connecting…" : paired ? "Pair again" : "Connect") { run { try await agents.connectVarys(agent, link: code) } }
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
                    SettingsButton(title: "Connect with the code") { run { try await agents.connectVarys(agent, address: url, code: token) } }
                        .disabled(url.isEmpty || token.isEmpty || connecting)
                }
                if paired {
                    SettingsDivider()
                    SettingsButton(title: "Disconnect", destructive: true) { Task { await agents.disconnectVarys(agent) } }
                }
            }
        }
    }
}
