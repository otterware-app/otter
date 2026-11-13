import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Popover } from "radix-ui";
import {
  CheckIcon,
  ChevronDownIcon,
  LockIcon,
  LockOpenIcon,
  PenLineIcon,
  PlusIcon,
  SearchIcon,
  StarIcon,
  ZapIcon,
} from "lucide-react";
import {
  mailApi,
  type AgentId,
  type ProviderModel,
  type ProviderModelOption,
  type ProviderSnapshot,
  type RuntimeMode,
} from "./api";
import { AgentFace, isProviderUsable, kindName } from "../agent/agent-providers";
import { agentContribution } from "../extensions/registry";
import { modelKey, toggleFavorite, useModelPrefs } from "./model-prefs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./menu";
import { HintTooltip, Kbd, cn, restoreFocusForKeyboardOnly } from "./ui";
import { AGENT_PICKER_JUMP_COMMANDS } from "../keybindings/commands";
import { matchesCommand, useCommandHandlers, useKeybindingContext } from "../keybindings/dispatch";
import { shortcutLabelFor, useKeybindingsState } from "../keybindings/store";

export const COMPOSER_CONTROL =
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-full border border-transparent outline-none hover:bg-accent-surface data-[state=open]:bg-accent-surface focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-64 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:-mx-0.5 [&_svg[data-composer-control-icon]]:mx-0 h-7 gap-1.5 px-2.5 text-sm font-normal text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground hover:text-foreground [&_svg:not([class*='size-'])]:size-4";

export function ComposerControlChevron() {
  return (
    <ChevronDownIcon
      aria-hidden
      className="size-3 shrink-0 text-icon-muted"
      data-composer-control-chevron
      strokeWidth={2.25}
    />
  );
}

function closeFocus(event: Event, returnFocus?: () => void): void {
  if (!returnFocus) return restoreFocusForKeyboardOnly(event);
  event.preventDefault();
  returnFocus();
}

export function modelLabel(name: string): string {
  if (!/^[a-z0-9.-]+$/.test(name)) return name;
  const parts = name.split("-").filter((part) => !/^\d{8}$/.test(part));
  const words: string[] = [];
  for (const part of parts) {
    const last = words[words.length - 1];
    if (/^\d+$/.test(part) && last && /\d$/.test(last)) words[words.length - 1] = `${last}.${part}`;
    else if (/^\d/.test(part) && last === "GPT") words[words.length - 1] = `GPT-${part}`;
    else if (part === "gpt") words.push("GPT");
    // OpenAI's o-series keeps its lowercase (o3, o4-mini).
    else if (/^o\d/.test(part)) words.push(part);
    else words.push(part.charAt(0).toUpperCase() + part.slice(1));
  }
  return words.join(" ");
}

/** Where `query`'s words fall in these fields (earlier fields, starts of words: better); null when one doesn't. */
function searchScore(fields: string[], query: string): number | null {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = fields.map((f) => f.toLowerCase());
  let score = 0;
  for (const token of tokens) {
    let best: number | null = null;
    lower.forEach((field, i) => {
      const at = field.indexOf(token);
      if (at === -1) return;
      const s =
        i * 10 +
        (field === token ? 0 : at === 0 ? 2 : /[\s\-_.]/.test(field[at - 1] ?? "") ? 4 : 6);
      best = best === null ? s : Math.min(best, s);
    });
    if (best === null) return null;
    score += best;
  }
  return score;
}

function statusText(p: ProviderSnapshot): string | null {
  if (isProviderUsable(p)) return null;
  if (!p.enabled) return "Turned off";
  return p.status === "error" ? "Unavailable" : "Not ready";
}

/** One row of the agent picker: an agent, or one of the agents an OpenClaw gateway runs. */
type AgentItem = {
  key: string;
  provider: ProviderSnapshot;
  /** The gateway's agent (`ProviderModel.slug`), for a kind whose models are agents. */
  agent: string | null;
  name: string;
  detail: string;
  status: string | null;
};

function agentItems(providers: ProviderSnapshot[]): AgentItem[] {
  return providers.flatMap((p): AgentItem[] => {
    const status = statusText(p);
    if (agentContribution(p.kind)?.subAgents && p.models.length > 0)
      return p.models.map((m) => ({
        key: `${p.id}:${m.slug}`,
        provider: p,
        agent: m.slug,
        name: m.name,
        detail: p.name,
        status,
      }));
    const model = p.models.find((m) => m.slug === p.model);
    return [
      {
        key: p.id,
        provider: p,
        agent: null,
        name: p.name,
        detail: model && p.models.length > 1 ? modelLabel(model.name) : kindName(p.kind),
        status,
      },
    ];
  });
}

