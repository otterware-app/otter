interface Env {
  ASSETS: Fetcher;
  NIGHTLY?: Fetcher;
}

const CHANNEL_PATH = "/__otter-mail/channel";
const CHANNEL_COOKIE = "otter_mail_channel";

function wantsNightly(request: Request): boolean {
  const cookies = request.headers.get("cookie") ?? "";
  return cookies.split(/;\s*/).includes(`${CHANNEL_COOKIE}=nightly`);
}

function chooseChannel(url: URL): Response {
  const nightly = url.searchParams.get("channel") === "nightly";
  const cookie = nightly
    ? `${CHANNEL_COOKIE}=nightly; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`
    : `${CHANNEL_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
  return new Response(null, {
    status: 303,
    headers: { location: "/settings/general", "set-cookie": cookie, "cache-control": "no-store" },
  });
}

const SITE = "https://otterware.app/mail";

const CHANGELOG_VERSION = /^\/changelog\/(\d+\.\d+\.\d+)\/?$/;

const MOVED = /^\/(?:changelog|privacy|terms)(?:\/|$)/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "mail.otterware.dev") {
      if (url.pathname === "/") return Response.redirect(`${SITE}/`, 301);
      url.protocol = "https:";
      url.hostname = "mail.otterware.app";
      url.port = "";
      return Response.redirect(url.toString(), 308);
    }
    const version = CHANGELOG_VERSION.exec(url.pathname)?.[1];
    if (version) return Response.redirect(`${SITE}/changelog/#${version}`, 301);
    if (MOVED.test(url.pathname)) {
      const path =
        url.pathname.endsWith("/") || url.pathname.includes(".")
          ? url.pathname
          : `${url.pathname}/`;
      return Response.redirect(`${SITE}${path}`, 301);
    }
    if (url.pathname === CHANNEL_PATH) return chooseChannel(url);
    // Both channels serve this origin so they share the browser's mail cache and sign-in.
    if (env.NIGHTLY && wantsNightly(request)) return env.NIGHTLY.fetch(request);
    const response = await env.ASSETS.fetch(request);
    if (response.status === 404 && request.headers.get("accept")?.includes("text/html")) {
      return env.ASSETS.fetch(new Request(new URL("/", url), request));
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
