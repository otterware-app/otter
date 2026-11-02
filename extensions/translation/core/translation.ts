import { sha256Hex, platform } from "@otter-mail/core/extension-kit";
import type { LanguageDetection, TranslationResult } from "@otter-mail/core/extension-kit";

const MAX_DETECTIONS = 500;
const detections = new Map<string, LanguageDetection>();

function translator() {
  const available = platform().translator;
  if (!available) throw new Error("Translation isn't available here.");
  return available;
}

export async function detectLanguage(text: string): Promise<LanguageDetection> {
  const key = await sha256Hex(text);
  const cached = detections.get(key);
  if (cached) return cached;
  const result = await translator().detect(text);
  if (detections.size >= MAX_DETECTIONS) {
    const oldest = detections.keys().next().value;
    if (oldest !== undefined) detections.delete(oldest);
  }
  detections.set(key, result);
  return result;
}

export async function translateSegments(
  segments: string[],
  source: string,
  target: string,
): Promise<TranslationResult> {
  const cacheFile = `translation-cache/${await sha256Hex(JSON.stringify([source, target, segments]))}.json`;
  try {
    const cached = await platform().files.read(cacheFile);
    const texts = cached ? (JSON.parse(new TextDecoder().decode(cached)) as unknown) : null;
    if (Array.isArray(texts) && texts.length === segments.length) {
      return { status: "ok", texts: texts as string[] };
    }
  } catch {
    // Not cached yet.
  }

  const result = await translator().translate(segments, source, target);
  if (result.status !== "ok") return { status: result.status, texts: [] };
  if (result.texts.length !== segments.length) {
    throw new Error("The translator returned an incomplete result.");
  }
  // Best-effort: a cache failure must never break translation.
  await platform()
    .files.write(cacheFile, JSON.stringify(result.texts))
    .catch(() => {});
  return result;
}
