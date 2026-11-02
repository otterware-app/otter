import { describe, expect, it } from "vite-plus/test";
import { utf8Decode, utf8Encode } from "../../bytes.ts";
import { MAX_LINE, ResponseReader, parseResponse, tokenText, type ImapResponse } from "./parser.ts";
import {
  formatInternalDate,
  parseFetch,
  inUidRanges,
  parseInternalDate,
  parseUidRanges,
  parseUidSet,
  uidSet,
} from "./structures.ts";
import { decodeMailboxName, encodeMailboxName } from "./utf7.ts";

const parse = (line: string) => parseResponse(utf8Encode(`${line}\r\n`));

function readAll(text: string | Uint8Array, size: number): ImapResponse[] {
  const bytes = typeof text === "string" ? utf8Encode(text) : text;
  const reader = new ResponseReader();
  const responses: ImapResponse[] = [];
  for (let i = 0; i < bytes.length; i += size) {
    reader.push(bytes.subarray(i, i + size));
    for (let r = reader.next(); r; r = reader.next()) responses.push(r);
  }
  return responses;
}

describe("parseResponse", () => {
  it("reads status responses with codes", () => {
    expect(parse("* OK [UIDVALIDITY 3857529045] UIDs valid")).toEqual({
      tag: "*",
      type: "OK",
      number: undefined,
      code: { name: "UIDVALIDITY", args: [{ type: "atom", value: "3857529045" }] },
      text: "UIDs valid",
      args: [],
    });
    const flags = parse("* OK [PERMANENTFLAGS (\\Deleted \\Seen \\*)] Limited");
    expect(flags.code?.name).toBe("PERMANENTFLAGS");
    expect(flags.code?.args).toEqual([
      {
        type: "list",
        items: [
          { type: "atom", value: "\\Deleted" },
          { type: "atom", value: "\\Seen" },
          { type: "atom", value: "\\*" },
        ],
      },
    ]);
    const copy = parse("A3 OK [COPYUID 38505 304,319:320 3956:3958] Done");
    expect(copy.tag).toBe("A3");
    expect(copy.code?.args.map(tokenText)).toEqual(["38505", "304,319:320", "3956:3958"]);
    expect(parse("A1 NO [AUTHENTICATIONFAILED] Invalid credentials").code?.name).toBe(
      "AUTHENTICATIONFAILED",
    );
    expect(parse("* OK [ALERT] Mailbox almost full").text).toBe("Mailbox almost full");
    expect(parse("A2 OK").text).toBe("");
  });

  it("keeps an unparseable code as text", () => {
    const response = parse('* OK [WEIRD "unclosed] still fine');
    expect(response.code?.name).toBe("WEIRD");
    expect(response.text).toBe("still fine");
  });

  it("reads continuations", () => {
    expect(parse("+ idling")).toMatchObject({ tag: "+", text: "idling" });
    expect(parse("+")).toMatchObject({ tag: "+", text: "" });
  });

  it("reads numbered untagged responses", () => {
    expect(parse("* 23 EXISTS")).toMatchObject({ tag: "*", type: "EXISTS", number: 23 });
    expect(parse("* 5 expunge")).toMatchObject({ type: "EXPUNGE", number: 5 });
  });

  it("reads nested lists, quoted strings and NIL", () => {
    const response = parse('* LIST (\\HasNoChildren \\Sent) "/" "Sent \\"Items\\""');
    expect(response.type).toBe("LIST");
    expect(response.args).toEqual([
      {
        type: "list",
        items: [
          { type: "atom", value: "\\HasNoChildren" },
          { type: "atom", value: "\\Sent" },
        ],
      },
      { type: "string", value: "/" },
      { type: "string", value: 'Sent "Items"' },
    ]);
    const nested = parse('* NAMESPACE (("" "/")) NIL (("#shared/" "/"))');
    expect(nested.args[0]).toEqual({
      type: "list",
      items: [
        {
          type: "list",
          items: [
            { type: "string", value: "" },
            { type: "string", value: "/" },
          ],
        },
      ],
    });
    expect(nested.args[1]).toEqual({ type: "nil" });
  });

  it("keeps fetch sections whole", () => {
    const response = parse(
      '* 1 FETCH (UID 7 BODY[HEADER.FIELDS (SUBJECT FROM)] "x" BODY[TEXT]<0> "y")',
    );
    const items = response.args[0]!.type === "list" ? response.args[0]!.items : [];
    expect(items.map((item) => tokenText(item))).toEqual([
      "UID",
      "7",
      "BODY[HEADER.FIELDS (SUBJECT FROM)]",
      "x",
      "BODY[TEXT]<0>",
      "y",
    ]);
  });
});

