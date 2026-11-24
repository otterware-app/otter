import { describe, expect, it } from "vite-plus/test";
import { isICloud, mailServerName } from "./capabilities.ts";
import type { MailAccount } from "./types.ts";

const imap = (host: string): MailAccount => ({
  id: "robin@cloud.example",
  email: "robin@cloud.example",
  name: "Robin",
  provider: "imap",
  imap: {
    username: "robin@cloud.example",
    imap: { host, port: 993, security: "tls" },
    smtp: { host: "smtp.cloud.example", port: 587, security: "starttls" },
  },
});

describe("isICloud", () => {
  it("is an IMAP mailbox on Apple's mail server", () => {
    expect(isICloud(imap("imap.mail.me.com"))).toBe(true);
    expect(isICloud(imap("IMAP.mail.me.com"))).toBe(true);
    expect(isICloud(imap("imap.cloud.example"))).toBe(false);
    expect(isICloud({ ...imap("imap.mail.me.com"), imap: undefined })).toBe(false);
  });

  it("names its server iCloud, others by host", () => {
    expect(mailServerName(imap("imap.mail.me.com"))).toBe("iCloud");
    expect(mailServerName(imap("imap.cloud.example"))).toBe("imap.cloud.example");
  });
});