function AgentRow({
  item,
  highlighted,
  selected,
  jumpLabel,
  onHover,
  onPick,
}: {
  item: AgentItem;
  highlighted: boolean;
  selected: boolean;
  jumpLabel: string | null;
  onHover: () => void;
  onPick: () => void;
}) {
  const disabled = item.status !== null;
  return (
    <div
      role="option"
      aria-selected={selected}
      aria-disabled={disabled}
      data-highlighted={highlighted || undefined}
      onMouseMove={onHover}
      onClick={disabled ? undefined : onPick}
      className={cn(
        "group relative flex h-11 w-full min-w-0 shrink-0 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm outline-none",
        highlighted && "bg-foreground/[0.06]",
        disabled && "cursor-default",
      )}
    >
      <span
        className={cn("flex size-7 shrink-0 items-center justify-center", disabled && "opacity-50")}
      >
        <AgentFace provider={item.provider} agent={item.agent} className="size-6" />
      </span>
      <span className={cn("flex min-w-0 flex-1 flex-col", disabled && "opacity-60")}>
        <span className="truncate leading-5 text-foreground">{item.name}</span>
        <span className="truncate text-xs leading-4 text-muted-foreground">
          {item.status ? `${item.detail} · ${item.status}` : item.detail}
        </span>
      </span>
      {jumpLabel ? (
        <Kbd className="hidden group-data-[highlighted]:inline-flex">{jumpLabel}</Kbd>
      ) : null}
      <CheckIcon
        aria-hidden
        className={cn("size-4 shrink-0 text-foreground", !selected && "invisible")}
      />
    </div>
  );
}

function AgentPickerContent({
  providers,
  activeKey,
  onPick,
  onAdd,
  onClose,
}: {
  providers: ProviderSnapshot[];
  activeKey: string | null;
  onPick: (item: AgentItem) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  useKeybindingContext("agentPickerOpen", true);
  const { resolved } = useKeybindingsState();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const all = useMemo(() => agentItems(providers), [providers]);
  const items = useMemo(() => {
    if (!query.trim()) return all;
    return all
      .map((item) => ({
        item,
        score: searchScore([item.name, item.detail, item.provider.name, item.provider.kind], query),
      }))
      .filter((r): r is { item: AgentItem; score: number } => r.score !== null)
      .sort((a, b) => a.score - b.score)
      .map((r) => r.item);
  }, [all, query]);
  const rows = items.length + 1;

  const highlightKey = `${activeKey}:${items.map((item) => item.key).join(",")}`;
  const [highlightFor, setHighlightFor] = useState(highlightKey);
  if (highlightFor !== highlightKey) {
    setHighlightFor(highlightKey);
    const index = items.findIndex((item) => item.key === activeKey);
    setHighlight(index >= 0 ? index : 0);
  }
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>("[data-highlighted]")
      ?.scrollIntoView({ block: "nearest" });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Re-run this DOM/reset lifecycle when its explicit trigger changes, even when the callback reads refs.
  }, [highlight]);
  useLayoutEffect(() => {
    searchRef.current?.focus({ preventScroll: true });
  }, []);

  const pick = (index: number) => {
    if (index === items.length) return onAdd();
    const item = items[index];
    if (item && item.status === null) onPick(item);
  };

  return (
    <div
      className="flex max-h-96 w-screen max-w-80 flex-col overflow-hidden"
      data-agent-picker-content
    >
      <div className="min-w-0 shrink-0 border-b border-foreground/10 px-3 py-2">
        <div className="relative">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute left-0 top-1.5 size-4 shrink-0 text-muted-foreground"
          />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents..."
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Search agents"
            className="h-7 w-full bg-transparent ps-6 font-sans text-sm leading-7 text-foreground outline-none placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              const native = e.nativeEvent;
              const jump = AGENT_PICKER_JUMP_COMMANDS.findIndex((c) => matchesCommand(native, c));
              if (jump >= 0 && jump < items.length) {
                e.preventDefault();
                e.stopPropagation();
                pick(jump);
                return;
              }
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setHighlight((h) => (h + delta + rows) % rows);
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                pick(highlight);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
                return;
              }
              e.stopPropagation();
            }}
          />
        </div>
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Agents"
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-1.5"
      >
        {items.map((item, index) => (
          <AgentRow
            key={item.key}
            item={item}
            highlighted={index === highlight}
            selected={item.key === activeKey}
            jumpLabel={
              index < AGENT_PICKER_JUMP_COMMANDS.length
                ? shortcutLabelFor(resolved, AGENT_PICKER_JUMP_COMMANDS[index])
                : null
            }
            onHover={() => setHighlight(index)}
            onPick={() => onPick(item)}
          />
        ))}
        {items.length === 0 && query.trim() ? (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">No agents found</div>
        ) : null}
        <div
          role="option"
          aria-selected={false}
          data-highlighted={highlight === items.length || undefined}
          onMouseMove={() => setHighlight(items.length)}
          onClick={onAdd}
          className={cn(
            "flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm text-muted-foreground outline-none",
            highlight === items.length && "bg-foreground/[0.06] text-foreground",
          )}
        >
          <span className="flex size-7 shrink-0 items-center justify-center">
            <PlusIcon className="size-4" />
          </span>
          Add agent
        </div>
      </div>
    </div>
  );
}

