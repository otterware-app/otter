// Checks the deployed relay end to end with real Google tokens and a real
// Pub/Sub push: signs in as the relay-smoke service account (gcloud mints its
// ID token for the desktop app's client), links its address, opens the event
// stream, publishes a Gmail-shaped notification to the topic, and waits for it
// to come back over the socket. Then deletes the account.
//
//   pnpm smoke                       against https://relay.mail.otterware.app
//   RELAY_URL=http://… pnpm smoke    against another deployment
//
// Needs gcloud credentials with Token Creator on relay-smoke and Pub/Sub
// Publisher on the topic: yours, or CI's (Workload Identity Federation).

import { execFileSync } from "node:child_process";
import * as NodeFS from "node:fs";

import type { RelayEvent } from "@otter-mail/contracts/relay";

const RELAY_URL = process.env.RELAY_URL ?? "https://relay.mail.otterware.app";
const config = NodeFS.readFileSync(`${import.meta.dirname}/../wrangler.jsonc`, "utf8");
const setting = (name: string) => new RegExp(`"${name}": "([^"]+)"`).exec(config)![1]!;
const CLIENT_ID = setting("GOOGLE_CLIENT_ID");
const [, PROJECT, , TOPIC] = setting("PUSH_TOPIC").split("/");
const SERVICE_ACCOUNT = `relay-smoke@${PROJECT}.iam.gserviceaccount.com`;

const gcloud = (...args: string[]) =>
  execFileSync("gcloud", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function step(message: string) {
  console.log(`• ${message}`);
}

async function call(method: string, route: string, token?: string, body?: unknown) {
  const response = await fetch(`${RELAY_URL}${route}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok)
    throw new Error(`${method} ${route}: ${response.status} ${await response.text()}`);
  return response;
}

step(`minting an ID token for ${SERVICE_ACCOUNT}`);
const idToken = gcloud(
  "auth",
  "print-identity-token",
  `--impersonate-service-account=${SERVICE_ACCOUNT}`,
  `--audiences=${CLIENT_ID}`,
  "--include-email",
);

step("signing in");
const signedIn = await call("POST", "/v1/auth/sign-in/social", undefined, {
  provider: "google",
  idToken: { token: idToken },
});
const session = { token: signedIn.headers.get("set-auth-token")! };

try {
  step(`linking ${SERVICE_ACCOUNT}`);
  await call("PUT", `/v1/accounts/${encodeURIComponent(SERVICE_ACCOUNT)}`, session.token, {
    idToken,
    name: "Smoke test",
  });

  step("opening the event stream");
  const socket = new WebSocket(`${RELAY_URL.replace(/^http/, "ws")}/v1/events`, {
    headers: { authorization: `Bearer ${session.token}` },
  } as unknown as string[]);
  const events: RelayEvent[] = [];
  socket.addEventListener("message", (e) => {
    if (e.data !== "pong") events.push(JSON.parse(String(e.data)) as RelayEvent);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", () => reject(new Error("WebSocket failed to open")));
  });

  const historyId = String(Date.now());
  step(`publishing a notification to ${TOPIC}`);
  gcloud(
    "pubsub",
    "topics",
    "publish",
    TOPIC!,
    `--project=${PROJECT}`,
    `--message=${JSON.stringify({ emailAddress: SERVICE_ACCOUNT, historyId })}`,
  );

  const started = Date.now();
  while (!events.some((e) => e.type === "mail" && e.historyId === historyId)) {
    if (Date.now() - started > 30_000) throw new Error("No mail event within 30s");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  step(`push delivered over the socket in ${Date.now() - started}ms`);

  const closed = new Promise<number>((resolve) =>
    socket.addEventListener("close", (e) => resolve(e.code)),
  );
  step("unlinking and deleting the smoke-test account");
  await call("DELETE", `/v1/accounts/${encodeURIComponent(SERVICE_ACCOUNT)}`, session.token);
  await call("POST", "/v1/auth/delete-user", session.token, {});
  const code = await Promise.race([
    closed,
    new Promise<string>((resolve) => setTimeout(() => resolve("still open"), 20_000)),
  ]);
  if (code !== 4001)
    throw new Error(`Expected deletion to close the socket with 4001, got ${code}`);
  step("deleting the smoke-test account closed the socket");
  console.log("Relay smoke test passed.");
} catch (err) {
  await fetch(`${RELAY_URL}/v1/auth/delete-user`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.token}`, "content-type": "application/json" },
    body: "{}",
  });
  throw err;
}
