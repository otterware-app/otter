/**
 * mail.otterware.app: the web app, for every page that isn't one of its files
 * (/you@gmail.com/INBOX/…, /settings/…); it signs in first if need be. Otter
 * Mail's page, changelog, privacy policy and terms are on otterware.app: their
 * old addresses here (in Google's consent screen, past releases' notes, links
 * out there) go to them.
 */

interface Env {
  ASSETS: Fetcher;
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
    const response = await env.ASSETS.fetch(request);
    if (response.status === 404 && request.headers.get("accept")?.includes("text/html")) {
      return env.ASSETS.fetch(new Request(new URL("/", url), request));
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