/**
 * Who a chat talks to: the agents you added, each as it shows itself (an OpenClaw gateway's own
 * agents among them). A started chat stays with its agent.
 */
export function AgentPicker({
  providers,
  active,
  agent = null,
  locked,
  onPick,
  returnFocus,
  className,
}: {
  providers: ProviderSnapshot[];
  active: ProviderSnapshot | undefined;
  /** The gateway's agent a started chat is bound to (OpenClaw). */
  agent?: string | null;
  locked: boolean;
  onPick: (id: AgentId, agent: string | null) => void;
  returnFocus?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  useCommandHandlers({ "agentPicker.toggle": () => (locked ? false : setOpen((o) => !o)) });
  // An agent's models change as its logins do (varys): listed again each time the picker opens.
  useEffect(() => {
    if (open) void mailApi.refreshAgentProviders().catch(() => {});
  }, [open]);
  const gateway = active && agentContribution(active.kind)?.subAgents;
  const slug = gateway ? (agent ?? active.model) : null;
  const shownAgent = slug ? active?.models.find((m) => m.slug === slug) : undefined;
  const label = shownAgent?.name ?? active?.name ?? "Choose agent";
  const activeKey = active ? (slug ? `${active.id}:${slug}` : active.id) : null;
  const face = (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <AgentFace provider={active} agent={slug} className="size-4" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </span>
  );

  if (locked)
    return (
      <HintTooltip label={`This chat is with ${label}. Start a new chat to talk to another agent.`}>
        <span
          data-chat-agent-picker
          className={cn(
            COMPOSER_CONTROL,
            "min-w-0 max-w-48 shrink cursor-default text-foreground/90 hover:bg-transparent",
            className,
          )}
        >
          {face}
        </span>
      </HintTooltip>
    );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <HintTooltip label="Choose agent" shortcut="agentPicker.toggle">
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={`Agent: ${label}`}
            data-chat-agent-picker
            className={cn(
              COMPOSER_CONTROL,
              "min-w-0 max-w-48 shrink justify-between text-foreground/90 sm:max-w-56",
              className,
            )}
          >
            {face}
            <ComposerControlChevron />
          </button>
        </Popover.Trigger>
      </HintTooltip>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onCloseAutoFocus={(event) => closeFocus(event, returnFocus)}
          className="dropdown-glass z-[130] overflow-hidden rounded-lg text-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] outline-none dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]"
        >
          <AgentPickerContent
            providers={providers.filter((p) => p.enabled || p.id === active?.id)}
            activeKey={activeKey}
            onClose={() => setOpen(false)}
            onAdd={() => {
              setOpen(false);
              void mailApi.openSettings({ pane: "agents" });
            }}
            onPick={(item) => {
              onPick(item.provider.id, item.agent);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The model an agent runs (Claude's, Codex's, a Hermes server's), when it offers more than one. */
export function ModelPicker({
  provider,
  onPick,
  returnFocus,
  chevron = true,
  className,
}: {
  provider: ProviderSnapshot;
  onPick: (slug: string) => void;
  returnFocus?: () => void;
  chevron?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { favorites, hidden } = useModelPrefs();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const model = provider.models.find((m) => m.slug === provider.model);
  const label = modelLabel(model?.name ?? provider.model ?? "Model");
  const key = (slug: string) => modelKey(provider.id, slug);
  const models = useMemo(() => {
    const shown = provider.models.filter(
      (m) => !hidden.includes(modelKey(provider.id, m.slug)) || m.slug === provider.model,
    );
    if (query.trim())
      return shown
        .map((m) => ({ m, score: searchScore([m.name, m.slug, m.subProvider ?? ""], query) }))
        .filter((r): r is { m: ProviderModel; score: number } => r.score !== null)
        .sort((a, b) => a.score - b.score)
        .map((r) => r.m);
    const groups = [...new Set(shown.map((m) => m.subProvider ?? null))];
    return groups.flatMap((group) => {
      const inGroup = shown.filter((m) => (m.subProvider ?? null) === group);
      const starred = (m: ProviderModel) => favorites.includes(modelKey(provider.id, m.slug));
      return [...inGroup.filter(starred), ...inGroup.filter((m) => !starred(m))];
    });
  }, [provider, hidden, favorites, query]);
  const openPicker = (next: boolean) => {
    if (next) {
      setQuery("");
      setHighlight(
        Math.max(
          0,
          models.findIndex((m) => m.slug === provider.model),
        ),
      );
    }
    setOpen(next);
  };
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>("[data-highlighted]")
      ?.scrollIntoView({ block: "nearest" });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Re-run this DOM/reset lifecycle when its explicit trigger changes, even when the callback reads refs.
  }, [highlight]);
  const pick = (m: ProviderModel | undefined) => {
    if (!m) return;
    onPick(m.slug);
    setOpen(false);
  };
  const grouped = !query.trim();

  return (
    <Popover.Root open={open} onOpenChange={openPicker}>
      <HintTooltip label={`${provider.name}'s model`}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={`Model: ${label}`}
            data-chat-model-picker
            className={cn(COMPOSER_CONTROL, "min-w-0 max-w-44 shrink justify-between", className)}
          >
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {chevron ? <ComposerControlChevron /> : null}
          </button>
        </Popover.Trigger>
      </HintTooltip>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onCloseAutoFocus={(event) => closeFocus(event, returnFocus)}
          className="dropdown-glass z-[130] overflow-hidden rounded-lg text-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] outline-none dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]"
        >
          <div className="flex max-h-86.5 w-screen max-w-72 flex-col overflow-hidden">
            {provider.models.length > 8 ? (
              <div className="min-w-0 shrink-0 border-b border-foreground/10 px-3 py-2">
                <div className="relative">
                  <SearchIcon
                    aria-hidden
                    className="pointer-events-none absolute left-0 top-1.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setHighlight(0);
                    }}
                    placeholder="Search models..."
                    spellCheck={false}
                    aria-label="Search models"
                    className="h-7 w-full bg-transparent ps-6 font-sans text-sm leading-7 text-foreground outline-none placeholder:text-muted-foreground"
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        const delta = e.key === "ArrowDown" ? 1 : -1;
                        setHighlight((h) =>
                          models.length ? (h + delta + models.length) % models.length : 0,
                        );
                      } else if (e.key === "Enter") {
                        e.preventDefault();
                        pick(models[highlight]);
                      } else if (e.key !== "Escape") e.stopPropagation();
                    }}
                  />
                </div>
              </div>
            ) : null}
            <div
              ref={listRef}
              role="listbox"
              aria-label="Models"
              className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-1.5"
            >
              {models.map((m, index) => {
                const favorite = favorites.includes(key(m.slug));
                const group = m.subProvider ?? null;
                return (
                  <Fragment key={m.slug}>
                    {grouped && group && group !== (models[index - 1]?.subProvider ?? null) ? (
                      <div className="px-2 pb-1 pt-2 text-[13px] text-muted-foreground first:pt-1">
                        {group}
                      </div>
                    ) : null}
                    <div
                      role="option"
                      aria-selected={m.slug === provider.model}
                      data-highlighted={index === highlight || undefined}
                      onMouseMove={() => setHighlight(index)}
                      onClick={() => pick(m)}
                      className={cn(
                        "group relative flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm outline-none",
                        index === highlight && "bg-foreground/[0.06]",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {modelLabel(m.name)}
                      </span>
                      <button
                        type="button"
                        className={cn(
                          "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
                          !favorite &&
                            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                        )}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleFavorite(key(m.slug));
                        }}
                        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
                        title={favorite ? "Remove from favorites" : "Add to favorites"}
                      >
                        <StarIcon
                          className={cn("size-3.5", favorite && "fill-current text-yellow-500")}
                        />
                      </button>
                      <CheckIcon
                        aria-hidden
                        className={cn(
                          "size-4 shrink-0 text-foreground",
                          m.slug !== provider.model && "invisible",
                        )}
                      />
                    </div>
                  </Fragment>
                );
              })}
              {models.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                  No models found
                </div>
              ) : null}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DefaultBadge() {
  return (
    <span className="ms-1 inline-flex h-4.5 items-center rounded-sm border border-border px-1 align-middle text-2xs font-medium text-foreground/80">
      Default
    </span>
  );
}

