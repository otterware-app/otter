/** Online meetings on calendar events: whose a join link is, and finding one in an event's text. */

/** The meetings a calendar can add to its events itself. */
export type MeetingService = "googleMeet" | "teams";

export type MeetingProvider = MeetingService | "zoom" | "webex" | "other";

const PROVIDERS: { provider: Exclude<MeetingProvider, "other">; test: RegExp }[] = [
  { provider: "googleMeet", test: /^https:\/\/meet\.google\.com\/[a-z]/i },
  {
    provider: "teams",
    test: /^https:\/\/teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join|meet)\//i,
  },
  { provider: "zoom", test: /^https:\/\/(?:[\w-]+\.)?zoom\.(?:us|com)\/(?:j|my|w)\//i },
  { provider: "webex", test: /^https:\/\/[\w-]+\.webex\.com\/(?:meet|join|[\w-]+\/j\.php)/i },
];

export function meetingProvider(url: string): MeetingProvider {
  return PROVIDERS.find((p) => p.test.test(url))?.provider ?? "other";
}

/**
 * The first join link of a known service in an event's location or description (an invitation
 * from another calendar, a link pasted in), for events whose provider names none itself.
 */
export function findMeetingLink(...texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    // Descriptions may be HTML: links in attributes, & as &amp;.
    for (const [raw] of (text ?? "").matchAll(/https:\/\/[^\s"'<>()]+/g)) {
      const url = raw.replace(/&amp;/g, "&").replace(/[.,;:!?]+$/, "");
      if (meetingProvider(url) !== "other") return url;
    }
  }
  return null;
}
