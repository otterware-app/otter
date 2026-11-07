#!/usr/bin/env node
// A pretend OpenRouter agent server (core's OpenRouterAgentServer protocol)
// for checking the phone's agent without a model: each turn asks the phone's
// core to run a real mail tool (list_accounts), then answers from its output,
// streamed as the real one streams. On localhost:8791.
//
//   node apps/mobile/scripts/fake-agent-server.mts
//   OTTER_MAIL_AGENT_SERVER_URL=http://localhost:8791/api/agent (the build)

import * as NodeHttp from "node:http";

const PORT = 8791;
const results = new Map<string, (output: { text: string }) => void>();

const json = (res: NodeHttp.ServerResponse, body: unknown, status = 200) =>
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));

const read = (req: NodeHttp.IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {}));
  });

const connection = {
  connected: true,
  models: [{ slug: "fake/otter", name: "Fake Otter", isDefault: true, inputModalities: ["text"] }],
};

const server = NodeHttp.createServer(async (req, res) => {
  const path = (req.url ?? "/").replace(/^\/api\/agent/, "");
  if (path === "/connection") return json(res, connection);
  if (path === "/sessions") return json(res, []);
  if (path === "/cancel") return json(res, {});
  if (path === "/tool-result" && req.method === "POST") {
    const body = await read(req);
    results.get(`${body.requestId}:${body.id}`)?.(body.output as { text: string });
    return json(res, {});
  }
  if (path === "/turn" && req.method === "POST") {
    const turn = await read(req);
    const requestId = String(turn.requestId);
    console.log(`turn ${requestId}: ${String(turn.input).slice(0, 80)}`);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const send = (event: Record<string, unknown>) =>
      res.write(`data: ${JSON.stringify({ requestId, ...event })}\n\n`);
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    send({ type: "session", sessionId: `fake-${requestId}` });
    const step = {
      kind: "tool",
      title: "Listing your mailboxes",
      source: "Otter Mail",
      detail: "list_accounts",
    };
    send({ type: "tool", id: "t1", step });
    const output = await new Promise<{ text: string }>((resolve) => {
      results.set(`${requestId}:t1`, resolve);
      send({ type: "toolRequest", id: "t1", name: "list_accounts", input: {} });
    });
    send({ type: "toolResult", id: "t1", output: output.text.slice(0, 200) });
    const emails = [...new Set([...output.text.matchAll(/[\w.+-]+@[\w.-]+/g)].map((m) => m[0]))];
    const answer = `You asked: **${String(turn.input).trim()}**\n\nThis iPhone has ${emails.length || "no"} mailbox${emails.length === 1 ? "" : "es"}${emails.length ? `: ${[...new Set(emails)].join(", ")}` : ""}.\n\n- The tool ran in core, on the phone's worker runtime.\n- This answer streamed in word by word.`;
    for (const word of answer.split(/(?<= )/)) {
      send({ type: "delta", text: word });
      await pause(40);
    }
    send({ type: "done", responseId: null });
    return res.end();
  }
  json(res, { error: "Not found." }, 404);
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(`fake agent server on http://localhost:${PORT}/api/agent`),
);
