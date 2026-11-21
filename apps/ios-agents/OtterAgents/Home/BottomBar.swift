import SwiftUI
import UIKit

/** A row in a tab's recents: a chat, a task or an agent. */
struct RecentItem: Identifiable {
    enum Status { case none, working, unread, failed, chosen }

    var id: String
    var title: String
    var symbol: String?
    var agent: String?
    var status = Status.none
}

/**
 * Claude's tabs: touch and hold one for what was in it lately, and a new one of it at the bottom.
 * A card over the tab bar, under the tab held.
 */
struct TabRecentsCard: View {
    @Environment(\.palette) private var palette
    let items: [RecentItem]
    let new: String?
    var newSymbol = "plus.circle.fill"
    let pick: (String?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(items) { item in
                row(item.title, status: item.status) {
                    if let agent = item.agent {
                        AgentAvatar(agent: agent, size: 16)
                    } else {
                        Image(systemName: item.symbol ?? "bubble.left").font(.system(size: 13))
                    }
                } action: { pick(item.id) }
            }
            if let new {
                row(new) {
                    Image(systemName: newSymbol).font(.system(size: 15))
                } action: { pick(nil) }
            }
        }
        .padding(5)
        .frame(width: 236)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
    }

    private func row(_ title: String, status: RecentItem.Status = .none, @ViewBuilder icon: () -> some View, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                icon().foregroundStyle(palette.text).frame(width: 18)
                Text(title).font(.ui(14)).foregroundStyle(palette.text).lineLimit(1)
                Spacer(minLength: 6)
                switch status {
                case .working: ProgressView().controlSize(.mini)
                case .unread: Circle().fill(palette.focus).frame(width: 7, height: 7)
                case .failed: Image(systemName: "exclamationmark.circle.fill").font(.system(size: 12)).foregroundStyle(palette.error)
                case .chosen: Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(palette.action)
                case .none: EmptyView()
                }
            }
            .padding(.horizontal, 10)
            .frame(height: 36)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

/**
 * Claude's bottom: the bar to ask an agent, and under it the tabs, a slim row of icons on the
 * canvas with a soft pill behind the one you're on. Slide across them to switch; touch and hold
 * one for what was in it lately.
 */
struct BottomBar: View {
    @Environment(\.palette) private var palette
    @Binding var place: RootView.Place
    let badges: [RootView.Place: String]
    let ask: () -> Void
    let card: (RootView.Card) -> Void

    static let tabsHeight: CGFloat = 44

    @Namespace private var pill
    /** The tab under a finger sliding across the row. */
    @State private var hovered: RootView.Place?
    @State private var held = false
    @State private var press: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 6) {
            AskBar(ask: ask, card: card).padding(.horizontal, 16).zIndex(1)
            tabs
            .background { BarBacking(edge: .bottom).padding(.top, -34) }
        }
        .padding(.top, 8)
    }

    private var tabs: some View {
        GeometryReader { proxy in
            HStack(spacing: 0) {
                ForEach(RootView.Place.allCases, id: \.self) { tab($0) }
            }
            .contentShape(.rect)
            .gesture(DragGesture(minimumDistance: 0).onChanged { drag in
                let over = Self.tab(at: drag.location.x, width: proxy.size.width)
                if press == nil {
                    press = Task {
                        try? await Task.sleep(for: .seconds(0.4))
                        guard !Task.isCancelled else { return }
                        held = true
                        hovered = nil
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        card(.recents(over))
                    }
                }
                if abs(drag.translation.width) > 10 { press?.cancel() }
                if !held, hovered != over {
                    if hovered != nil { Haptics.tap() }
                    hovered = over
                }
            }.onEnded { drag in
                press?.cancel()
                press = nil
                if !held { place = Self.tab(at: drag.location.x, width: proxy.size.width) }
                held = false
                hovered = nil
            })
        }
        .frame(height: Self.tabsHeight)
        .padding(.horizontal, 48)
        .animation(.spring(duration: 0.28, bounce: 0.2), value: hovered ?? place)
    }

    private static func tab(at x: CGFloat, width: CGFloat) -> RootView.Place {
        let all = RootView.Place.allCases
        return all[max(0, min(all.count - 1, Int(x / (width / CGFloat(all.count)))))]
    }

    private func tab(_ tab: RootView.Place) -> some View {
        let lit = (hovered ?? place) == tab
        return Image(systemName: tab.symbol)
            .font(.system(size: 18, weight: .medium))
            .foregroundStyle(lit ? palette.text : palette.muted)
            .frame(width: 58, height: 36)
            .background {
                if lit { Capsule().fill(palette.text.opacity(0.07)).matchedGeometryEffect(id: "pill", in: pill) }
            }
            .overlay(alignment: .topTrailing) {
                if let badge = badges[tab] {
                    Text(badge)
                        .font(.ui(11, .semibold))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .frame(minWidth: 16, minHeight: 16)
                        .background(tab == .scheduled ? palette.error : palette.focus, in: .capsule)
                        .offset(x: -6, y: -2)
                }
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(tab.name)
            .accessibilityValue(badges[tab] ?? "")
            .accessibilityAddTraits(place == tab ? [.isButton, .isSelected] : .isButton)
            .accessibilityAction { place = tab }
            .accessibilityAction(named: "Recent") { card(.recents(tab)) }
    }
}

/**
 * Claude's composer over the tabs, as Otter Mail's search pill: the agent a new chat goes to (tap
 * to choose another), the words to ask it, and New chat (hold it for chats you started writing).
 */
struct AskBar: View {
    @Environment(\.palette) private var palette
    @Environment(ChatStore.self) private var store
    let ask: () -> Void
    let card: (RootView.Card) -> Void

    var body: some View {
        let agent = store.agents.starting
        HStack(spacing: 4) {
            Button { card(.agents) } label: {
                Group {
                    if let agent {
                        AgentAvatar(agent: agent.id, size: 28)
                    } else {
                        Image(systemName: "person.crop.circle").font(.system(size: 22)).foregroundStyle(palette.muted)
                    }
                }
                .frame(width: 38, height: 38)
                .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Agent, \(agent?.name ?? "none")")
            .accessibilityHint("Chooses the agent new chats go to")
            Button(action: ask) {
                Text(agent.map { "Ask \($0.name)" } ?? "New chat")
                    .font(.ui(16))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
                    .padding(.leading, 6)
                    .frame(maxWidth: .infinity, minHeight: 38, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("New chat")
            .accessibilityLabel(agent.map { "Ask \($0.name)" } ?? "New chat")
            Image(systemName: "square.and.pencil")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(palette.canvas)
                .frame(width: 38, height: 38)
                .background(palette.text, in: .circle)
                .contentShape(.circle)
                .onTapGesture(perform: ask)
                .onLongPressGesture(minimumDuration: 0.4) {
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    card(.drafts)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Write a new chat")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { ask() }
                .accessibilityAction(named: "Drafts") { card(.drafts) }
        }
        .padding(5)
        .glassEffect(.regular.interactive(), in: .capsule)
    }
}
