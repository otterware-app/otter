/**
 * The files the made-up agents made, by path, as a real agent's reader gives them: Markdown, code,
 * a picture, a log too long to show whole, a kind with no preview, and one outside its workspace.
 */
import { chatFile, chatFilePath } from "../services/agent/files.ts";
import type { ChatFile } from "../services/agent/types.ts";

const AGENDA = `# Q4 planning, Thursday 2pm

1. Review Q3 goals (15 min)
2. Offline search before the redesign (20 min)
3. **Hiring plan** (20 min): one or two backend hires
4. Anything else

## Notes

- Tom wants offline search first: the redesign needs the new index.
- Priya asked Sam to own item 3.
`;

const HEADCOUNT = `"""What one or two backend hires cost until March, and when offline search ships."""

import argparse
from dataclasses import dataclass

MONTHS = 5
SALARY = 7_400


@dataclass
class Plan:
    hires: int
    overhead: float = 1.3

    def cost(self) -> int:
        return round(self.hires * MONTHS * SALARY * self.overhead)

    def ships(self) -> str:
        return "mid January" if self.hires > 1 else "February"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hires", type=int, nargs="+", default=[1, 2])
    parser.add_argument("--chart", action="store_true")
    args = parser.parse_args()
    for hires in args.hires:
        plan = Plan(hires)
        print(f"{hires} hire{'s' if hires > 1 else ''}: €{plan.cost() // 1000}k, ships {plan.ships()}")


if __name__ == "__main__":
    main()
`;

/** A bar chart as a 24-bit BMP: two bars, one hire and two. */
function chart(): Uint8Array {
  const width = 96;
  const height = 64;
  const row = width * 3;
  const bytes = new Uint8Array(54 + row * height);
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d]);
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  const bars = [
    { from: 16, to: 40, top: 28, bgr: [0xb0, 0x9b, 0x8c] },
    { from: 56, to: 80, top: 54, bgr: [0x3c, 0x8d, 0xf9] },
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bar = bars.find((b) => x >= b.from && x < b.to && y >= 6 && y < b.top);
      const color = y === 5 ? [0x60, 0x60, 0x60] : (bar?.bgr ?? [0xff, 0xff, 0xff]);
      bytes.set(color, 54 + y * row + x * 3);
    }
  }
  return bytes;
}

/** Some 1.2 MB of log: more than a preview shows (1 MB), so it comes back cut. */
function syncLog(): string {
  const lines: string[] = [];
  for (let i = 0; lines.length < 16_000; i++) {
    const at = new Date(Date.UTC(2026, 10, 23, 6) + i * 1_500).toISOString();
    lines.push(
      `${at} INFO  mail-sync account=sam@acme.example pass=${i} fetched=${i % 7} took=${180 + ((i * 37) % 900)}ms`,
    );
  }
  return lines.join("\n");
}

const text = (name: string, body: string, mimeType: string) =>
  chatFile(name, new TextEncoder().encode(body), mimeType);

export function readFakeFile(href: string): ChatFile {
  const path = chatFilePath(href);
  const name = path.split("/").at(-1) || path;
  if (path.startsWith("/tmp/"))
    throw new Error(
      "This file is outside the agent's workspace. Ask it to save the file in its workspace, or attach it.",
    );
  if (path.endsWith("q4-agenda.md")) return text(name, AGENDA, "text/markdown");
  if (path.endsWith(".py")) return text(name, HEADCOUNT, "text/x-python");
  if (path.endsWith(".bmp")) return chatFile(name, chart(), "image/bmp");
  if (path.endsWith(".log")) return text(name, syncLog(), "text/plain");
  if (path.endsWith(".key"))
    return chatFile(
      name,
      new TextEncoder().encode("PK\u0003\u0004 keynote"),
      "application/x-iwork-keynote-sffkey",
    );
  return text(
    name,
    `# ${name}\n\nThis is the made-up agent. A real agent's file opens here, read from where the agent runs.\n`,
    "text/markdown",
  );
}
