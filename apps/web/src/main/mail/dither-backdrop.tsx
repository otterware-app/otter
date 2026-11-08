import { useEffect, useRef, useState } from "react";

import otterUrl from "../assets/agent-otter.jpg";
import { cn } from "./ui";

const CELL = 3;
const DOT = 2;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

function useDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDark(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

function hash(x: number, y: number) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** A sea otter in kelp, as an ordered-dither dot screen. */
function paint(
  frame: HTMLElement,
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  dark: boolean,
) {
  const width = frame.clientWidth;
  const height = frame.clientHeight;
  if (!width || !height) return;
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const sample = document.createElement("canvas");
  sample.width = cols;
  sample.height = rows;
  const sctx = sample.getContext("2d", { willReadFrequently: true });
  if (!sctx) return;
  const scale = Math.max(cols / image.naturalWidth, rows / image.naturalHeight);
  const w = image.naturalWidth * scale;
  const h = image.naturalHeight * scale;
  sctx.drawImage(image, (cols - w) / 2, (rows - h) / 2, w, h);
  const source = sctx.getImageData(0, 0, cols, rows).data;

  canvas.width = cols * CELL;
  canvas.height = rows * CELL;
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const out = ctx.createImageData(canvas.width, canvas.height);
  const px = out.data;
  const put = (col: number, row: number, r: number, g: number, b: number, a: number) => {
    for (let dy = 0; dy < DOT; dy++) {
      let i = ((row * CELL + dy) * canvas.width + col * CELL) * 4;
      for (let dx = 0; dx < DOT; dx++, i += 4) {
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = b;
        px[i + 3] = a;
      }
    }
  };
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = (row * cols + col) * 4;
      const r = source[i];
      const g = source[i + 1];
      const b = source[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const chroma = (max - min) / 255;
      const threshold = BAYER[(row % 4) * 4 + (col % 4)];
      // Dark: light is drawn as dots. Light: ink and color are, on the white page.
      const level = dark
        ? Math.pow(light, 1.1) * 0.8 + chroma * 0.25
        : Math.pow(1 - light, 0.9) * 0.82 + chroma * 0.4;
      if (level > threshold) {
        const mean = (r + g + b) / 3;
        const tone = (c: number) =>
          Math.max(
            0,
            Math.min(255, (mean + (c - mean) * (dark ? 1.5 : 1.6)) * (dark ? 0.82 : 0.78)),
          );
        put(col, row, tone(r), tone(g), tone(b), dark ? 150 : 200);
        continue;
      }
      const noise = hash(col, row);
      if (noise < (dark ? 0.2 : 0.12)) {
        const pick = Math.floor(hash(row, col) * 3);
        const tint = dark ? 70 : 170;
        put(
          col,
          row,
          pick === 0 ? tint + 30 : tint,
          pick === 1 ? tint + 20 : tint,
          pick === 2 ? tint + 30 : tint,
          dark ? 90 : 60,
        );
      }
    }
  }
  ctx.putImageData(out, 0, 0);
}

export function DitherBackdrop({
  className,
  onTransitionEnd,
}: {
  className?: string;
  onTransitionEnd?: () => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dark = useDark();
  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;
    const image = new Image();
    image.src = otterUrl;
    let pending = 0;
    const draw = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => image.complete && paint(frame, canvas, image, dark));
    };
    image.addEventListener("load", draw);
    const observer = new ResizeObserver(draw);
    observer.observe(frame);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(pending);
    };
  }, [dark]);
  return (
    <div
      ref={frameRef}
      aria-hidden
      onTransitionEnd={onTransitionEnd}
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden rounded-xl not-dark:[mask-image:linear-gradient(to_bottom,transparent,black_45%)]",
        className,
      )}
    >
      <canvas ref={canvasRef} className="block [image-rendering:pixelated]" />
    </div>
  );
}
