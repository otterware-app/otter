import { toBase64 } from "../bytes.js";

const MAX_PROXY_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Fetch a remote email image in the backend and return it as a data URL. The
 * renderer's iframe can't load some remote images directly — e.g. anything
 * served with `Cross-Origin-Resource-Policy: same-origin` (Anthropic/Cloudflare
 * do this) is blocked by WebKit because the frame's origin isn't the image's.
 * The desktop backend has no such policy, so it can act as the image proxy
 * every mail client uses. (In a browser the fetch is subject to CORS, so this
 * only rescues images whose servers allow it.) Rejects non-image / oversized
 * responses.
 */
export async function proxyRemoteImage(url: string): Promise<{ dataUrl: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`unsupported protocol: ${parsed.protocol}`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // A browser-like UA + Accept so CDNs don't reject a bare fetch.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        Accept: "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/"))
      throw new Error(`not an image: ${contentType || "unknown"}`);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_PROXY_IMAGE_BYTES) throw new Error("image too large");
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_PROXY_IMAGE_BYTES) throw new Error("image too large");
    const mime = contentType.split(";")[0].trim() || "image/png";
    return { dataUrl: `data:${mime};base64,${toBase64(bytes)}` };
  } finally {
    clearTimeout(timeout);
  }
}
