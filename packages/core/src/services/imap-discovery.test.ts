import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { setPlatform, type Platform } from "../platform.ts";
import { discoverImap, parseAutoconfig } from "./imap-discovery.ts";

const GMX = `<clientConfig version="1.1">
  <emailProvider id="gmx.net">
    <domain>gmx.net</domain>
    <domain>gmx.de</domain>
    <domain>gmx.at</domain>
    <domain>gmx.ch</domain>
    <domain>gmx.eu</domain>
    <domain>gmx.biz</domain>
    <domain>gmx.org</domain>
    <domain>gmx.info</domain>
    <domain>mein.gmx</domain>
    <domain>mail.gmx</domain>
    <domain>email.gmx</domain>
    <!-- see also other domains below -->
    <!-- gmx.com is same company, but different access servers -->
    <displayName>GMX Freemail</displayName>
    <displayShortName>GMX</displayShortName>
    <!-- imap officially costs money, but actually works with freemail accounts, too -->
    <incomingServer type="imap">
      <hostname>imap.gmx.net</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <!-- Kundennummer (customer no) and email address should both work -->
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </incomingServer>
    <incomingServer type="imap">
      <hostname>imap.gmx.net</hostname>
      <port>143</port>
      <socketType>STARTTLS</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </incomingServer>
    <incomingServer type="pop3">
      <hostname>pop.gmx.net</hostname>
      <port>995</port>
      <socketType>SSL</socketType>
      <!-- see above -->
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </incomingServer>
    <incomingServer type="pop3">
      <hostname>pop.gmx.net</hostname>
      <port>110</port>
      <socketType>STARTTLS</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>mail.gmx.net</hostname>
      <port>465</port>
      <socketType>SSL</socketType>
      <!-- see above -->
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </outgoingServer>
    <outgoingServer type="smtp">
      <hostname>mail.gmx.net</hostname>
      <port>587</port>
      <socketType>STARTTLS</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </outgoingServer>
    <documentation url="https://hilfe.gmx.net/pop-imap/imap/imap-serverdaten.html"/>
    <enable visiturl="https://hilfe.gmx.net/pop-imap/einschalten.html">
      <instruction>You must allow access via POP3 &amp; IMAP once in the e-mail settings of your account!</instruction>
      <instruction lang="de">Sie müssen einmalig den Zugriff über POP3 &amp; IMAP in den E-Mail-Einstellungen Ihres Kontos erlauben!</instruction>
    </enable>
  </emailProvider>
</clientConfig>`;

const setKind = (kind: Platform["kind"]) => setPlatform({ kind } as Platform);

function stubFetch(routes: Record<string, string>): string[] {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(url);
    const body = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1];
    return new Response(body ?? "", { status: body === undefined ? 404 : 200 });
  });
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseAutoconfig", () => {
  it("reads the ISPDB's file, implicit TLS first", () => {
    expect(parseAutoconfig(GMX, "Jane.Doe@gmx.net")).toEqual({
      username: "Jane.Doe@gmx.net",
      imap: { host: "imap.gmx.net", port: 993, security: "tls" },
      smtp: { host: "mail.gmx.net", port: 465, security: "tls" },
    });
  });

  it("prefers implicit TLS listed after STARTTLS, skips OAuth-only and plain servers", () => {
    const xml = `<clientConfig version="1.1"><emailProvider id="example.org">
      <incomingServer type="imap">
        <hostname>plain.example.org</hostname><port>143</port><socketType>plain</socketType>
        <username>%EMAILADDRESS%</username><authentication>password-cleartext</authentication>
      </incomingServer>
      <incomingServer type="imap">
        <hostname>oauth.example.org</hostname><port>993</port><socketType>SSL</socketType>
        <username>%EMAILADDRESS%</username><authentication>OAuth2</authentication>
      </incomingServer>
      <incomingServer type="imap">
        <hostname>imap.example.org</hostname><port>143</port><socketType>STARTTLS</socketType>
        <username>%EMAILLOCALPART%</username><authentication>password-cleartext</authentication>
      </incomingServer>
      <incomingServer type="imap">
        <hostname>imap.example.org</hostname><port>993</port><socketType>SSL</socketType>
        <username>%EMAILLOCALPART%</username><authentication>password-cleartext</authentication>
      </incomingServer>
      <outgoingServer type="smtp">
        <hostname>smtp.example.org</hostname><port>587</port><socketType>STARTTLS</socketType>
        <username>%EMAILLOCALPART%</username><authentication>password-encrypted</authentication>
      </outgoingServer>
    </emailProvider></clientConfig>`;
    expect(parseAutoconfig(xml, "jane@example.org")).toEqual({
      username: "jane",
      imap: { host: "imap.example.org", port: 993, security: "tls" },
      smtp: { host: "smtp.example.org", port: 587, security: "starttls" },
    });
  });

  it("is null without both an IMAP and an SMTP server", () => {
    expect(parseAutoconfig("<clientConfig/>", "a@b.c")).toBeNull();
    expect(parseAutoconfig("not xml at all", "a@b.c")).toBeNull();
  });
});

