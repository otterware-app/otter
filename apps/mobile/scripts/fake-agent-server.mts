#!/usr/bin/env node
// A pretend OpenRouter agent server (core's OpenRouterAgentServer protocol)
// for checking the phone's agent without a model: each turn asks the phone's
// core to run a real mail tool (list_accounts), then answers from its output,
// streamed as the real one streams. On localhost:8791. A message with
// "markdown" in it answers with every block the chat draws; "label" asks to
// create one (an approval, in Supervised); "ask" puts a question to you.
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
  models: [
    {
      slug: "fake/otter",
      name: "Fake Otter",
      isDefault: true,
      inputModalities: ["text"],
      options: [
        {
          id: "reasoningEffort",
          label: "Reasoning",
          choices: [
            { id: "", label: "Default", isDefault: true },
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
          ],
        },
        {
          id: "serviceTier",
          label: "Service Tier",
          choices: [
            { id: "default", label: "Standard", isDefault: true },
            { id: "priority", label: "Fast" },
          ],
        },
      ],
    },
    { slug: "fake/swift", name: "Fake: Swift Otter", inputModalities: ["text"] },
  ],
};

const MARKDOWN = `## What's in the inbox

Three things need you, **two today**:

1. Reply to *Dana* about the offsite
   - she asked for dates
   - and a budget
2. Sign the lease ([DocuSign](https://otterware.app))

> Quoted from the thread: "Can we do Friday?"

| Who | Due | Status |
|:--|:--:|--:|
| Dana | Today | **Waiting** |
| Landlord | Fri | ~~Late~~ Sent |

\`\`\`ts
const due = threads.filter((t) => t.due < tomorrow);
\`\`\`

---

That's \`3\` items.`;

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
    const input = String(turn.input).toLowerCase();
    let extra = "";
    if (input.includes("label")) {
      send({
        type: "tool",
        id: "t2",
        step: { kind: "tool", title: "Creating a label", source: "Otter Mail" },
      });
      const made = await new Promise<{ text: string }>((resolve) => {
        results.set(`${requestId}:t2`, resolve);
        send({
          type: "toolRequest",
          id: "t2",
          name: "create_label",
          input: { account: emails[0], name: "Otter test" },
        });
      });
      send({ type: "toolResult", id: "t2", output: made.text.slice(0, 200) });
      extra = `\n\nThe label: ${made.text.slice(0, 120)}`;
    }
    if (input.includes("ask")) {
      send({
        type: "question",
        question: {
          id: `q-${requestId}`,
          expiresAt: Date.now() + 10 * 60_000,
          questions: [
            {
              id: "when",
              header: "When",
              question: "When should I schedule the offsite?",
              options: [
                { label: "Friday", description: "Dana's first choice" },
                { label: "Next Monday" },
              ],
              multiSelect: false,
              secret: false,
            },
            {
              id: "who",
              header: "Who",
              question: "Who should come?",
              options: [{ label: "Dana" }, { label: "Sam" }, { label: "The whole team" }],
              multiSelect: true,
              secret: false,
            },
          ],
        },
      });
      await pause(20_000);
      send({ type: "questionResolved", questionId: `q-${requestId}` });
    }
    const answer = input.includes("markdown")
      ? MARKDOWN
      : `You asked: **${String(turn.input).trim()}**\n\nThis iPhone has ${emails.length || "no"} mailbox${emails.length === 1 ? "" : "es"}${emails.length ? `: ${[...new Set(emails)].join(", ")}` : ""}.\n\n- The tool ran in core, on the phone's worker runtime.\n- This answer streamed in word by word.${extra}`;
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