describe("ResponseReader", () => {
  const stream =
    "* 12 EXISTS\r\n" +
    "* 1 FETCH (UID 5 BODY[] {18}\r\nSubject: a\r\n\r\nhi\r\n FLAGS (\\Seen))\r\n" +
    "* 2 FETCH (UID 6 BINARY[] ~{3}\r\n\0\r\n)\r\n" +
    '* LIST () "/" {4}\r\na{1}\r\n' +
    "A1 OK done\r\n";

  it("gives the same responses whatever the chunk size", () => {
    const whole = readAll(stream, stream.length);
    expect(whole.map((r) => r.type)).toEqual(["EXISTS", "FETCH", "FETCH", "LIST", "OK"]);
    for (const size of [1, 2, 3, 7, 16]) expect(readAll(stream, size)).toEqual(whole);
  });

  it("reads literals, even ones that look like the end of a line", () => {
    const [, first, second, list] = readAll(stream, 5);
    const message = parseFetch(first!);
    expect(message.uid).toBe(5);
    expect(utf8Decode(message.source!)).toBe("Subject: a\r\n\r\nhi\r\n");
    expect(message.flags).toEqual(["\\Seen"]);
    expect([...parseFetch(second!).source!]).toEqual([0, 13, 10]);
    expect(tokenText(list!.args[2])).toBe("a{1}");
  });

  it("holds a large literal until it's all in", () => {
    const body = "x".repeat(300_000);
    const text = `* 1 FETCH (UID 1 BODY[] {${body.length}}\r\n${body})\r\nA1 OK\r\n`;
    const responses = readAll(text, 16_384);
    expect(responses).toHaveLength(2);
    expect(parseFetch(responses[0]!).source!.length).toBe(body.length);
  });

  it("reads bytes that aren't UTF-8 in a literal as they are", () => {
    const head = utf8Encode("* 1 FETCH (UID 1 BODY[] {3}\r\n");
    const tail = utf8Encode(")\r\n");
    const bytes = new Uint8Array([...head, 0xff, 0x00, 0x80, ...tail]);
    const [response] = readAll(bytes, 4);
    expect([...parseFetch(response!).source!]).toEqual([0xff, 0x00, 0x80]);
  });

  it("refuses a line that never ends, and an absurd literal", () => {
    const long = new ResponseReader();
    expect(() => {
      for (let sent = 0; sent <= MAX_LINE; sent += 65_536) {
        long.push(utf8Encode("x".repeat(65_536)));
        long.next();
      }
    }).toThrow(/too long/);
    const huge = new ResponseReader();
    huge.push(utf8Encode("* 1 FETCH (UID 1 BODY[] {99999999999}\r\n"));
    expect(() => huge.next()).toThrow(/too large/);
  });
});

