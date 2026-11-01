import SwiftUI

/**
 * Themes, as in the desktop's Settings › Appearance: tap a theme to wear it
 * in light and dark, or one of its orbs for that appearance only. Your own
 * themes (made on the Mac or the web) follow the stock ones; one with a single
 * palette is worn for that appearance only.
 */
struct ThemeSettings: View {
    @Environment(Preferences.self) private var preferences
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach(preferences.themes) { theme in
                    ThemeCard(
                        theme: theme,
                        light: preferences.lightTheme == theme.id,
                        dark: preferences.darkTheme == theme.id,
                        onPick: { modes in
                            withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) {
                                if modes.contains(.light) { preferences.lightTheme = theme.id }
                                if modes.contains(.dark) { preferences.darkTheme = theme.id }
                            }
                        }
                    )
                }
            }
            .padding(20)
        }
        .background(palette.canvas)
        .navigationTitle("Theme")
        .toolbarTitleDisplayMode(.inline)
    }
}

private struct ThemeCard: View {
    @Environment(\.palette) private var palette
    let theme: Theme
    let light: Bool
    let dark: Bool
    let onPick: (Set<ColorScheme>) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 0) {
                ForEach(theme.modes, id: \.self) { preview(theme.palette($0)) }
            }
            .frame(height: 76)
            .clipShape(.rect(cornerRadius: 12))

            HStack {
                Text(theme.label)
                    .font(.inter(.subheadline).weight(.medium))
                    .foregroundStyle(palette.text)
                    .lineLimit(1)
                Spacer()
                if theme.modes.contains(.light) { orb(.light, picked: light) }
                if theme.modes.contains(.dark) { orb(.dark, picked: dark) }
            }
        }
        .padding(10)
        .background(palette.surface, in: .rect(cornerRadius: 18))
        .overlay {
            RoundedRectangle(cornerRadius: 18)
                .strokeBorder(light || dark ? palette.focus : palette.border, lineWidth: light && dark ? 2 : 1)
        }
        .contentShape(.rect(cornerRadius: 18))
        .onTapGesture { onPick(Set(theme.modes)) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(light && dark ? .isSelected : [])
    }

    /** A little window in the theme: sidebar, canvas, a line of text and its action color. */
    private func preview(_ p: Palette) -> some View {
        HStack(spacing: 0) {
            p.sidebar.frame(width: 18)
            VStack(alignment: .leading, spacing: 5) {
                Capsule().fill(p.text).frame(width: 34, height: 4)
                Capsule().fill(p.muted).frame(width: 24, height: 4)
                Spacer()
                Capsule().fill(p.action).frame(width: 20, height: 8)
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(p.canvas)
        }
    }

    private func orb(_ scheme: ColorScheme, picked: Bool) -> some View {
        Button {
            onPick([scheme])
        } label: {
            Image(systemName: scheme == .light ? "sun.max.fill" : "moon.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(picked ? palette.actionText : palette.muted)
                .frame(width: 24, height: 24)
                .background(picked ? palette.action : palette.input, in: .circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(scheme == .light ? "Use in light mode" : "Use in dark mode")
    }
}
