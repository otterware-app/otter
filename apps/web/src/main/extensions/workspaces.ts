/**
 * Extensions' workspaces (types.ts `WorkspaceContribution`): what the
 * manifests declare, joined with what the `./ui` halves draw. A workspace's
 * space is `__<id>__`, so its address is `/<id>/<location>/<item>`.
 */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { availableExtensions, extensionEnabled, useDisabledExtensions } from "./registry";
import type { WorkspaceContribution, WorkspaceLocation } from "./types";

export type Workspace = WorkspaceContribution & { title: string; extensionId: string };

const SPACE = /^__([a-z]+)__$/;

export const workspaceSpace = (id: string) => `__${id}__`;

let all: readonly Workspace[] | null = null;

export function allWorkspaces(): readonly Workspace[] {
  all ??= availableExtensions().flatMap((e) =>
    (e.manifest.contributes?.workspaces ?? []).map((declared) => {
      const drawn = e.workspaces?.find((w) => w.id === declared.id);
      if (!drawn)
        throw new Error(`${e.manifest.id} declares the workspace ${declared.id} but draws none.`);
      return { ...drawn, title: declared.title, extensionId: e.manifest.id };
    }),
  );
  return all;
}

export function workspaceOf(spaceId: string | null): Workspace | undefined {
  const id = spaceId ? SPACE.exec(spaceId)?.[1] : undefined;
  const workspace = id ? allWorkspaces().find((w) => w.id === id) : undefined;
  return workspace && extensionEnabled(workspace.extensionId) ? workspace : undefined;
}

export const isWorkspaceSegment = (segment: string) =>
  allWorkspaces().some((w) => w.id === segment);

export function useWorkspaces(): readonly Workspace[] {
  const disabled = useDisabledExtensions();
  return useMemo(() => allWorkspaces().filter((w) => !disabled.has(w.extensionId)), [disabled]);
}

export function useOpenWorkspace(): (
  id: string,
  to?: Partial<WorkspaceLocation>,
  replace?: boolean,
) => void {
  const navigate = useNavigate();
  return useCallback(
    (id, to = {}, replace = false) => {
      const workspace = allWorkspaces().find((w) => w.id === id);
      if (!workspace) return;
      const params = { mailbox: workspaceSpace(id), label: to.location ?? workspace.home };
      if (to.item)
        void navigate({
          to: "/$mailbox/$label/$messageId",
          params: { ...params, messageId: to.item },
          replace,
        });
      else void navigate({ to: "/$mailbox/$label", params, replace });
    },
    [navigate],
  );
}
