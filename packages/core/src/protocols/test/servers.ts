/**
 * Tests only: real mail servers in Docker, on ports Docker picks.
 *
 * - GreenMail (IMAP, SMTP): users alice@example.com and bob@example.com,
 *   password "secret"; IMAP 3143/3993, SMTP 3025/3465.
 * - Dovecot 2.4 (IMAP with STARTTLS, CONDSTORE, QRESYNC, UTF8=ACCEPT, …):
 *   any user, password "pass"; IMAP 31143/31993.
 */

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { nodeConnect } from "./node-stream.ts";

const run = promisify(execFile);

export function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export interface Container {
  host: string;
  port(containerPort: number): number;
  stop(): Promise<void>;
}

async function start(
  image: string,
  env: Record<string, string>,
  ports: number[],
  ready: { port: number; tls: boolean }[],
  dockerArgs: string[] = [],
): Promise<Container> {
  const name = `otter-mail-test-${Math.random().toString(36).slice(2, 10)}`;
  const envArgs = Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  const portArgs = ports.flatMap((port) => ["-p", `127.0.0.1::${port}`]);
  await run(
    "docker",
    ["run", "-d", "--rm", "--name", name, ...envArgs, ...portArgs, ...dockerArgs, image],
    {
      timeout: 300_000,
    },
  );
  const mapped = new Map<number, number>();
  for (const port of ports) {
    const { stdout } = await run("docker", ["port", name, String(port)]);
    mapped.set(port, Number(stdout.trim().split("\n")[0]!.split(":").pop()));
  }
  const container: Container = {
    host: "127.0.0.1",
    port: (port) => mapped.get(port)!,
    stop: async () => {
      await run("docker", ["rm", "-f", name]).catch(() => {});
    },
  };
  const greets = async ({ port, tls }: { port: number; tls: boolean }) => {
    const stream = await nodeConnect(container.host, container.port(port), { tls });
    try {
      return Boolean((await stream.read())?.length);
    } finally {
      stream.close();
    }
  };
  for (let attempt = 0; ; attempt++) {
    try {
      let all = true;
      for (const listener of ready) all &&= await greets(listener);
      if (all) return container;
    } catch {
      // Not listening yet.
    }
    if (attempt > 120) {
      await container.stop();
      throw new Error(`${image} didn't start`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export const startGreenMail = () =>
  start(
    "greenmail/standalone:2.1.3",
    {
      GREENMAIL_OPTS: [
        "-Dgreenmail.setup.test.all",
        "-Dgreenmail.hostname=0.0.0.0",
        "-Dgreenmail.users=alice:secret@example.com,bob:secret@example.com",
        "-Dgreenmail.users.login=email",
      ].join(" "),
    },
    [3143, 3993, 3025, 3465],
    [3143, 3993, 3025, 3465].map((port) => ({ port, tls: port === 3993 || port === 3465 })),
  );

export const startDovecot = () =>
  start(
    "dovecot/dovecot:2.4.5",
    { USER_PASSWORD: "pass" },
    [31143, 31993],
    [
      { port: 31143, tls: false },
      { port: 31993, tls: true },
    ],
    ["-v", `${join(import.meta.dirname, "dovecot.conf")}:/etc/dovecot/conf.d/99-test.conf:ro`],
  );
