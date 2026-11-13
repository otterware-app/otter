import SwiftUI

/**
 * One thread as the desktop lists it: the sender's picture (new mail's dot
 * in the gutter before it), then who and when, the subject, and a line of the
 * latest message. Unread is the dot and a brighter, medium-weight name; read
 * mail recedes to grey (message-list.tsx). Its card lives in ThreadListView.
 */
struct ThreadRow: View {
    @Environment(\.palette) private var palette
    let thread: MailThread
    var mark = "star"
    var mine: Set<String> = []
    var preview = true

    var body: some View {
        let unread = thread.unread
        HStack(alignment: .top, spacing: 12) {
            avatar
                .overlay(alignment: .leading) {
                    if unread {
                        Circle().fill(palette.action).frame(width: 6, height: 6).offset(x: -13)
                    }
                }
                .padding(.top, 2)
            lines
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var avatar: some View {
        if let from = thread.messages.last(where: { !$0.draft })?.from {
            SenderAvatar(person: from, size: 36)
        } else {
            Image(systemName: "square.and.pencil")
                .font(.inter(.subheadline))
                .foregroundStyle(palette.muted)
                .frame(width: 36, height: 36)
                .background(palette.text.opacity(0.06), in: .rect(cornerRadius: 8))
        }
    }

    private var lines: some View {
        let latest = thread.latest
        let unread = thread.unread
        return VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(senders)
                    .font(.inter(.subheadline).weight(unread ? .medium : .regular))
                    .foregroundStyle(unread ? palette.text : palette.text.opacity(0.7))
                    .lineLimit(1)
                Spacer(minLength: 8)
                if thread.starred {
                    Image(systemName: "\(mark).fill")
                        .font(.inter(.caption2))
                        .foregroundStyle(palette.text)
                }
                if thread.hasAttachments {
                    Image(systemName: "paperclip")
                        .font(.inter(.caption2))
                        .foregroundStyle(palette.muted)
                }
                let count = thread.distinctMessages().count
                if count > 1 {
                    Text("\(count)")
                        .font(.inter(.footnote))
                        .foregroundStyle(palette.muted)
                        .monospacedDigit()
                }
                Text(RelativeTime.short(latest.date))
                    .font(.inter(.footnote))
                    .foregroundStyle(palette.muted)
                    .monospacedDigit()
            }

            Text(thread.subject)
                .font(.inter(.subheadline))
                .foregroundStyle(unread ? palette.text : palette.text.opacity(0.6))
                .lineLimit(1)

            if preview {
                Text(thread.isDraft ? "Draft · \(latest.snippet)" : latest.snippet)
                    .font(.inter(.subheadline))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
            }
        }
    }

    private var senders: String {
        var names: [String] = []
        for message in thread.messages where !message.draft {
            let name = message.from.isAddress(thread.mailbox) || mine.contains(message.from.email.lowercased())
                ? "me"
                : message.from.label.split(separator: " ").first.map(String.init) ?? message.from.label
            if !names.contains(name) { names.append(name) }
        }
        if names.count == 1, names[0] != "me", let only = thread.messages.first(where: { !$0.draft }) {
            return only.from.label
        }
        return names.isEmpty ? "Draft" : names.joined(separator: ", ")
    }
}

struct MailboxMark: View {
    let mailbox: Mailbox
    var size: CGFloat = 16

    var body: some View {
        if let picture = mailbox.customImage {
            Image(uiImage: picture)
                .resizable().scaledToFill()
                .frame(width: size, height: size)
                .clipShape(.rect(cornerRadius: size * 0.28))
                .accessibilityLabel(mailbox.displayName)
        } else {
            Text(mailbox.displayName.prefix(1).uppercased())
                .font(.inter(size: size * 0.6, weight: .bold))
                .foregroundStyle(Color(hex: mailbox.color).contrastingText)
                .frame(width: size, height: size)
                .background(Color(hex: mailbox.color), in: .rect(cornerRadius: size * 0.28))
                .accessibilityLabel(mailbox.displayName)
        }
    }
}

private let customImages = NSCache<NSString, UIImage>()

extension Mailbox {
    var customImage: UIImage? {
        guard let customPicture else { return nil }
        if let image = customImages.object(forKey: customPicture as NSString) { return image }
        guard let comma = customPicture.firstIndex(of: ","),
              let data = Data(base64Encoded: String(customPicture[customPicture.index(after: comma)...])),
              let image = UIImage(data: data)
        else { return nil }
        customImages.setObject(image, forKey: customPicture as NSString)
        return image
    }
}

struct SenderAvatar: View {
    let person: Person
    var size: CGFloat = 32
    @State private var photo: UIImage?

    var body: some View {
        Group {
            if let photo {
                // Transparent logos need a white backing; inset 1pt so it doesn't fringe the corners.
                Image(uiImage: photo)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .background(.white, in: .rect(cornerRadius: size * 0.22).inset(by: 1))
            } else {
                Text(person.label.prefix(1).uppercased())
                    .font(.inter(size: size * 0.42, weight: .medium))
                    .foregroundStyle(color.contrastingText)
                    .frame(width: size, height: size)
                    .background(color)
            }
        }
        .clipShape(.rect(cornerRadius: size * 0.22))
        .accessibilityHidden(true)
        .task(id: person.email) { photo = await SenderPhotos.shared.photo(for: person.email) }
    }

    private var color: Color {
        var hash: Int32 = 0
        for unit in person.email.trimmingCharacters(in: .whitespaces).lowercased().utf16 {
            hash = hash &* 31 &+ Int32(unit)
        }
        let hue = ((Int(hash) % 360) + 360) % 360
        return Color(hue: Double(hue) / 360, saturation: 0.614, brightness: 0.75)
    }
}

enum RelativeTime {
    static func short(_ date: Date, now: Date = .now) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return date.formatted(date: .omitted, time: .shortened) }
        if let days = calendar.dateComponents([.day], from: date, to: now).day, days < 6 {
            return date.formatted(.dateTime.weekday(.abbreviated))
        }
        if calendar.isDate(date, equalTo: now, toGranularity: .year) {
            return date.formatted(.dateTime.day().month(.abbreviated))
        }
        return date.formatted(date: .numeric, time: .omitted)
    }
}

struct ThreadDay: Identifiable {
    let id: Date
    let threads: [MailThread]
    var unread: Int { threads.filter(\.unread).count }

    var title: String {
        let calendar = Calendar.current
        if calendar.isDateInToday(id) { return "Today" }
        if calendar.isDateInYesterday(id) { return "Yesterday" }
        if calendar.isDate(id, equalTo: .now, toGranularity: .year) {
            return id.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        }
        return id.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().year())
    }

    static func group(_ threads: [MailThread], calendar: Calendar = .current) -> [ThreadDay] {
        Dictionary(grouping: threads) { calendar.startOfDay(for: $0.latest.date) }
            .map { ThreadDay(id: $0.key, threads: $0.value) }
            .sorted { $0.id > $1.id }
    }
}
