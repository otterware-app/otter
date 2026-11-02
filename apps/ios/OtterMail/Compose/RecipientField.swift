import SwiftUI

struct RecipientField: View {
    @Environment(MailStore.self) private var store
    @Environment(\.palette) private var palette
    @Binding var value: String
    let title: String
    let from: String
    let excluded: Set<String>
    @State private var chips: [String]
    @State private var entry = ""
    @FocusState private var focused: Bool

    init(_ title: String, value: Binding<String>, from: String, excluded: Set<String>) {
        self.title = title
        _value = value
        self.from = from
        self.excluded = excluded
        _chips = State(initialValue: Draft.tokens(value.wrappedValue))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Text(title).foregroundStyle(palette.muted).frame(width: 44, alignment: .leading).padding(.top, 10)
                VStack(alignment: .leading, spacing: 6) {
                    if !chips.isEmpty {
                        RecipientFlow(spacing: 6) {
                            ForEach(Array(chips.enumerated()), id: \.offset) { index, token in
                                HStack(spacing: 6) {
                                    Text(Draft.people(token).first?.label ?? token).lineLimit(1)
                                    Button {
                                        chips.remove(at: index)
                                        publish()
                                    } label: { Image(systemName: "xmark").font(.inter(.caption2).weight(.bold)) }
                                    .accessibilityLabel("Remove \(token)")
                                }
                                .font(.inter(.subheadline))
                                .foregroundStyle(Draft.validRecipient(token) ? palette.text : palette.error)
                                .padding(.horizontal, 10).padding(.vertical, 7)
                                .background(palette.surface, in: .capsule)
                                .overlay(Capsule().strokeBorder(palette.border))
                                .accessibilityElement(children: .contain)
                            }
                        }
                    }
                    TextField("Add recipient", text: $entry)
                        .accessibilityLabel(title)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focused)
                        .submitLabel(.done)
                        .frame(minHeight: 40)
                        .onSubmit { commit() }
                        .onAppear { if title == "To" && value.isEmpty { focused = true } }
                        .onChange(of: entry) { _, text in
                            if (text.hasSuffix(",") || text.hasSuffix(";") || text.contains("\n")) && text.filter({ $0 == "\"" }).count.isMultiple(of: 2) { commit() }
                            else { publish() }
                        }
                        .onChange(of: focused) { _, active in if !active { commit() } }
                }
            }
            if focused && !entry.isEmpty {
                ForEach(store.contacts(matching: entry, from: from, excluding: excluded), id: \.email) { person in
                    Button {
                        entry = Draft.format(person)
                        commit()
                    } label: {
                        HStack(spacing: 10) {
                            SenderAvatar(person: person, size: 30)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(person.label).foregroundStyle(palette.text)
                                if !person.name.isEmpty { Text(person.email).font(.inter(.caption)).foregroundStyle(palette.muted) }
                            }
                            Spacer()
                            Image(systemName: "plus").foregroundStyle(palette.muted)
                        }
                        .padding(.vertical, 6)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
            Divider().overlay(palette.border)
        }
    }

    private func publish() { value = (chips + (entry.isEmpty ? [] : [entry])).joined(separator: ", ") }
    private func commit() {
        let existing = Set(chips.flatMap(Draft.people).map { $0.email.lowercased() })
        chips += Draft.tokens(entry).filter { token in
            guard let email = Draft.people(token).first?.email else { return true }
            return !existing.contains(email.lowercased())
        }
        entry = ""
        publish()
    }
}

private struct RecipientFlow: Layout {
    let spacing: CGFloat
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(subviews, width: proposal.width ?? 300).size
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let layout = arrange(subviews, width: bounds.width)
        for (view, point) in zip(subviews, layout.points) {
            view.place(at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y), proposal: ProposedViewSize(width: bounds.width, height: nil))
        }
    }
    private func arrange(_ views: Subviews, width: CGFloat) -> (size: CGSize, points: [CGPoint]) {
        var x: CGFloat = 0, y: CGFloat = 0, height: CGFloat = 0
        var points: [CGPoint] = []
        for view in views {
            let size = view.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if x > 0 && x + size.width > width { x = 0; y += height + spacing; height = 0 }
            points.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            height = max(height, size.height)
        }
        return (CGSize(width: width, height: y + height), points)
    }
}
