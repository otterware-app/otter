import SwiftUI

/** Otter Code's settings look: titled groups on soft cards, rows of a symbol, a name and a value. */
struct SettingsPage<Content: View>: View {
    @Environment(\.palette) private var palette
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) { content }
                .padding(.horizontal, 18)
                .padding(.top, 12)
        }
        .contentMargins(.bottom, 96, for: .scrollContent)
        .scrollDismissesKeyboard(.interactively)
        .background(palette.canvas)
        .toolbarTitleDisplayMode(.inline)
    }
}

struct SettingsSection<Content: View>: View {
    @Environment(\.palette) private var palette
    var title: String?
    var footer: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let title { Text(title).font(.ui(14, .medium)).foregroundStyle(palette.muted).padding(.horizontal, 8) }
            VStack(alignment: .leading, spacing: 0) { content }
                .background(palette.card, in: .rect(cornerRadius: 24))
            if let footer { Text(footer).font(.ui(13)).foregroundStyle(palette.muted).padding(.horizontal, 8).padding(.top, 1) }
        }
    }
}

/** A row's frame: what goes in it is the caller's (a field, a switch, a picker). */
struct SettingsCell<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        HStack(spacing: 11) { content }
            .padding(.horizontal, 16)
            .frame(minHeight: 50)
            .contentShape(.rect)
    }
}

struct SettingsRow<Icon: View>: View {
    @Environment(\.palette) private var palette
    let title: String
    var value: String?
    var chevron = true
    var tone: Color?
    @ViewBuilder var icon: Icon

    var body: some View {
        SettingsCell {
            icon.frame(width: 24)
            Text(title).font(.ui(16)).foregroundStyle(tone ?? palette.text).lineLimit(1)
            Spacer(minLength: 8)
            if let value { Text(value).font(.ui(14)).foregroundStyle(palette.muted).lineLimit(1) }
            if chevron { Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(palette.muted.opacity(0.45)) }
        }
    }
}

extension SettingsRow where Icon == SettingsSymbol {
    init(_ title: String, symbol: String, value: String? = nil, chevron: Bool = true, tone: Color? = nil) {
        self.init(title: title, value: value, chevron: chevron, tone: tone) { SettingsSymbol(name: symbol, tone: tone) }
    }
}

struct SettingsSymbol: View {
    @Environment(\.palette) private var palette
    let name: String
    var tone: Color?

    var body: some View {
        Image(systemName: name).font(.system(size: 19)).foregroundStyle(tone ?? palette.text)
    }
}

struct SettingsDivider: View {
    @Environment(\.palette) private var palette
    var body: some View { Rectangle().fill(palette.hairline).frame(height: 1).padding(.leading, 16) }
}

struct SettingsField: View {
    @Environment(\.palette) private var palette
    let placeholder: String
    @Binding var text: String
    var secret = false
    var url = false

    var body: some View {
        SettingsCell {
            Group {
                if secret { SecureField(placeholder, text: $text) } else { TextField(placeholder, text: $text) }
            }
            .font(.ui(16))
            .foregroundStyle(palette.text)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(url ? .URL : .default)
        }
    }
}

struct SettingsButton: View {
    @Environment(\.palette) private var palette
    @Environment(\.isEnabled) private var enabled
    let title: String
    var destructive = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            SettingsCell {
                Text(title).font(.ui(16, .medium)).foregroundStyle(destructive ? palette.error : palette.text).opacity(enabled ? 1 : 0.4)
                Spacer()
            }
        }
        .buttonStyle(.plain)
    }
}
