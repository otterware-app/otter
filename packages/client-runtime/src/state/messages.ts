import { Atom, type AtomRegistry } from "effect/reactivity";

import type { CoreBridge } from "../connection/index.ts";
import type { ListMessagesResult, MessageSummary } from "../mail.ts";
import type { AppFocus } from "../platform/index.ts";

/** A mailbox's list: a label (or All Mail), in the account or one of its alias mailboxes. */
export type ThreadListKey = { accountId: string; labelId?: string; alias?: string };

export const threadListId = ({ accountId, labelId, alias }: ThreadListKey): string =>
  JSON.stringify([accountId, labelId ?? null, alias ?? null]);

const keyOf = (id: string): ThreadListKey => {
  const [accountId, labelId, alias] = JSON.parse(id) as [string, string | null, string | null];
  return { accountId, ...(labelId ? { labelId } : {}), ...(alias ? { alias } : {}) };
};

export type ThreadListState = {
  /** As core answered them; the view applies the overlays on top. */
  pages: ListMessagesResult[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  fetchingNext: boolean;
  refreshing: boolean;
  /** When the pages last came in (0: never), for the stale time. */
  fetchedAt: number;
  stale: boolean;
};

export type ThreadListView = {
  pages: ListMessagesResult[];
  hasNextPage: boolean;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  error: string | null;
};

const EMPTY: ThreadListState = {
  pages: [],
  status: "idle",
  error: null,
  fetchingNext: false,
  refreshing: false,
  fetchedAt: 0,
  stale: false,
};

/**
 * An optimistic change to an account's rows: patches a row, or drops it from
 * a list (null). It shows until the write fails (`drop`) or, once it's done
 * (`settle`), until each list it covered has loaded again from core.
 */
export type OverlayTransform = (row: MessageSummary, list: ThreadListKey) => MessageSummary | null;

export interface Overlay {
  settle(): void;
  drop(): void;
}

type OverlayEntry = {
  id: number;
  accountId: string;
  transform: OverlayTransform;
  /** Settled at this fetch sequence; lists still to load again after it. */
  settledAt: number | null;
  pending: Set<string>;
};

export interface ThreadListsOptions {
  core: CoreBridge;
  focus?: AppFocus;
  pageSize?: number;
  /** Lists newer than this aren't fetched again when shown or the app comes back. */
  staleTimeMs?: number;
  retries?: number;
  log?(event: string, data?: Record<string, unknown>): void;
}

export type ThreadLists = ReturnType<typeof makeThreadLists>;

/**
 * The thread lists (`gmail:listMessages`), one atom per list, paged by
 * cursor, with optimistic overlays from writes and core's mail changes
 * driving refreshes. Cached lists show at once and refresh when stale.
 */
export function makeThreadLists(registry: AtomRegistry.AtomRegistry, options: ThreadListsOptions) {
  const { core, pageSize = 50, staleTimeMs = 30_000, retries = 3 } = options;

  const stateAtom = Atom.family((_id: string) =>
    Atom.make<ThreadListState>(EMPTY).pipe(Atom.keepAlive),
  );
  const overlaysAtom = Atom.make<readonly OverlayEntry[]>([]).pipe(Atom.keepAlive);

  const viewAtom = Atom.family((id: string) => {
    const key = keyOf(id);
    return Atom.make((get): ThreadListView => {
      const state = get(stateAtom(id));
      const overlays = get(overlaysAtom).filter(
        (o) => o.accountId === key.accountId && (o.settledAt === null || o.pending.has(id)),
      );
      return {
        pages: overlays.length === 0 ? state.pages : applyOverlays(state.pages, overlays, key),
        hasNextPage: Boolean(state.pages.at(-1)?.nextPageToken),
        isLoading: state.status === "loading" && state.pages.length === 0,
        isFetchingNextPage: state.fetchingNext,
        error: state.error,
      };
    });
  });

  const known = new Set<string>();
  const mounted = new Map<string, number>();
  const generation = new Map<string, number>();
  let sequence = 0;
  let nextOverlayId = 1;

  const read = (id: string) => registry.get(stateAtom(id));
  const write = (id: string, patch: Partial<ThreadListState>) => {
    known.add(id);
    registry.set(stateAtom(id), { ...read(id), ...patch });
  };

  const listPage = (key: ThreadListKey, pageToken: string | undefined) => {
    options.log?.("fetching", {
      accountId: key.accountId,
      labelId: key.labelId,
      alias: Boolean(key.alias),
      pageToken,
    });
    return core.invoke<ListMessagesResult>("gmail:listMessages", {
      accountId: key.accountId,
      labelIds: key.labelId ? [key.labelId] : undefined,
      alias: key.alias,
      pageToken,
      maxResults: pageSize,
    });
  };

  async function withRetries<A>(run: () => Promise<A>): Promise<A> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await run();
      } catch (error) {
        if (attempt >= retries) throw error;
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.min(1000 * 2 ** attempt, 30_000)),
        );
      }
    }
  }

  function loaded(id: string, startedAt: number): void {
    const overlays = registry.get(overlaysAtom);
    let changed = false;
    for (const o of overlays) {
      if (o.settledAt !== null && o.settledAt < startedAt && o.pending.delete(id)) changed = true;
    }
    if (changed) registry.set(overlaysAtom, overlays.filter(live));
  }

  /** Fetches the list again, as many pages as it had (each page's cursor from the one before). */
  async function load(id: string): Promise<void> {
    const key = keyOf(id);
    const gen = (generation.get(id) ?? 0) + 1;
    generation.set(id, gen);
    const startedAt = ++sequence;
    const current = read(id);
    const count = Math.max(1, current.pages.length);
    write(id, current.pages.length > 0 ? { refreshing: true } : { status: "loading" });
    try {
      const pages: ListMessagesResult[] = [];
      let token: string | undefined;
      for (let i = 0; i < count; i++) {
        const page = await withRetries(() => listPage(key, token));
        if (generation.get(id) !== gen) return;
        pages.push(page);
        token = page.nextPageToken;
        if (!token) break;
      }
      write(id, {
        pages,
        status: "ready",
        error: null,
        refreshing: false,
        fetchedAt: Date.now(),
        stale: false,
      });
      loaded(id, startedAt);
    } catch (error) {
      if (generation.get(id) !== gen) return;
      write(id, {
        status: read(id).pages.length > 0 ? "ready" : "error",
        error: error instanceof Error ? error.message : String(error),
        refreshing: false,
      });
    }
  }

  const busy = (s: ThreadListState) => s.status === "loading" || s.refreshing || s.fetchingNext;
  const isStale = (s: ThreadListState) =>
    s.status === "idle" || s.stale || Date.now() - s.fetchedAt > staleTimeMs;

  function refreshIfStale(id: string): void {
    const state = read(id);
    if (!busy(state) && isStale(state)) void load(id);
  }

  async function fetchNextPage(key: ThreadListKey): Promise<void> {
    const id = threadListId(key);
    const state = read(id);
    const token = state.pages.at(-1)?.nextPageToken;
    if (!token || busy(state)) return;
    const gen = generation.get(id) ?? 0;
    write(id, { fetchingNext: true });
    try {
      const page = await withRetries(() => listPage(key, token));
      if (generation.get(id) !== gen) return;
      write(id, { pages: [...read(id).pages, page], fetchingNext: false, error: null });
    } catch (error) {
      if (generation.get(id) !== gen) return;
      write(id, {
        fetchingNext: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const ofAccount = (accountId: string | undefined) =>
    [...known].filter((id) => accountId === undefined || keyOf(id).accountId === accountId);

  let reloading: Set<string> | null = null;

  /**
   * Core's mail changed (or a write landed): shown lists load again (once,
   * however many ask in the same turn), the rest when next shown.
   */
  function invalidate(accountId?: string): void {
    const ids = ofAccount(accountId);
    for (const id of ids) write(id, { stale: true });
    if (!reloading) {
      const batch = (reloading = new Set());
      queueMicrotask(() => {
        reloading = null;
        for (const id of batch) {
          if (!mounted.has(id)) continue;
          if (read(id).fetchingNext) write(id, { fetchingNext: false });
          void load(id);
        }
      });
    }
    for (const id of ids) reloading.add(id);
  }

  /** Rows gone for good (a sent draft's thread): out of the account's lists now. */
  function update(accountId: string, remove: (row: MessageSummary) => boolean): void {
    for (const id of ofAccount(accountId)) {
      const state = read(id);
      if (state.pages.length === 0) continue;
      write(id, {
        pages: state.pages.map((page) => ({
          ...page,
          messages: page.messages.filter((m) => !remove(m)),
        })),
      });
    }
  }

  function overlay(accountId: string, transform: OverlayTransform): Overlay {
    const entry: OverlayEntry = {
      id: nextOverlayId++,
      accountId,
      transform,
      settledAt: null,
      pending: new Set(),
    };
    registry.set(overlaysAtom, [...registry.get(overlaysAtom), entry]);
    const replace = (next: OverlayEntry | null) =>
      registry.set(
        overlaysAtom,
        registry
          .get(overlaysAtom)
          .flatMap((o) => (o.id !== entry.id ? [o] : next && live(next) ? [next] : [])),
      );
    return {
      settle() {
        const pending = new Set(ofAccount(accountId).filter((id) => read(id).pages.length > 0));
        replace({ ...entry, settledAt: ++sequence, pending });
        invalidate(accountId);
      },
      drop: () => replace(null),
    };
  }

  /** A row in the account's lists as core last sent it (before overlays). */
  function find(
    accountId: string,
    match: (row: MessageSummary) => boolean,
  ): MessageSummary | undefined {
    for (const id of ofAccount(accountId)) {
      for (const page of read(id).pages) {
        const row = page.messages.find(match);
        if (row) return row;
      }
    }
    return undefined;
  }

  /** A screen shows this list: load it if it's stale; returns how to stop. */
  function show(key: ThreadListKey): () => void {
    const id = threadListId(key);
    known.add(id);
    mounted.set(id, (mounted.get(id) ?? 0) + 1);
    refreshIfStale(id);
    return () => {
      const count = (mounted.get(id) ?? 1) - 1;
      if (count > 0) mounted.set(id, count);
      else mounted.delete(id);
    };
  }

  /** Follows core's mail changes and the app coming back to the front; returns how to stop. */
  function start(): () => void {
    const stopFocus = options.focus?.onFocus(() => {
      for (const id of mounted.keys()) refreshIfStale(id);
    });
    const stopChanges = core.on("gmail:mail-changed", () => invalidate());
    return () => {
      stopFocus?.();
      stopChanges();
    };
  }

  return {
    /** The list as screens show it, overlays applied. */
    listAtom: (key: ThreadListKey) => viewAtom(threadListId(key)),
    stateAtom: (key: ThreadListKey) => stateAtom(threadListId(key)) as Atom.Atom<ThreadListState>,
    show,
    fetchNextPage,
    invalidate,
    update,
    overlay,
    find,
    start,
  };
}

const live = (o: OverlayEntry) => o.settledAt === null || o.pending.size > 0;

function applyOverlays(
  pages: ListMessagesResult[],
  overlays: readonly OverlayEntry[],
  key: ThreadListKey,
): ListMessagesResult[] {
  return pages.map((page) => ({
    ...page,
    messages: page.messages.flatMap((row) => {
      let current: MessageSummary | null = row;
      for (const o of overlays) {
        current = o.transform(current, key);
        if (!current) return [];
      }
      return [current];
    }),
  }));
}
