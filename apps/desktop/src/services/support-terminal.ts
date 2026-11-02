import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SupportTerminals } from "@otter-mail/shared/support";

import type { HostOS } from "../os/types.js";

type Terminals = HostOS["terminals"];

const preferenceFile = (home: string) => path.join(home, "support-terminal.json");

async function selectedTerminal(home: string): Promise<string | null> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(preferenceFile(home), "utf8"));
    return typeof value === "string" && /^[\w.-]+$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export async function getSupportTerminals(
  home: string,
  terminals: Terminals,
): Promise<SupportTerminals> {
  const result = await terminals.list();
  const apps = [...new Map(result.apps.map((item) => [item.id, item])).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const selected = await selectedTerminal(home);
  return {
    apps,
    defaultName: result.defaultName,
    selectedId: apps.some((item) => item.id === selected) ? selected : null,
  };
}

export async function setSupportTerminal(
  home: string,
  terminals: Terminals,
  id: unknown,
): Promise<SupportTerminals> {
  const available = await getSupportTerminals(home, terminals);
  if (id !== null && !available.apps.some((item) => item.id === id))
    throw new Error("Choose an installed terminal.");
  await fs.writeFile(preferenceFile(home), JSON.stringify(id), { mode: 0o600 });
  return { ...available, selectedId: id as string | null };
}

export async function openSupportTerminal(
  home: string,
  terminals: Terminals,
  launcher: string,
): Promise<void> {
  const saved = await selectedTerminal(home);
  const selected = saved ? (await getSupportTerminals(home, terminals)).selectedId : null;
  await terminals.open(launcher, selected);
}
