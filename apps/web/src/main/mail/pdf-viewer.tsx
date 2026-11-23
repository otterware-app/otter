import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AnnotationMode,
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type PageViewport,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Spinner } from "@otter/ui/components/spinner";
import "./pdf-viewer.css";

GlobalWorkerOptions.workerSrc = workerUrl;

const GAP = 12;
const PADDING = 16;
const MAX_CANVAS_PIXELS = 16_000_000;
type Size = { width: number; height: number };

export default function PdfViewer({ data, name }: { data: Uint8Array; name: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [first, setFirst] = useState<Size | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // pdf.js hands its copy to the worker, which detaches it.
    const task = getDocument({ data: data.slice() });
    let cancelled = false;
    void task.promise.then(
      async (loaded) => {
        const page = await loaded.getPage(1);
        if (cancelled) return;
        const { width, height } = page.getViewport({ scale: 1 });
        setFirst({ width, height });
        setDoc(loaded);
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not open this PDF.");
      },
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [data]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Pinch and ⌘/Ctrl-scroll zoom, keeping the same place in the document in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((z) => Math.min(5, Math.max(0.25, z * Math.exp(-event.deltaY / 200))));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const lastHeight = useRef(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (lastHeight.current) el.scrollTop *= el.scrollHeight / lastHeight.current;
    lastHeight.current = el.scrollHeight;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Re-runs when the document's height changes, which these decide.
  }, [zoom, width, doc]);

  const scale = first && width ? ((width - PADDING * 2) / first.width) * zoom : 0;
  return (
    <div
      ref={scroller}
      aria-label={name}
      className="relative min-h-0 flex-1 overflow-auto bg-black/5 dark:bg-black/30"
    >
      {error ? (
        <p className="p-6 text-center text-sm text-muted-foreground">{error}</p>
      ) : doc && first && scale ? (
        <div
          className="flex w-max min-w-full flex-col items-center"
          style={{ padding: PADDING, gap: GAP }}
        >
          {Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage key={i} doc={doc} number={i + 1} scale={scale} guess={first} root={scroller} />
          ))}
        </div>
      ) : (
        <div className="flex h-full items-center justify-center">
          <Spinner aria-label="Loading file" className="size-5" />
        </div>
      )}
    </div>
  );
}

function PdfPage({
  doc,
  number,
  scale,
  guess,
  root,
}: {
  doc: PDFDocumentProxy;
  number: number;
  scale: number;
  guess: Size;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState(guess);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry!.isIntersecting), {
      root: root.current,
      rootMargin: "100% 0px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [root]);

  // Only the pages near the view are drawn.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    if (!visible) {
      el.replaceChildren();
      return;
    }
    let cancelled = false;
    let cancel = () => {};
    void (async () => {
      const page = await doc.getPage(number);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const dpr = Math.min(
        window.devicePixelRatio || 1,
        Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.className = "absolute inset-0 size-full";
      const render = page.render({
        canvas,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        annotationMode: AnnotationMode.ENABLE,
      });
      cancel = () => render.cancel();
      try {
        await render.promise;
      } catch {
        return;
      }
      // Swapped in whole, so zooming shows the last render until the new one is ready.
      if (!cancelled) el.replaceChildren(canvas);
    })();
    return () => {
      cancelled = true;
      cancel();
    };
  }, [visible, doc, number, scale]);

  // Every page's text is laid out, so find reaches the whole document.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    let cancelled = false;
    const cleanups: (() => void)[] = [];
    void (async () => {
      const page = await doc.getPage(number);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const natural = page.getViewport({ scale: 1 });
      setSize({ width: natural.width, height: natural.height });
      const layer = document.createElement("div");
      layer.className = "textLayer";
      const text = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: layer,
        viewport,
      });
      cleanups.push(() => text.cancel());
      try {
        await Promise.all([text.render(), addFieldText(page, viewport, layer)]);
      } catch {
        return;
      }
      if (cancelled) return;
      const end = document.createElement("div");
      end.className = "endOfContent";
      layer.append(end);
      // As pdf.js's viewer does: while dragging, the end of the page catches the
      // pointer so the selection doesn't jump to the top.
      const start = () => layer.classList.add("selecting");
      const stop = () => layer.classList.remove("selecting");
      layer.addEventListener("pointerdown", start);
      document.addEventListener("pointerup", stop);
      cleanups.push(() => document.removeEventListener("pointerup", stop));
      el.replaceChildren(layer);
    })();
    return () => {
      cancelled = true;
      for (const cleanup of cleanups) cleanup();
    };
  }, [doc, number, scale]);

  return (
    <div
      ref={ref}
      className="relative shrink-0 bg-white shadow-sm"
      style={
        {
          width: Math.floor(size.width * scale),
          height: Math.floor(size.height * scale),
          "--total-scale-factor": scale,
          "--scale-round-x": "1px",
          "--scale-round-y": "1px",
        } as React.CSSProperties
      }
    >
      <div ref={canvasRef} className="absolute inset-0" />
      <div ref={textRef} className="absolute inset-0" />
    </div>
  );
}

/** Filled-in form fields are drawn on the canvas but aren't in the page's text: lay their values over them so they can be selected too. */
async function addFieldText(page: PDFPageProxy, viewport: PageViewport, layer: HTMLElement) {
  const annotations = (await page.getAnnotations({ intent: "display" })) as {
    subtype?: string;
    rect?: number[];
    fieldValue?: unknown;
    checkBox?: boolean;
    radioButton?: boolean;
  }[];
  for (const a of annotations) {
    if (a.subtype !== "Widget" || a.checkBox || a.radioButton || !a.rect) continue;
    const value = Array.isArray(a.fieldValue) ? a.fieldValue.join(", ") : a.fieldValue;
    if (typeof value !== "string" || !value.trim()) continue;
    const [x1, y1] = viewport.convertToViewportPoint(a.rect[0]!, a.rect[1]!) as number[];
    const [x2, y2] = viewport.convertToViewportPoint(a.rect[2]!, a.rect[3]!) as number[];
    const left = Math.min(x1!, x2!);
    const top = Math.min(y1!, y2!);
    const height = Math.abs(y2! - y1!);
    const span = document.createElement("span");
    span.className = "field";
    span.textContent = value;
    Object.assign(span.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${Math.abs(x2! - x1!)}px`,
      height: `${height}px`,
      fontSize: `${Math.min(height * 0.75, 12 * viewport.scale)}px`,
      lineHeight: `${height}px`,
    });
    layer.append(span);
  }
}