describe("discoverImap", () => {
  it("knows common providers without asking anyone", async () => {
    const asked = stubFetch({});
    setKind("web");
    expect(await discoverImap("me@icloud.com")).toEqual({
      username: "me@icloud.com",
      imap: { host: "imap.mail.me.com", port: 993, security: "tls" },
      smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" },
    });
    expect((await discoverImap("jane@web.de"))?.username).toBe("jane");
    expect(asked).toEqual([]);
  });

  it("leaves Gmail and Outlook to their own sign-in", async () => {
    stubFetch({});
    setKind("desktop");
    expect(await discoverImap("a@gmail.com")).toBeNull();
    expect(await discoverImap("a@hotmail.com")).toBeNull();
  });

  it("asks the ISPDB", async () => {
    const asked = stubFetch({ "https://autoconfig.thunderbird.net/v1.1/gmx.info": GMX });
    setKind("web");
    expect((await discoverImap("jane@gmx.info"))?.imap.host).toBe("imap.gmx.net");
    expect(asked).toEqual(["https://autoconfig.thunderbird.net/v1.1/gmx.info"]);
  });

  it("asks the domain's own autoconfig only outside the browser (no CORS there)", async () => {
    const own = "https://autoconfig.example.org/mail/config-v1.1.xml";
    let asked = stubFetch({ [own]: GMX });
    setKind("desktop");
    expect((await discoverImap("jane@example.org"))?.imap.host).toBe("imap.gmx.net");
    expect(asked).toContain(`${own}?emailaddress=jane%40example.org`);

    asked = stubFetch({ [own]: GMX });
    setKind("web");
    expect(await discoverImap("jane@example.org")).toBeNull();
    expect(asked.some((url) => url.startsWith(own))).toBe(false);
  });

  it("finds a custom domain's hoster from its MX records", async () => {
    const mx = (...hosts: string[]) =>
      JSON.stringify({ Answer: hosts.map((data) => ({ type: 15, data })) });
    stubFetch({
      "https://cloudflare-dns.com/dns-query?name=jane.dev": mx(
        "20 in2-smtp.messagingengine.com.",
        "10 in1-smtp.messagingengine.com.",
      ),
    });
    setKind("web");
    expect(await discoverImap("me@jane.dev")).toEqual({
      username: "me@jane.dev",
      imap: { host: "imap.fastmail.com", port: 993, security: "tls" },
      smtp: { host: "smtp.fastmail.com", port: 465, security: "tls" },
    });

    stubFetch({ "https://cloudflare-dns.com/dns-query?name=work.dev": mx("1 smtp.google.com.") });
    expect(await discoverImap("me@work.dev")).toBeNull();
  });

  it("looks the MX's domain up in the ISPDB", async () => {
    stubFetch({
      "https://cloudflare-dns.com/dns-query?name=jane.dev": JSON.stringify({
        Answer: [{ type: 15, data: "10 mx00.gmx.info." }],
      }),
      "https://autoconfig.thunderbird.net/v1.1/gmx.info": GMX,
    });
    setKind("web");
    expect((await discoverImap("me@jane.dev"))?.imap.host).toBe("imap.gmx.net");
  });

  it("uses the mail server itself when it answers IMAP with its own certificate", async () => {
    stubFetch({
      "https://cloudflare-dns.com/dns-query?name=ternes.info": JSON.stringify({
        Answer: [{ type: 15, data: "10 w020d192.kasserver.com." }],
      }),
    });
    const probed: string[] = [];
    setPlatform({
      kind: "web",
      connect: async (host: string) => {
        probed.push(host);
        if (host !== "w020d192.kasserver.com") throw new Error("certificate isn't trusted");
        return { close() {} };
      },
    } as unknown as Platform);
    expect(await discoverImap("sebastian@ternes.info")).toEqual({
      username: "sebastian@ternes.info",
      imap: { host: "w020d192.kasserver.com", port: 993, security: "tls" },
      smtp: { host: "w020d192.kasserver.com", port: 465, security: "tls" },
    });
    expect(probed).toEqual(["w020d192.kasserver.com"]);

    stubFetch({
      "https://cloudflare-dns.com/dns-query?name=spam.dev": JSON.stringify({
        Answer: [{ type: 15, data: "10 mx.filter.example." }],
      }),
    });
    expect(await discoverImap("me@spam.dev")).toBeNull();
  });
});
