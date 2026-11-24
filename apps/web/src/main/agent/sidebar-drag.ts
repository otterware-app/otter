/**
 * Adapted from T3 Code (github.com/pingdotgg/t3code at a1e7ac2b2; MIT, see THIRD_PARTY_NOTICES.md):
 * apps/web/src/components/Sidebar.drag.ts and the drag half of Sidebar.logic.ts.
 */
import { closestCenter, type CollisionDetection, type Modifier } from "@dnd-kit/core";
import {
  defaultAnimateLayoutChanges,
  type AnimateLayoutChanges,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import type { Chat } from "@otter/contracts/chats";
import type { ChatShelf } from "@otter/client/agents/chat-shelves";

/** Snoozed chats can't take a drop: there's no wake time to give them. */
export type DropShelf = Exclude<ChatShelf, "snoozed">;

export type ListMarker =
  | "pinned-header"
  | "pinned-divider"
  | "active-placeholder"
  | "snoozed-header"
  | "settled-header"
  | "settled-placeholder";

type ChatItem = { readonly kind: "chat"; readonly id: string; readonly shelf: ChatShelf };
export type ListItem = ChatItem | { readonly kind: "marker"; readonly marker: ListMarker };

export const markerId = (marker: ListMarker) => `sidebar-marker-${marker}`;
export const listItemId = (item: ListItem) =>
  item.kind === "chat" ? item.id : markerId(item.marker);

const isCard = (shelf: ChatShelf) => shelf === "pinned" || shelf === "active";
const isShelfHeader = (item: ListItem | undefined) =>
  item?.kind === "marker" && (item.marker === "snoozed-header" || item.marker === "settled-header");

// Sortable owns drag transforms; replaying committed order would animate drops twice.
export const animateLayoutChanges: AnimateLayoutChanges = (args) =>
  args.isSorting ? defaultAnimateLayoutChanges(args) : false;

function shelfAtSlot(items: readonly ListItem[], index: number): ChatShelf {
  let shelf: ChatShelf = "pinned";
  for (let i = 0; i < index && i < items.length; i += 1) {
    const item = items[i]!;
    if (item.kind !== "marker") continue;
    if (item.marker === "pinned-divider") shelf = "active";
    else if (item.marker === "snoozed-header") shelf = "snoozed";
    else if (item.marker === "settled-header") shelf = "settled";
  }
  return shelf;
}

export type DropTarget = {
  readonly shelf: DropShelf;
  readonly pinnedOrder: readonly string[];
};

/** Where the chat would land dropped on `overId`, with the pinned chats' order then. */
export function dropTarget(
  items: readonly ListItem[],
  activeId: string,
  overId: string,
): DropTarget | null {
  const activeIndex = items.findIndex((item) => listItemId(item) === activeId);
  const overIndex = items.findIndex((item) => listItemId(item) === overId);
  if (activeIndex === -1 || overIndex === -1 || items[activeIndex]?.kind !== "chat") return null;
  const moved = items.filter((_, index) => index !== activeIndex);
  moved.splice(overIndex, 0, items[activeIndex]!);
  const shelf = shelfAtSlot(moved, overIndex);
  if (shelf === "snoozed") return null;
  const pinnedOrder: string[] = [];
  for (const item of moved) {
    if (item.kind === "marker") {
      if (item.marker === "pinned-divider") break;
    } else pinnedOrder.push(item.id);
  }
  return { shelf, pinnedOrder };
}

export type DropVerb = "pin" | "unpin" | "settle" | "unsettle" | "wake";

export function dropVerb(from: ChatShelf, to: ChatShelf | null): DropVerb | null {
  if (to === null || to === from || to === "snoozed") return null;
  if (to === "pinned") return "pin";
  if (to === "settled") return "settle";
  if (from === "pinned") return "unpin";
  if (from === "settled") return "unsettle";
  return "wake";
}

export type DropPlan =
  | { readonly kind: "none" | "active" | "settle" }
  /** The pinned chats' new `pinnedAt`, the dropped one's among them. */
  | { readonly kind: "pin"; readonly pinnedAt: ReadonlyMap<string, number> };

/**
 * Active chats keep to when you last came back to them, so one dropped there from another shelf
 * goes to the top, and moving one within them does nothing. Pinned chats keep the order you drop
 * them in, through `pinnedAt`.
 */
export function planDrop(input: {
  id: string;
  from: ChatShelf;
  target: DropTarget;
  pinnedOrder: readonly string[];
  pinnedAt: ReadonlyMap<string, number>;
  now: number;
}): DropPlan {
  const { id, from, target, pinnedOrder } = input;
  switch (target.shelf) {
    case "active":
      return { kind: from === "active" ? "none" : "active" };
    case "settled":
      return { kind: from === "settled" ? "none" : "settle" };
    case "pinned": {
      const order = target.pinnedOrder;
      if (
        from === "pinned" &&
        order.length === pinnedOrder.length &&
        order.every((key, index) => key === pinnedOrder[index])
      )
        return { kind: "none" };
      return { kind: "pin", pinnedAt: pinnedSlot(order, input.pinnedAt, id, input.now) };
    }
  }
}

/** The chat as it will be once a drop on `shelf` is saved, to show it there meanwhile. */
export function withDrop<
  T extends Pick<Chat, "pinnedAt" | "snoozedUntil" | "settledAt" | "returnedAt">,
>(chat: T, shelf: DropShelf, at: number, pinnedAt?: number): T {
  const awake = { ...chat, snoozedUntil: null };
  if (shelf === "settled") return { ...awake, pinnedAt: null, settledAt: at };
  if (shelf === "pinned") return { ...awake, settledAt: null, pinnedAt: pinnedAt ?? at };
  return { ...awake, settledAt: null, pinnedAt: null, returnedAt: at };
}

/** A `pinnedAt` between its neighbours', in whole milliseconds as the relay keeps them. */
export function pinnedSlot(
  order: readonly string[],
  pinnedAt: ReadonlyMap<string, number>,
  id: string,
  now: number,
): ReadonlyMap<string, number> {
  const index = order.indexOf(id);
  const before = index > 0 ? pinnedAt.get(order[index - 1]!) : undefined;
  const after = pinnedAt.get(order[index + 1] ?? "");
  if (after === undefined) return new Map([[id, Math.max(now, (before ?? 0) + 1)]]);
  if (before === undefined) return new Map([[id, after - 1]]);
  if (after - before > 1) return new Map([[id, Math.floor((before + after) / 2)]]);
  // No millisecond left between them: number them all again, in order.
  const base = Math.min(...order.flatMap((key) => pinnedAt.get(key) ?? []));
  return new Map(order.map((key, i) => [key, base + i]));
}

export type SweepAction = "settle" | "unsettle" | "unsnooze";

export function sweepIds(
  orderedIds: readonly string[],
  originId: string,
  targetId: string,
  canApply: (id: string) => boolean,
): string[] {
  const origin = orderedIds.indexOf(originId);
  const target = orderedIds.indexOf(targetId);
  if (origin === -1 || target === -1) return [];
  return orderedIds.slice(Math.min(origin, target), Math.max(origin, target) + 1).filter(canApply);
}

export function chatIdAtY(list: HTMLElement, y: number): string | null {
  const viewport = list.closest('[data-slot="scroll-area-viewport"]')?.getBoundingClientRect();
  const visibleY = viewport ? Math.min(Math.max(y, viewport.top), viewport.bottom - 1) : y;
  let id: string | null = null;
  for (const row of list.querySelectorAll<HTMLElement>("li[data-chat-item]")) {
    if (id !== null && row.getBoundingClientRect().top > visibleY) break;
    id = row.dataset.chatItem ?? null;
  }
  return id;
}

export function restrictBelowLabel(
  { transform, containerNodeRect, draggingNodeRect }: Parameters<Modifier>[0],
  offset: number,
) {
  if (!containerNodeRect || !draggingNodeRect) return transform;
  const minimumY = containerNodeRect.top + offset - draggingNodeRect.top;
  return transform.y < minimumY ? { ...transform, y: minimumY } : transform;
}

export function createCollisionDetection(
  isValidTarget: (id: string) => boolean,
  options: { items?: readonly ListItem[]; activationY?: number | null } = {},
): CollisionDetection {
  const validity = new Map<string, boolean>();
  const shelves = new Map<string, DropShelf | null>();
  let previousPointerY = options.activationY;
  let boundaryShelf: "pinned" | "active" | undefined;
  return (args) => {
    let collisions = closestCenter(args);
    const pointer = args.pointerCoordinates;
    const items = options.items;
    const source = items?.find((item) => item.kind === "chat" && item.id === args.active.id);
    const boundary = args.droppableContainers
      .find((container) => container.id === markerId("pinned-divider"))
      ?.node.current?.querySelector(".sidebar-drag-boundary-label")
      ?.getBoundingClientRect();
    if (items && boundary && source?.kind === "chat" && pointer) {
      boundaryShelf ??= source.shelf === "pinned" ? "pinned" : "active";
      // Only pointer movement changes shelves; opening the destination moves rows under a still pointer.
      const previousY = previousPointerY ?? pointer.y;
      previousPointerY = pointer.y;
      if (pointer.x >= boundary.left && pointer.x <= boundary.right) {
        if (pointer.y < previousY && pointer.y <= boundary.bottom) boundaryShelf = "pinned";
        else if (pointer.y > previousY && pointer.y >= boundary.top) boundaryShelf = "active";
        const nextHeader = (["snoozed-header", "settled-header"] as const)
          .map((marker) =>
            args.droppableContainers.find((container) => container.id === markerId(marker)),
          )
          .find((container) => container !== undefined);
        const activeBottom = nextHeader?.node.current?.getBoundingClientRect().top;
        if (boundaryShelf === "pinned" || (activeBottom != null && pointer.y < activeBottom)) {
          const target = collisions.find((collision) => {
            const id = String(collision.id);
            if (!shelves.has(id))
              shelves.set(id, dropTarget(items, String(args.active.id), id)?.shelf ?? null);
            return shelves.get(id) === boundaryShelf;
          });
          if (target)
            collisions = [target, ...collisions.filter((collision) => collision !== target)];
        }
      }
    }
    const nearest = collisions[0];
    if (!nearest || nearest.id === args.active.id) return collisions;
    const id = String(nearest.id);
    const valid = validity.get(id) ?? isValidTarget(id);
    validity.set(id, valid);
    return valid ? collisions : collisions.filter((collision) => collision.id === args.active.id);
  };
}

const stationary = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
const hidden = { ...stationary, scaleY: 0 };
type Layout = Parameters<SortingStrategy>[0];

/**
 * Lays the rows out as they'll be after the drop: the chat moved to where its shelf sorts it, the
 * shelves it leaves or joins grown or shrunk, an empty shelf's placeholder shown.
 */
export function createSortingStrategy(input: {
  items: readonly ListItem[];
  /** Each shelf's order with the dragged chat dropped on it. */
  activeOrder: readonly string[];
  settledOrder: readonly string[];
  settledExpanded: boolean;
  settledVisibleCount: number;
  /** The open chat, shown among the settled ones even past the first page. */
  openId: string | null;
  snoozedCount: number;
  boundaryLabelHeight: number;
}): SortingStrategy {
  const { items } = input;
  const indices = new Map(items.map((item, index) => [listItemId(item), index]));
  let previous: Pick<Layout, "rects" | "activeIndex" | "overIndex"> | undefined;
  let transforms: ReturnType<SortingStrategy>[] = [];

  function project({ rects, activeIndex, overIndex }: Layout) {
    const active = items[activeIndex];
    const over = items[overIndex] ?? active;
    if (active?.kind !== "chat" || !over || !rects[0]) return [];
    const target = dropTarget(items, active.id, listItemId(over));
    if (!target) return [];
    const groups: Record<ChatShelf, ChatItem[]> = {
      pinned: [],
      active: [],
      snoozed: [],
      settled: [],
    };
    let cardHeight: number | undefined;
    let slimHeight: number | undefined;
    let headerScale: number | undefined;
    for (const [index, item] of items.entries()) {
      if (item.kind === "marker") {
        if (isShelfHeader(item)) {
          const height = rects[index]?.height;
          if (height) headerScale ??= height / 32;
        }
        continue;
      }
      if (isCard(item.shelf)) cardHeight ??= rects[index]?.height;
      else slimHeight ??= rects[index]?.height;
      if (item.id !== active.id) groups[item.shelf].push(item);
    }
    const scale =
      slimHeight !== undefined ? slimHeight / 36 : (headerScale ?? (cardHeight ?? 82) / 82);
    cardHeight ??= 82 * scale;
    slimHeight ??= 36 * scale;
    const labelHeight = input.boundaryLabelHeight * scale;
    const group = groups[target.shelf];
    const order =
      target.shelf === "pinned"
        ? target.pinnedOrder
        : target.shelf === "settled"
          ? input.settledOrder
          : input.activeOrder;
    const ranks = new Map(order.map((id, index) => [id, index]));
    const rank = ranks.get(active.id) ?? Number.POSITIVE_INFINITY;
    const index = group.findIndex(
      (item) => (ranks.get(item.id) ?? Number.POSITIVE_INFINITY) > rank,
    );
    group.splice(index < 0 ? group.length : index, 0, { ...active, shelf: target.shelf });
    const settledOrder = input.settledOrder.filter(
      (id) => id !== active.id || target.shelf === "settled",
    );
    const visible = input.settledExpanded ? settledOrder.slice(0, input.settledVisibleCount) : [];
    if (
      input.settledExpanded &&
      input.openId &&
      settledOrder.includes(input.openId) &&
      !visible.includes(input.openId)
    )
      visible.push(input.openId);
    groups.settled = visible.map((id) => ({ kind: "chat", id, shelf: "settled" }));
    const projected: ListItem[] = [];
    const marker = (name: ListMarker) => projected.push({ kind: "marker", marker: name });
    const section = (name: "active" | "settled") => {
      if (groups[name].length > 0) projected.push(...groups[name]);
      else marker(`${name}-placeholder`);
    };
    marker("pinned-header");
    projected.push(...groups.pinned);
    marker("pinned-divider");
    section("active");
    if (
      groups.snoozed.length > 0 ||
      ((active.shelf !== "snoozed" || input.snoozedCount > 1) &&
        items.some((item) => item.kind === "marker" && item.marker === "snoozed-header"))
    ) {
      marker("snoozed-header");
      projected.push(...groups.snoozed);
    }
    marker("settled-header");
    section("settled");
    const heights = projected.map((item) => {
      const index = indices.get(listItemId(item));
      const rect = index === undefined ? undefined : rects[index];
      const fallback = item.kind === "chat" && isCard(item.shelf) ? cardHeight : slimHeight;
      // A row that turns from a card to a slim row, or back, takes the other's height.
      const reshaped =
        item.kind === "chat" &&
        item.id === active.id &&
        isCard(item.shelf) !== isCard(active.shelf);
      return item.kind === "marker" &&
        (item.marker === "pinned-header" || item.marker === "pinned-divider")
        ? labelHeight
        : item.kind === "marker" && item.marker.endsWith("placeholder")
          ? slimHeight
          : reshaped
            ? fallback
            : (rect?.height ?? fallback);
    });
    const firstShelf = items.findIndex(isShelfHeader);
    const shelfRect = rects[firstShelf];
    const beforeShelf = rects[firstShelf - 1];
    const lastRect = rects.at(-1);
    let shelfSpace =
      shelfRect && beforeShelf && lastRect && shelfRect.top > beforeShelf.bottom + 1
        ? Math.max(
            0,
            lastRect.bottom - rects[0].top - heights.reduce((sum, height) => sum + height + 1, -1),
          )
        : 0;
    const result = items.map(() => hidden);
    let top = rects[0].top;
    for (const [projectedIndex, item] of projected.entries()) {
      if (isShelfHeader(item)) {
        top += shelfSpace;
        shelfSpace = 0;
      }
      const index = indices.get(listItemId(item));
      const rect = index === undefined ? undefined : rects[index];
      if (index !== undefined && rect) result[index] = { ...stationary, y: top - rect.top };
      top += heights[projectedIndex]! + 1;
    }
    result[activeIndex] = stationary;
    return result;
  }

  return (args) => {
    if (
      previous?.rects !== args.rects ||
      previous.activeIndex !== args.activeIndex ||
      previous.overIndex !== args.overIndex
    ) {
      previous = args;
      transforms = project(args);
    }
    return transforms[args.index] ?? stationary;
  };
}