describe("parseFetch", () => {
  it("decodes an envelope, with encoded words and groups", () => {
    const [response] = readAll(
      "* 3 FETCH (UID 42 FLAGS (\\Seen $Forwarded) MODSEQ (18446744073709551600) " +
        'INTERNALDATE "17-Jul-1996 02:44:25 -0700" RFC822.SIZE 4286 ' +
        'ENVELOPE ("Wed, 17 Jul 1996 02:23:25 -0700 (PDT)" "=?UTF-8?Q?Caf=C3=A9_=E2=98=95?=" ' +
        '(("=?ISO-8859-1?Q?Andr=E9?= Pirard" NIL "andre" "example.org")) NIL NIL ' +
        '((NIL NIL "team" NIL)("Ann" NIL "ann" "example.com")(NIL NIL NIL NIL)) ' +
        'NIL NIL "<parent@x>" {12}\r\n<id@example>))\r\n',
      9,
    );
    const message = parseFetch(response!);
    expect(message.seq).toBe(3);
    expect(message.uid).toBe(42);
    expect(message.flags).toEqual(["\\Seen", "$Forwarded"]);
    expect(message.modseq).toBe(18446744073709551600n);
    expect(message.size).toBe(4286);
    expect(message.internalDate?.toISOString()).toBe("1996-07-17T09:44:25.000Z");
    expect(message.envelope).toEqual({
      date: new Date("1996-07-17T09:23:25.000Z"),
      subject: "Café ☕",
      from: [{ name: "André Pirard", address: "andre@example.org" }],
      sender: [],
      replyTo: [],
      to: [{ name: "Ann", address: "ann@example.com" }],
      cc: [],
      bcc: [],
      inReplyTo: "<parent@x>",
      messageId: "<id@example>",
    });
  });

  it("reads header fields and the start of the text", () => {
    const headers = "In-Reply-To: <a@x>\r\nReferences: <r@x>\r\n <a@x>\r\n\r\n";
    const [response] = readAll(
      `* 1 FETCH (UID 2 BODY[HEADER.FIELDS (IN-REPLY-TO REFERENCES)] {${headers.length}}\r\n${headers} BODY[TEXT]<0> "Hello")\r\n`,
      64,
    );
    const message = parseFetch(response!);
    expect(message.headers).toEqual({ "in-reply-to": "<a@x>", references: "<r@x> <a@x>" });
    expect(utf8Decode(message.textStart!)).toBe("Hello");
  });

  it("numbers the parts of a body structure", () => {
    const [response] = readAll(
      "* 1 FETCH (UID 1 BODYSTRUCTURE (" +
        '(("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" 12 1 NIL NIL NIL NIL)' +
        '("TEXT" "HTML" ("CHARSET" "utf-8") NIL NIL "QUOTED-PRINTABLE" 40 2 NIL NIL NIL NIL) "ALTERNATIVE" ("BOUNDARY" "b2") NIL NIL NIL)' +
        '("APPLICATION" "PDF" ("NAME" "=?UTF-8?B?UsOpc3Vtw6k=?=.pdf") "<cid1>" NIL "BASE64" 5000 NIL ("ATTACHMENT" ("FILENAME*" "utf-8\'\'R%C3%A9sum%C3%A9.pdf")) NIL NIL)' +
        '("MESSAGE" "RFC822" NIL NIL NIL "7BIT" 300 (NIL "Inner" NIL NIL NIL NIL NIL NIL NIL NIL) ("TEXT" "PLAIN" NIL NIL NIL "7BIT" 10 1 NIL NIL NIL NIL) 8 NIL NIL NIL NIL)' +
        ' "MIXED" ("BOUNDARY" "b1") NIL NIL NIL))\r\n',
      50,
    );
    const root = parseFetch(response!).bodyStructure!;
    expect(root.type).toBe("multipart/mixed");
    expect(root.part).toBe("");
    const [alternative, pdf, forwarded] = root.childNodes;
    expect(alternative!.part).toBe("1");
    expect(alternative!.childNodes.map((node) => [node.part, node.type])).toEqual([
      ["1.1", "text/plain"],
      ["1.2", "text/html"],
    ]);
    expect(alternative!.childNodes[1]!.encoding).toBe("quoted-printable");
    expect(pdf).toMatchObject({
      part: "2",
      type: "application/pdf",
      id: "<cid1>",
      size: 5000,
      disposition: "attachment",
      filename: "Résumé.pdf",
      parameters: { name: "Résumé.pdf" },
    });
    expect(forwarded!.part).toBe("3");
    expect(forwarded!.envelope?.subject).toBe("Inner");
    expect(forwarded!.childNodes[0]).toMatchObject({ part: "3.1", type: "text/plain" });
  });

  it("gives a single-part message part 1", () => {
    const [response] = readAll(
      '* 1 FETCH (UID 1 BODYSTRUCTURE ("TEXT" "PLAIN" NIL NIL NIL "7BIT" 3 1 NIL NIL NIL NIL))\r\n',
      100,
    );
    expect(parseFetch(response!).bodyStructure).toMatchObject({ part: "1", type: "text/plain" });
  });
});

describe("modified UTF-7", () => {
  const cases: [string, string][] = [
    ["INBOX", "INBOX"],
    ["Brouillons & Envoyés", "Brouillons &- Envoy&AOk-s"],
    ["~peter/mail/台北/日本語", "~peter/mail/&U,BTFw-/&ZeVnLIqe-"],
    ["Entwürfe", "Entw&APw-rfe"],
    ["😀 Fun", "&2D3eAA- Fun"],
  ];

  it.each(cases)("encodes and decodes %s", (name, encoded) => {
    expect(encodeMailboxName(name)).toBe(encoded);
    expect(decodeMailboxName(encoded)).toBe(name);
  });
});

describe("uid sets and dates", () => {
  it("compresses and expands", () => {
    expect(uidSet([9, 1, 2, 3, 5, 3])).toBe("1:3,5,9");
    expect(uidSet([])).toBe("");
    expect(uidSet("1:*")).toBe("1:*");
    expect(parseUidSet("1:3,5,9:8")).toEqual([1, 2, 3, 5, 9, 8]);
  });

  it("never expands a huge range", () => {
    expect(parseUidSet("1:4294967295")).toBeNull();
    expect(parseUidSet("1:3,7", 3)).toBeNull();
    expect(parseUidSet("0,x,5")).toEqual([5]);
    const ranges = parseUidRanges("1:4294967295,9:8,x");
    expect(ranges).toEqual([
      [1, 4294967295],
      [8, 9],
    ]);
    expect(inUidRanges(ranges)(123_456_789)).toBe(true);
    const some = inUidRanges(parseUidRanges("4,2:3,1:10,20:30"));
    expect([6, 11, 25, 31].map(some)).toEqual([true, false, true, false]);
  });

  it("round-trips INTERNALDATE", () => {
    const date = new Date("2026-02-03T04:05:06Z");
    expect(formatInternalDate(date)).toBe("03-Feb-2026 04:05:06 +0000");
    expect(parseInternalDate(formatInternalDate(date))).toEqual(date);
    expect(parseInternalDate(" 3-Feb-2026 05:05:06 +0100")).toEqual(date);
  });
});
