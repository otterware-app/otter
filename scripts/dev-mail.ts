#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { DemoImapMailbox } from "../packages/contracts/src/demo.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const certDir = NodePath.join(NodeOS.homedir(), ".otter-mail/dev-mail");
const compose = ["compose", "-f", NodePath.join(repoRoot, "scripts/dev-mail/compose.yaml")];
const DOVECOT = "dovecot/dovecot:2.4.5";
const USER = "me@otter.test";

export const devMailCa = NodePath.join(certDir, "ca.pem");

export const devMailbox: DemoImapMailbox = {
  provider: "imap",
  email: USER,
  password: "pass",
  imap: { host: "localhost", port: 31993, security: "tls" },
  smtp: { host: "localhost", port: 31465, security: "tls" },
};

const docker = (args: string[], input?: string) =>
  NodeChildProcess.execFileSync("docker", args, {
    input,
    encoding: "utf8",
    env: { ...process.env, OTTER_MAIL_DEV_MAIL_CERTS: certDir },
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"],
  });

function makeCertificates(): void {
  if (NodeFS.existsSync(NodePath.join(certDir, "tls.crt"))) return;
  NodeFS.mkdirSync(certDir, { recursive: true });
  // As you rather than the image's user (vmail), who can't write here on Linux.
  const user = `${process.getuid!()}:${process.getgid!()}`;
  const openssl = (args: string[]) =>
    docker([
      "run",
      "--rm",
      "--user",
      user,
      "-v",
      `${certDir}:/out`,
      "--entrypoint",
      "openssl",
      DOVECOT,
      ...args,
    ]);
  const key = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "825"];
  openssl([
    "req",
    "-x509",
    ...key,
    "-subj",
    "/CN=Otter Mail dev CA",
    "-addext",
    "basicConstraints=critical,CA:true",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
    "-keyout",
    "/out/ca.key",
    "-out",
    "/out/ca.pem",
  ]);
  openssl([
    "req",
    "-x509",
    ...key,
    "-subj",
    "/CN=localhost",
    "-CA",
    "/out/ca.pem",
    "-CAkey",
    "/out/ca.key",
    "-addext",
    "subjectAltName=DNS:localhost",
    "-addext",
    "extendedKeyUsage=serverAuth",
    "-keyout",
    "/out/tls.key",
    "-out",
    "/out/tls.crt",
  ]);
  for (const file of ["tls.key", "tls.crt"]) NodeFS.chmodSync(NodePath.join(certDir, file), 0o644);
}

async function waitForImap(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const greeted = await new Promise<boolean>((resolve) => {
      const socket = NodeNet.connect(31143, "127.0.0.1");
      socket.once("data", () => resolve(true));
      socket.once("error", () => resolve(false));
      setTimeout(() => resolve(false), 1_000);
    }).catch(() => false);
    if (greeted) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Dovecot didn't start.");
}

let sequence = 0;
function message(opts: {
  from: string;
  to?: string;
  subject: string;
  body: string;
  hoursAgo: number;
  /** The conversation so far, oldest first: the last is the one replied to. */
  replyTo?: string[];
  attachment?: { name: string; text: string };
}): { id: string; raw: string; date: Date } {
  const id = `<seed-${++sequence}@otter.test>`;
  const date = new Date(Date.now() - opts.hoursAgo * 3_600_000);
  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.to ?? `Me <${USER}>`}`,
    `Subject: ${opts.subject}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: ${id}`,
    ...(opts.replyTo
      ? [`In-Reply-To: ${opts.replyTo.at(-1)}`, `References: ${opts.replyTo.join(" ")}`]
      : []),
    "MIME-Version: 1.0",
  ];
  const text = ["Content-Type: text/plain; charset=utf-8", "", opts.body];
  const body = opts.attachment
    ? [
        'Content-Type: multipart/mixed; boundary="part"',
        "",
        "--part",
        ...text,
        "--part",
        `Content-Type: text/plain; name="${opts.attachment.name}"`,
        `Content-Disposition: attachment; filename="${opts.attachment.name}"`,
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(opts.attachment.text).toString("base64"),
        "--part--",
      ]
    : text;
  return { id, raw: [...headers, ...body, ""].join("\r\n"), date };
}

function seed(): void {
  const count = docker([
    ...compose,
    "exec",
    "-T",
    "dovecot",
    "doveadm",
    "-f",
    "flow",
    "mailbox",
    "status",
    "-u",
    USER,
    "messages",
    "INBOX",
  ]);
  if (!/messages=0\b/.test(count)) return;
  const save = (folder: string, { raw, date }: { raw: string; date: Date }) =>
    docker(
      [
        ...compose,
        "exec",
        "-T",
        "dovecot",
        "doveadm",
        "save",
        "-u",
        USER,
        "-m",
        folder,
        "-r",
        String(Math.floor(date.getTime() / 1000)),
      ],
      raw,
    );

  const question = message({
    from: "Ada Lovelace <ada@example.com>",
    subject: "Lunch on Thursday?",
    body: "Are you free for lunch on Thursday? The usual place, around noon.",
    hoursAgo: 30,
  });
  save("INBOX", question);
  const answer = message({
    from: `Me <${USER}>`,
    to: "Ada Lovelace <ada@example.com>",
    subject: "Re: Lunch on Thursday?",
    body: "Thursday works. See you there!",
    hoursAgo: 29,
    replyTo: [question.id],
  });
  save("Sent", answer);
  save(
    "INBOX",
    message({
      from: "Ada Lovelace <ada@example.com>",
      subject: "Re: Lunch on Thursday?",
      body: "Great, I booked a table.",
      hoursAgo: 28,
      replyTo: [question.id, answer.id],
    }),
  );
  save(
    "INBOX",
    message({
      from: "=?UTF-8?Q?Bj=C3=B6rk_Gu=C3=B0mundsd=C3=B3ttir?= <bjork@example.is>",
      subject: "=?UTF-8?Q?Tour_dates_=E2=80=94_d=C3=A9j=C3=A0_vu?=",
      body: "Here are the dates we talked about.",
      hoursAgo: 5,
      attachment: { name: "dates.txt", text: "Reykjavík: 12 Oct\nParis: 19 Oct\n" },
    }),
  );
  save(
    "INBOX",
    message({
      from: "Otter Weekly <news@otter.example>",
      subject: "This week in otters",
      body: "Otters hold hands while they sleep so they don't drift apart.",
      hoursAgo: 1,
    }),
  );
  save(
    "Archive",
    message({
      from: "Grace Hopper <grace@example.com>",
      subject: "Old notes",
      body: "Filed away for later.",
      hoursAgo: 24 * 14,
    }),
  );
}

export async function startDevMail(): Promise<void> {
  makeCertificates();
  docker([...compose, "up", "-d"]);
  await waitForImap();
  seed();
}

if (import.meta.main) {
  if (process.argv[2] === "down") {
    docker([...compose, "down"]);
    process.exit(0);
  }
  await startDevMail();
  console.log(`Dovecot is up, with a seeded mailbox. Add it in the app with:

  Email     ${USER}  (any user @otter.test works; each starts empty but this one)
  Password  pass
  IMAP      localhost, port 31993, TLS    (31143 with STARTTLS)
  SMTP      localhost, port 31465, TLS    (31587 with STARTTLS)

What it sends lands in Mailpit: http://localhost:8025
Its certificate is from ~/.otter-mail/dev-mail/ca.pem, which only the dev runs trust.
Stop it with \`pnpm dev:mail down\`.`);
}
