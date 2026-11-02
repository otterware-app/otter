import { session } from "electron";

/** Where Otter Drive serves documents' files from (its own site, otterware.app). */
const DRIVE_CONTENT_ORIGIN = "https://usercontent.otterware.app";
const DRIVE_CONTENT = `${DRIVE_CONTENT_ORIGIN}/*`;

/** A frame showing an Otter Drive document (the Drive workspace) loads it in place. */
export function isDriveContent(url: string): boolean {
  return URL.parse(url)?.origin === DRIVE_CONTENT_ORIGIN;
}

/**
 * Lets the app's windows show Otter Drive's documents (the Drive workspace): their videos,
 * images, pages and sites load from Drive's content host, behind a cookie Drive sets as
 * same-site and files it marks same-site only. The web app is on that site; the desktop
 * app's windows aren't, so here the cookie goes cross-site and the files may be embedded.
 * Only the windows' session: the browser's tabs keep Drive's rules.
 */
export function embedDriveContent(): void {
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: [DRIVE_CONTENT] },
    ({ responseHeaders }, callback) => {
      const headers = { ...responseHeaders };
      for (const name of Object.keys(headers)) {
        const lower = name.toLowerCase();
        if (lower === "cross-origin-resource-policy") delete headers[name];
        if (lower === "set-cookie")
          headers[name] = headers[name]!.map((cookie) =>
            cookie.replace(/;\s*SameSite=Lax/i, "; SameSite=None"),
          );
      }
      callback({ responseHeaders: headers });
    },
  );
}
