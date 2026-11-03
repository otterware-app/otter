import { readJson, writeJson } from "../json-file.js";
import type { MailView, ViewRule } from "../types.js";

const ownViews = (views: MailView[]): MailView[] =>
  views.filter((v) => typeof v?.id === "string" && v.id.startsWith("v_"));

async function readViews(): Promise<MailView[]> {
  const parsed = await readJson<unknown>("views.json");
  return ownViews(Array.isArray(parsed) ? (parsed as MailView[]) : []);
}

export async function writeViews(views: MailView[]): Promise<void> {
  await writeJson("views.json", ownViews(views));
}

export async function listViews(): Promise<MailView[]> {
  return readViews();
}

function genId(): string {
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function saveView(input: {
  id?: string;
  name: string;
  rules: ViewRule[];
  icon?: string | null;
  color?: string | null;
}): Promise<MailView> {
  const views = await readViews();
  if (input.id) {
    const index = views.findIndex((v) => v.id === input.id);
    if (index >= 0) {
      views[index] = {
        ...views[index],
        name: input.name,
        rules: input.rules,
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
      };
      await writeViews(views);
      return views[index];
    }
  }
  const view: MailView = {
    id: genId(),
    name: input.name,
    kind: "custom",
    rules: input.rules,
    icon: input.icon ?? null,
    color: input.color ?? null,
  };
  views.push(view);
  await writeViews(views);
  return view;
}

export async function deleteView(id: string): Promise<void> {
  const views = await readViews();
  await writeViews(views.filter((v) => v.id !== id));
}
