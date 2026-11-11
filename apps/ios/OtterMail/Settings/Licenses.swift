import SwiftUI

/** What the app is built on, with its licenses: Resources/Licenses.json, written by `pnpm ios:resources`. */
struct License: Identifiable, Decodable {
    let name: String
    let license: String
    let noticeText: String
    let sourceUrl: URL?

    var id: String { name }

    static let all: [License] = {
        guard
            let url = Bundle.main.url(forResource: "Licenses", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let licenses = try? JSONDecoder().decode([License].self, from: data)
        else { return [] }
        return licenses
    }()
}

struct LicensesView: View {
    @Environment(\.palette) private var palette

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                ForEach(License.all) { license in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(license.name).font(.inter(.headline))
                            Spacer()
                            Text(license.license).font(.inter(.footnote)).foregroundStyle(palette.muted)
                        }
                        if let url = license.sourceUrl {
                            Link(url.absoluteString.replacingOccurrences(of: "https://", with: ""), destination: url)
                                .font(.inter(.footnote))
                        }
                        Text(license.noticeText)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(palette.text.opacity(0.8))
                            .textSelection(.enabled)
                    }
                }
            }
            .padding(20)
        }
        .foregroundStyle(palette.text)
        .background(palette.canvas)
        .navigationTitle("Open-source licenses")
        .toolbarTitleDisplayMode(.inline)
    }
}
