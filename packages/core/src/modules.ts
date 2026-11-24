/** The modules core starts beside what is always on (the Otter account, agents and chats, preferences). */
export type CoreModule = "mail" | "calendar";

export const ALL_MODULES: readonly CoreModule[] = ["mail", "calendar"];

let started: ReadonlySet<CoreModule> = new Set(ALL_MODULES);

export function setModules(modules: readonly CoreModule[]): void {
  // Calendars are the mailboxes' own: their sign-ins, sync and switches are mail's.
  if (modules.includes("calendar") && !modules.includes("mail"))
    throw new Error("The calendar module needs the mail module.");
  started = new Set(modules);
}

export const runs = (module: CoreModule): boolean => started.has(module);
