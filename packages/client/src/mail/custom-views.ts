import { useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "../bridge.ts";
import { host } from "../host.ts";
import { mailApi, type SaveViewParams } from "./api.ts";
import type { MailAccount, MailView, ViewRule } from "./types.ts";

export function resolveRules(view: MailView, accounts: MailAccount[]): ViewRule[] {
  const accountIds = new Set(accounts.map((a) => a.id));
  return view.rules.filter((r) => accountIds.has(r.accountId));
}

const VIEWS_QUERY_KEY = ["gmail:views"] as const;

export function useMailViews() {
  const qc = useQueryClient();

  // View edits happen in the Settings window, which has its own QueryClient —
  // listen for the backend broadcast so every window refreshes.
  useEffect(() => {
    const unsubscribe = listen("gmail:views-changed", () => {
      void qc.invalidateQueries({ queryKey: VIEWS_QUERY_KEY });
    });
    return unsubscribe;
  }, [qc]);

  const query = useQuery<MailView[]>({
    queryKey: VIEWS_QUERY_KEY,
    queryFn: () => mailApi.listViews(),
    staleTime: 30_000,
    placeholderData: [],
  });

  const invalidate = useCallback(
    () => void qc.invalidateQueries({ queryKey: VIEWS_QUERY_KEY }),
    [qc],
  );

  const patchViews = useCallback(
    async (patch: (views: MailView[]) => MailView[]) => {
      await qc.cancelQueries({ queryKey: VIEWS_QUERY_KEY });
      const prev = qc.getQueryData<MailView[]>(VIEWS_QUERY_KEY);
      qc.setQueryData<MailView[]>(VIEWS_QUERY_KEY, (views) => patch(views ?? []));
      return { prev };
    },
    [qc],
  );
  const rollback = (context?: { prev?: MailView[] }) => {
    if (context?.prev) qc.setQueryData(VIEWS_QUERY_KEY, context.prev);
  };

  const saveMutation = useMutation({
    mutationFn: (input: SaveViewParams) => mailApi.saveView(input),
    onMutate: (input) =>
      patchViews((views) =>
        input.id
          ? views.map((v) =>
              v.id === input.id
                ? {
                    ...v,
                    name: input.name,
                    rules: input.rules,
                    ...(input.icon !== undefined ? { icon: input.icon } : {}),
                    ...(input.color !== undefined ? { color: input.color } : {}),
                  }
                : v,
            )
          : [
              ...views,
              {
                id: `pending:${input.name}`,
                name: input.name,
                kind: "custom",
                rules: input.rules,
                icon: input.icon ?? null,
                color: input.color ?? null,
              },
            ],
      ),
    // The saved view in place of its pending one at once, so whoever goes
    // to it (a new view opens in its space) finds it before the refetch.
    onSuccess: (saved) =>
      qc.setQueryData<MailView[]>(VIEWS_QUERY_KEY, (views = []) =>
        views.some((v) => v.id === saved.id)
          ? views.map((v) => (v.id === saved.id ? saved : v))
          : views.map((v) => (v.id === `pending:${saved.name}` ? saved : v)),
      ),
    onError: (_err, _vars, context) => {
      rollback(context);
      host().notice({ tone: "error", title: "Could not save the view" });
    },
    onSettled: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => mailApi.deleteView(id),
    onMutate: (id) => patchViews((views) => views.filter((v) => v.id !== id)),
    onError: (_err, _vars, context) => {
      rollback(context);
      host().notice({ tone: "error", title: "Could not delete the view" });
    },
    onSettled: invalidate,
  });
  const saveView = useCallback(
    (input: SaveViewParams) => saveMutation.mutateAsync(input),
    [saveMutation],
  );
  const deleteView = useCallback((id: string) => deleteMutation.mutateAsync(id), [deleteMutation]);

  return {
    views: query.data ?? [],
    loaded: !query.isPlaceholderData,
    saveView,
    deleteView,
  };
}

const LAST_LOCATION_KEY = "gmail:last-location";

export type LastLocation = { accountId: string; labelId: string };

export function loadLastLocation(): LastLocation | null {
  try {
    const raw = host().storage.get(LAST_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.accountId === "string" && typeof parsed.labelId === "string") {
      return { accountId: parsed.accountId, labelId: parsed.labelId };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLastLocation(loc: LastLocation): void {
  try {
    host().storage.set(LAST_LOCATION_KEY, JSON.stringify(loc));
  } catch {
    // ignore
  }
}
