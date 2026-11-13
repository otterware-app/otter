import SwiftUI

/** What a chat is and what it touched: its agent, where it ran, what it made and what it read. */
struct ChatDetails: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(ChatStore.self) private var store
    let chat: Chat
    var open: (URL) -> Void
    var openFile: (String) -> Void
    @State private var allOutputs = false
    @State private var allSources = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    HStack(spacing: 12) {
                        AgentAvatar(agent: chat.provider, gatewayAgent: chat.openClawAgent, size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(agentName).font(.ui(18, .semibold)).foregroundStyle(palette.text)
                            if let where_ { Text(where_).font(.ui(14)).foregroundStyle(palette.muted) }
                        }
                    }
                    .padding(.horizontal, 8)
                    if let session = chat.sessionId {
                        Button {
                            UIPasteboard.general.string = session
                            Haptics.done()
                            store.notice = "Session ID copied"
                        } label: {
                            row(symbol: "doc.on.doc", title: "Copy session ID", value: nil, chevron: false)
                        }
                        .buttonStyle(.plain)
                        .background(palette.card, in: .rect(cornerRadius: 20))
                    }
                    section("Outputs", tabs: chat.tabs.filter(\.made), empty: "Nothing made yet", all: $allOutputs)
                    section("Sources", tabs: chat.tabs.filter { !$0.made }, empty: "Nothing read yet", all: $allSources)
                    if chat.tabs.contains(where: { ["thread", "draft"].contains($0.ref.kind) }) {
                        Button {
                            openURL(URL(string: "https://otter.otterware.app/agents/\(chat.id)")!)
                        } label: {
                            row(symbol: "arrow.up.right.square", title: "Open this chat in Otter", value: nil, chevron: false)
                        }
                        .buttonStyle(.plain)
                        .background(palette.card, in: .rect(cornerRadius: 20))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 16)
            }
            .background(palette.canvas)
            .navigationTitle("Chat details")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close", systemImage: "xmark") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var agentName: String { store.agents.name(of: chat) }

    /** Whose agent it is and where it ran, when the name alone doesn't say. */
    private var where_: String? {
        let agent = store.agents.name(of: chat.provider)
        let parts = [agentName == agent ? nil : agent, chat.device?.name].compactMap(\.self)
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    @ViewBuilder
    private func section(_ title: String, tabs: [ChatTab], empty: String, all: Binding<Bool>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.ui(14, .medium)).foregroundStyle(palette.muted).padding(.horizontal, 8)
            VStack(spacing: 0) {
                if tabs.isEmpty {
                    Text(empty).font(.ui(15)).foregroundStyle(palette.muted)
                        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading).padding(.horizontal, 16)
                }
                ForEach(all.wrappedValue ? tabs : Array(tabs.prefix(5))) { tab in
                    Button { tap(tab) } label: {
                        row(symbol: ["thread": "envelope", "draft": "square.and.pencil", "page": "globe", "file": "doc"][tab.ref.kind] ?? "doc",
                            title: tab.title.isEmpty ? tab.ref.kind.capitalized : tab.title, value: nil,
                            chevron: tab.ref.kind == "page", inactive: tab.closedAt != nil)
                    }
                    .buttonStyle(.plain)
                }
                if tabs.count > 5 {
                    Button(all.wrappedValue ? "Show fewer" : "View all \(tabs.count)") { withAnimation { all.wrappedValue.toggle() } }
                        .font(.ui(14, .medium))
                        .foregroundStyle(palette.muted)
                        .frame(maxWidth: .infinity, minHeight: 40)
                }
            }
            .background(palette.card, in: .rect(cornerRadius: 20))
        }
    }

    private func row(symbol: String, title: String, value: String?, chevron: Bool, inactive: Bool = false) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).font(.system(size: 17)).foregroundStyle(palette.muted).frame(width: 22)
            Text(title).font(.ui(16)).foregroundStyle(inactive ? palette.muted : palette.text).lineLimit(1)
            Spacer(minLength: 8)
            if let value { Text(value).font(.ui(14)).foregroundStyle(palette.muted) }
            if chevron { Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(palette.tertiary) }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 48)
        .contentShape(.rect)
    }

    private func tap(_ tab: ChatTab) {
        switch tab.ref {
        case .page(let url):
            guard let url = URL(string: url) else { return }
            dismiss()
            open(url)
        case .file(let href):
            if store.readsFiles(chat) {
                dismiss()
                return openFile(href)
            }
            UIPasteboard.general.string = href
            store.notice = "This file is where \(store.agents.name(of: chat.provider)) runs\(chat.device.map { ", on \($0.name)" } ?? ""). Its path is copied."
        case .thread, .draft:
            openURL(URL(string: "https://otter.otterware.app/agents/\(chat.id)")!)
        }
    }
}
