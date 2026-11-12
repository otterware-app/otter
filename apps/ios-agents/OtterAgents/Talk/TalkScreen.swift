import SwiftUI

/**
 * A call with the chat's agent, the whole screen as ChatGPT's voice is: an orb that breathes with
 * whoever is speaking, the last thing said under it, and mute and hang up at the bottom. What's
 * said goes into the chat.
 */
struct TalkScreen: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(ChatStore.self) private var store
    let chatId: String

    @State private var call: TalkCall?

    var body: some View {
        VStack(spacing: 0) {
            header
            Spacer()
            if let call { TalkOrb(call: call) }
            caption
            Spacer()
            controls
        }
        .padding(.horizontal, 20)
        .background(palette.canvas.ignoresSafeArea())
        .task {
            let call = TalkCall(chatId: chatId, store: store)
            self.call = call
            await call.start()
        }
        .onDisappear { call?.end() }
        .onChange(of: call?.phase) { _, phase in
            if phase == .ended(nil) { dismiss() }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: call?.liveAt)
    }

    private var title: String {
        guard let chat = store.chat(chatId) else { return "" }
        return chat.isBlank || chat.turns.isEmpty ? store.agents.name(of: chat.provider, agent: store.agents.agent(of: chat)) : chat.title
    }

    private var header: some View {
        VStack(spacing: 4) {
            Text(title).font(.ui(17, .semibold)).foregroundStyle(palette.text).lineLimit(1)
            if let call, let liveAt = call.liveAt, call.phase == .live {
                Text(liveAt, style: .timer).font(.ui(13)).monospacedDigit().foregroundStyle(palette.muted)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 14)
    }

    @ViewBuilder
    private var caption: some View {
        Group {
            if case .ended(let error?) = call?.phase {
                Text(error).foregroundStyle(palette.error)
            } else if let caption = call?.caption {
                Text(caption.text.trimmingCharacters(in: .whitespaces))
                    .foregroundStyle(caption.user ? palette.muted : palette.text)
            } else {
                Text(call?.phase == .live ? "Listening" : "Connecting…").foregroundStyle(palette.muted)
            }
        }
        .font(.ui(17))
        .multilineTextAlignment(.center)
        .lineLimit(4)
        .frame(maxWidth: .infinity, minHeight: 96, alignment: .top)
        .padding(.top, 36)
        .animation(.easeOut(duration: 0.2), value: call?.caption?.text)
    }

    private var controls: some View {
        HStack(spacing: 12) {
            status
            Spacer(minLength: 0)
            if let call, call.phase == .live || call.phase == .connecting {
                Button {
                    Haptics.tap()
                    call.mute(!call.muted)
                } label: {
                    Image(systemName: call.muted ? "mic.slash.fill" : "mic.fill")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(call.muted ? palette.error : palette.text)
                        .contentTransition(.symbolEffect(.replace))
                        .frame(width: 58, height: 58)
                        .contentShape(.circle)
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel(call.muted ? "Unmute" : "Mute")
            }
            Button {
                Haptics.tap()
                call?.end()
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(palette.canvas)
                    .frame(width: 58, height: 58)
                    .background(palette.text, in: .circle)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("End call")
        }
        .padding(.bottom, 8)
    }

    private var statusText: String {
        switch call?.phase {
        case .live?: call?.speaking == true ? "Speaking" : call?.muted == true ? "Muted" : "Listening"
        case .ended?: "Ended"
        default: "Connecting…"
        }
    }

    /** Where ChatGPT has its field: what the call is doing. */
    private var status: some View {
        HStack(spacing: 8) {
            Image(systemName: "waveform").font(.system(size: 15, weight: .semibold)).foregroundStyle(palette.action)
            TimelineView(.periodic(from: .now, by: 0.25)) { _ in
                Text(statusText).font(.ui(16)).foregroundStyle(palette.text)
            }
        }
        .padding(.horizontal, 18)
        .frame(height: 58)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .capsule)
    }
}

/** The call's orb: clouds of the theme's accent that drift, and swell with the voice. */
private struct TalkOrb: View {
    @Environment(\.palette) private var palette
    let call: TalkCall

    var body: some View {
        TimelineView(.animation) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            let (level, speaking) = call.level
            let live = call.phase == .live
            let drift = { (phase: Double, speed: Double) -> Float in Float(sin(t * speed + phase) * 0.12) }
            MeshGradient(width: 3, height: 3, points: [
                [0, 0], [0.5 + drift(0, 0.7), 0], [1, 0],
                [0, 0.5 + drift(1, 0.9)], [0.5 + drift(2, 1.1), 0.5 + drift(3, 0.8)], [1, 0.5 + drift(4, 1.0)],
                [0, 1], [0.5 + drift(5, 0.6), 1], [1, 1],
            ], colors: colors(speaking: speaking, live: live))
            .clipShape(.circle)
            .overlay(Circle().strokeBorder(palette.text.opacity(0.08), lineWidth: 1))
            .shadow(color: palette.action.opacity(speaking ? 0.35 : 0.15), radius: 30)
            .scaleEffect(live ? 1 + CGFloat(level) * 0.18 + 0.015 * sin(t * 1.7) : 0.92 + 0.03 * sin(t * 2.4))
            .saturation(call.muted ? 0 : 1)
        }
        .frame(width: 236, height: 236)
        .animation(.easeOut(duration: 0.3), value: call.phase)
        .accessibilityHidden(true)
    }

    private func colors(speaking: Bool, live: Bool) -> [Color] {
        let accent = palette.action
        let light = accent.mix(with: .white, by: speaking ? 0.35 : 0.65)
        let deep = accent.mix(with: .black, by: speaking ? 0.15 : 0.4)
        let soft = accent.mix(with: palette.canvas, by: live ? 0.45 : 0.75)
        return [soft, light, soft,
                deep, speaking ? accent : light, light,
                light, deep, soft]
    }
}