export function currentChoice(option: ProviderModelOption, chosen: string): string | undefined {
  return (
    option.choices.find((c) => c.id === chosen)?.id ?? option.choices.find((c) => c.isDefault)?.id
  );
}

export function TraitsPicker({
  options,
  values,
  onChange,
  returnFocus,
  className,
}: {
  options: ProviderModelOption[];
  values: Partial<Record<ProviderModelOption["id"], string>>;
  onChange: (id: ProviderModelOption["id"], value: string) => void;
  returnFocus?: () => void;
  className?: string;
}) {
  if (options.length === 0) return null;
  const labels: string[] = [];
  let fast = false;
  for (const option of options) {
    const value = currentChoice(option, values[option.id] ?? "");
    const choice = option.choices.find((c) => c.id === value);
    if (option.id === "serviceTier") {
      fast = choice?.label === "Fast";
      continue;
    }
    if (choice) labels.push(choice.label);
  }
  const label = labels.join(" · ") || (fast ? "Fast" : "Standard");
  const accessible = fast ? `${label}, Fast mode on` : label;

  return (
    <DropdownMenu>
      <HintTooltip label={accessible}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={accessible}
            className={cn(
              COMPOSER_CONTROL,
              "min-w-0 max-w-40 shrink justify-start overflow-hidden sm:max-w-48",
              className,
            )}
          >
            <span className="flex w-full min-w-0 items-center gap-1.5">
              {fast ? (
                <ZapIcon
                  aria-hidden
                  data-composer-control-icon
                  className="size-4 shrink-0 fill-current text-foreground opacity-80"
                />
              ) : null}
              <span className="min-w-0 truncate">{label}</span>
              <ComposerControlChevron />
            </span>
          </button>
        </DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent
        align="start"
        side="bottom"
        className="min-w-44"
        onCloseAutoFocus={(event) => closeFocus(event, returnFocus)}
      >
        {options.map((option, index) => {
          const selected = currentChoice(option, values[option.id] ?? "");
          return (
            <div key={option.id}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              <div className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
                {option.label}
              </div>
              {option.choices.map((choice) => (
                <DropdownMenuItem
                  key={choice.id}
                  onSelect={() => onChange(option.id, choice.id)}
                  className={cn(choice.id === selected && "bg-foreground/[0.08] text-foreground")}
                >
                  <span className="flex w-full min-w-0 flex-col">
                    <span className="min-w-0 truncate">
                      {choice.label}
                      {choice.isDefault ? <DefaultBadge /> : null}
                    </span>
                    {choice.description ? (
                      <span className="max-w-56 text-pretty text-xs text-muted-foreground/80">
                        {choice.description}
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
              ))}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const RUNTIME_MODE_OPTIONS: {
  value: RuntimeMode;
  label: string;
  description: string;
  icon: typeof LockIcon;
}[] = [
  {
    value: "approval-required",
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: LockIcon,
  },
  {
    value: "auto-accept-edits",
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  {
    value: "full-access",
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: LockOpenIcon,
  },
];

export function RuntimeModePicker({
  value,
  onChange,
  returnFocus,
}: {
  value: RuntimeMode;
  onChange: (mode: RuntimeMode) => void;
  returnFocus?: () => void;
}) {
  const [open, setOpen] = useState(false);
  useCommandHandlers({ "composer.mode": () => setOpen((o) => !o) });
  const current = RUNTIME_MODE_OPTIONS.find((o) => o.value === value) ?? RUNTIME_MODE_OPTIONS[2];
  const Icon = current.icon;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <HintTooltip label={current.description} shortcut="composer.mode">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Runtime mode"
            className={cn(COMPOSER_CONTROL, "shrink-0")}
          >
            <Icon aria-hidden data-composer-control-icon className="size-4 shrink-0" />
            <span>{current.label}</span>
            <ComposerControlChevron />
          </button>
        </DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent
        align="start"
        side="bottom"
        onCloseAutoFocus={(event) => closeFocus(event, returnFocus)}
      >
        {RUNTIME_MODE_OPTIONS.map((option) => {
          const OptionIcon = option.icon;
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onChange(option.value)}
              className={cn(
                "min-w-64",
                option.value === value && "bg-foreground/[0.08] text-foreground",
              )}
            >
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  {option.label}
                </span>
                <span className="text-xs leading-4 text-muted-foreground">
                  {option.description}
                </span>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
