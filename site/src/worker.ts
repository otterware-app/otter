import * as Sentry from "@sentry/cloudflare";

import { errorReportOptions, SENTRY_DSN } from "@otter/shared/error-reports";

interface Env {
  ASSETS: Fetcher;
  NIGHTLY?: Fetcher;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
}

const errorReports = (env: Env) =>
  errorReportOptions({
    dsn: SENTRY_DSN.site,
    version: "site",
    release: `otter-site@${env.CF_VERSION_METADATA?.id ?? "local"}`,
    // Only the stable Worker has NIGHTLY.
    environment: env.NIGHTLY ? "stable" : "nightly",
    // Most requests are the app's files: a few are enough to see the Worker's speed.
    tracesSampleRate: 0.05,
  }) as Sentry.CloudflareOptions;

const CHANNEL_PATH = "/__otter-mail/channel";
const CHANNEL_COOKIE = "otter_mail_channel";

function wantsNightly(request: Request): boolean {
  const cookies = request.headers.get("cookie") ?? "";
  return cookies.split(/;\s*/).includes(`${CHANNEL_COOKIE}=nightly`);
}

function isNavigation(request: Request): boolean {
  const mode = request.headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  return request.method === "GET" && Boolean(request.headers.get("accept")?.includes("text/html"));
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

/** Otter's web app. Before the rename it was mail.otterware.app (and before that .dev). */
const APP = "https://otter.otterware.app";
const OLD_HOSTS = new Set(["mail.otterware.app", "mail.otterware.dev"]);

const CHANGELOG_VERSION = /^\/changelog\/(\d+\.\d+\.\d+)\/?$/;

const MOVED = /^\/(?:changelog|privacy|terms)(?:\/|$)/;

export default Sentry.withSentry(errorReports, {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "mail.otterware.dev" && url.pathname === "/")
      return Response.redirect(`${SITE}/`, 301);
    const version = CHANGELOG_VERSION.exec(url.pathname)?.[1];
    if (version) return Response.redirect(`${SITE}/changelog/#${version}`, 301);
    if (MOVED.test(url.pathname)) {
      const path =
        url.pathname.endsWith("/") || url.pathname.includes(".")
          ? url.pathname
          : `${url.pathname}/`;
      return Response.redirect(`${SITE}${path}`, 301);
    }
    // Only the stable Worker (the one with NIGHTLY) redirects: until a stable release moves it, it
    // hands nightly browsers on mail.otterware.app to the nightly build, which serves them there.
    // Only pages move: a tab still open on the old host keeps loading its files and version.json,
    // so it offers "Reload to update", and the reload lands on the new host.
    if (env.NIGHTLY && OLD_HOSTS.has(url.hostname) && isNavigation(request))
      return Response.redirect(`${APP}${url.pathname}${url.search}`, 308);
    if (url.pathname === CHANNEL_PATH) return chooseChannel(url);
    // Both channels serve this origin so they share the browser's mail cache and sign-in.
    if (env.NIGHTLY && wantsNightly(request)) return env.NIGHTLY.fetch(request);
    const response = await env.ASSETS.fetch(request);
    if (response.status === 404 && request.headers.get("accept")?.includes("text/html")) {
      return env.ASSETS.fetch(new Request(new URL("/", url), request));
    }
    return response;
  },
} satisfies ExportedHandler<Env>);
