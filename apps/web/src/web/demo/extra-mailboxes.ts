import type { SeedAccount, SeedThread } from "@otter-mail/shared/demo-mailboxes";

const person = (name: string, email: string) => ({ name, email });

function mailbox(
  email: string,
  name: string,
  displayName: string,
  color: string,
  threads: { subject: string; from: string; text: string; hoursAgo: number; unread?: boolean }[],
): SeedAccount {
  return {
    email,
    name,
    displayName,
    color,
    signature: "",
    labels: [],
    threads: (): SeedThread[] =>
      threads.map((t) => ({
        subject: t.subject,
        labels: ["INBOX"],
        messages: [
          {
            from: person(t.from, `${t.from.split(" ")[0].toLowerCase()}@mail.example`),
            hoursAgo: t.hoursAgo,
            text: t.text,
            unread: t.unread,
          },
        ],
      })),
  };
}

export const EXTRA_DEMO_ACCOUNTS: SeedAccount[] = [
  mailbox("robin.side@otter.example", "Robin Otter", "Side project", "#8e63ce", [
    {
      subject: "Domain renewal",
      from: "Registrar Bot",
      text: "Your domain renews in 14 days.",
      hoursAgo: 5,
      unread: true,
    },
    {
      subject: "First beta signups",
      from: "Ana Ruiz",
      text: "Twelve people signed up overnight!",
      hoursAgo: 30,
    },
  ]),
  mailbox(
    "treasurer@riverside-rowing.example",
    "Robin Otter",
    "Riverside Rowing Club — Treasurer",
    "#0b8043",
    [
      {
        subject: "Membership dues for spring",
        from: "Tom Becker",
        text: "Can you send the reminder this week?",
        hoursAgo: 2,
        unread: true,
      },
      {
        subject: "Boathouse insurance",
        from: "Lena Ford",
        text: "The quote came in a bit higher.",
        hoursAgo: 50,
      },
    ],
  ),
  mailbox("robin@family.example", "Robin Otter", "Family", "#e67c73", [
    {
      subject: "Sunday lunch?",
      from: "Mum Otter",
      text: "Shall we do 1pm?",
      hoursAgo: 8,
      unread: true,
    },
  ]),
  mailbox("r.otter@university.example", "Robin Otter", "University", "#f6bf26", [
    {
      subject: "Thesis draft feedback",
      from: "Prof Ida Holm",
      text: "Chapter 3 is much stronger now.",
      hoursAgo: 20,
    },
    {
      subject: "Library loan overdue",
      from: "Library Desk",
      text: "Please return 'Rivers of Europe'.",
      hoursAgo: 70,
      unread: true,
    },
  ]),
  mailbox("hello@ottercraft.example", "Robin Otter", "OtterCraft shop", "#039be5", [
    {
      subject: "New order #1042",
      from: "Shop Notify",
      text: "Two wooden otters, shipping to Ghent.",
      hoursAgo: 1,
      unread: true,
    },
    {
      subject: "Question about sizes",
      from: "Kai Jensen",
      text: "Is the large one 30cm tall?",
      hoursAgo: 26,
      unread: true,
    },
  ]),
  mailbox("robin.otter.newsletters@otter.example", "Robin Otter", "Newsletters", "#616161", [
    {
      subject: "This week in rivers",
      from: "River Weekly",
      text: "Five stories about water.",
      hoursAgo: 12,
    },
  ]),
];
