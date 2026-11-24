import { useLatest } from "../use-latest";
import { useThemeDesign } from "../theme/apply-theme";
import { useAppLayout } from "../theme/interface-settings";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CableIcon,
  CalendarDaysIcon,
  CircleHelpIcon,
  CircleUserRoundIcon,
  GlobeIcon,
  KeyboardIcon,
  MailCheckIcon,
  MessageSquareIcon,
  PaletteIcon,
  PlugIcon,
  PuzzleIcon,
  ScrollTextIcon,
  SearchIcon,
  Settings2Icon,
  XIcon,
} from "lucide-react";
import { AgentIcon } from "../agent/agent-icon";
import { changelogUrl } from "@otter/shared/changelog";
import { openLink } from "../browser/store";
import { ScrollArea } from "@otter/ui/components/scroll-area";
import { mailApi, type SettingsPane } from "../mail/api";
import { features } from "../features";
import { useCommandHandlers } from "../keybindings/dispatch";
import {
  PLUG_IN_PANES,
  searchSettings,
  SETTINGS_SECTION_LABELS,
  type SettingsSearchItem,
} from "./settings-search";
import { requestProblemReport } from "../support/report-problem";
import { hasIntegrations } from "../extensions/registry";
import { PLACE } from "../place-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@otter/ui/components/dropdown-menu";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { IconButton } from "@otter/ui/components/button";
import { cn } from "@otter/ui/lib/utils";

const SETTINGS_SECTION_ICONS: Readonly<
  Record<SettingsPane, ComponentType<{ className?: string }>>
> = {
  general: Settings2Icon,
  otter: CircleUserRoundIcon,
  appearance: PaletteIcon,
  keybindings: KeyboardIcon,
  accounts: CableIcon,
  calendar: CalendarDaysIcon,
  browser: GlobeIcon,
  agents: AgentIcon,
  integrations: PlugIcon,
  features: PuzzleIcon,
};

const SETTINGS_SECTIONS = (Object.keys(SETTINGS_SECTION_LABELS) as SettingsPane[])
  .filter((id) => id !== "browser" || features.browser)
  .filter((id) => id !== "integrations" || hasIntegrations())
  .map((id) => ({
    id,
    label: SETTINGS_SECTION_LABELS[id],
    icon: SETTINGS_SECTION_ICONS[id],
  }));

const ROW =
  "flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-(--sidebar-row-content-inset) text-left text-body font-medium outline-none focus-visible:ring-2 focus-visible:ring-focus-ring active:bg-sidebar-row-active [&>svg]:size-3.5 [&>svg]:mx-px [&>svg]:shrink-0";

const ROW_IDLE =
  "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground [&>svg]:text-sidebar-muted-foreground hover:[&>svg]:text-sidebar-foreground";

const LOOKS = {
  sidebar: {
    scroll:
      "scroll-fade-y px-(--sidebar-content-inset) pb-8 pt-3 web:pt-[calc(var(--workspace-topbar-height)/2-1rem)]",
    search:
      "mb-2 flex h-9 shrink-0 items-center gap-2 rounded-pill bg-foreground/[0.06] ps-3 pe-2.5 transition-colors focus-within:bg-foreground/[0.08]",
    row: ROW,
    idle: ROW_IDLE,
    selected: "bg-sidebar-row-selected text-sidebar-foreground [&>svg]:text-sidebar-foreground",
    active: "bg-sidebar-row-hover text-sidebar-foreground [&>svg]:text-sidebar-foreground",
    footer: "px-(--sidebar-content-inset) pt-1 pb-(--sidebar-content-inset)",
    input: "text-sidebar-foreground placeholder:text-sidebar-muted-foreground",
    muted: "text-sidebar-muted-foreground",
  },
  // The Margin layout's: a quiet list beside the page, an ink rule on the current pane.
  margin: {
    scroll: "pt-14 pb-8 ps-6",
    search:
      "mb-4 flex h-8 shrink-0 items-center gap-2 rounded-sm border border-border ps-2.5 pe-2 transition-colors focus-within:border-foreground-40",
    row: "flex w-full cursor-pointer items-center gap-2 border-l py-1.5 ps-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus-ring [&>svg]:hidden",
    idle: "border-border text-muted-foreground hover:text-foreground",
    selected: "border-l-2 border-foreground ps-[11px] font-medium text-foreground",
    active: "border-foreground text-foreground",
    footer: "ps-6 pb-4",
    input: "text-foreground placeholder:text-muted-foreground",
    muted: "text-muted-foreground",
  },
};

export function SettingsNav({
  pane,
  onSelect,
  onBack,
  look = "sidebar",
}: {
  pane: SettingsPane;
  onSelect: (pane: SettingsPane, target?: string, item?: string) => void;
  onBack: () => void;
  look?: keyof typeof LOOKS;
}) {
  const styles = LOOKS[look];
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const design = useThemeDesign();
  const layout = useAppLayout();
  // Rows Appearance hides: Margin's overlays are always solid; its layout has one pane at its own measure.
  const results = useMemo(
    () =>
      searchSettings(query).filter(
        (item) =>
          !(item.id === "glass-opacity" && design === "margin") &&
          !((item.id === "reading-width" || item.id === "mail-layout") && layout === "margin"),
      ),
    [query, design, layout],
  );
  const isSearching = query.trim().length > 0;
  const hasResults = results.length > 0;

  useCommandHandlers({
    "search.focus": () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
  });

  useEffect(() => {
    const result = results[activeResultIndex];
    if (!result) return;
    document
      .getElementById(`settings-search-result-${result.id}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeResultIndex, results]);

  const clearSearch = useCallback(() => {
    setQuery("");
    setActiveResultIndex(0);
  }, []);
  const openResult = (item: SettingsSearchItem) => {
    console.log("[SettingsNav:openResult]", { id: item.id });
    clearSearch();
    onSelect(item.pane, item.targetId ?? item.id, item.item);
  };
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && isSearching) {
      event.preventDefault();
      clearSearch();
      return;
    }
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveResultIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveResultIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = results[activeResultIndex];
      if (result) openResult(result);
    }
  };

  return (
    <>
      {/* In a browser tab there's no title band above (SidebarTitle): the
          heading centers in its place, after the sidebar toggle. */}
      <ScrollArea
        className="flex-1"
        viewportClassName={styles.scroll}
        contentClassName={cn("flex flex-col", look === "sidebar" && "gap-0.5")}
      >
        {look === "sidebar" ? (
          <h2 className="mb-1 flex h-8 items-center pe-(--sidebar-row-content-inset) ps-(--sidebar-heading-inset) text-base font-semibold text-sidebar-foreground">
            Settings
          </h2>
        ) : null}
        <div className={styles.search}>
          <SearchIcon className={cn("size-4 shrink-0", styles.muted)} />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setActiveResultIndex(0);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search"
            spellCheck={false}
            aria-label="Search settings"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isSearching && hasResults}
            aria-controls={isSearching && hasResults ? "settings-search-results" : undefined}
            aria-activedescendant={
              isSearching && results[activeResultIndex]
                ? `settings-search-result-${results[activeResultIndex].id}`
                : undefined
            }
            className={cn(
              "h-full min-w-0 flex-1 bg-transparent text-sm outline-none",
              styles.input,
            )}
          />
          {isSearching ? (
            <button
              type="button"
              aria-label="Clear settings search"
              onClick={() => {
                clearSearch();
                searchInputRef.current?.focus();
              }}
              className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full bg-sidebar-muted-foreground text-canvas outline-none hover:bg-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <XIcon className="size-2.5" strokeWidth={3} />
            </button>
          ) : null}
        </div>
        {isSearching ? (
          hasResults ? (
            <div
              id="settings-search-results"
              role="listbox"
              aria-label="Settings search results"
              className={cn("flex flex-col", look === "sidebar" && "gap-0.5")}
            >
              {results.map((item, index) => {
                const Icon = SETTINGS_SECTION_ICONS[item.pane];
                const active = index === activeResultIndex;
                return (
                  <button
                    key={item.id}
                    id={`settings-search-result-${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    tabIndex={-1}
                    onMouseMove={() => setActiveResultIndex(index)}
                    onClick={() => openResult(item)}
                    {...PLACE}
                    className={cn(
                      styles.row,
                      "h-auto min-h-11 items-start py-1.5 [&>svg]:mt-0.5",
                      active ? styles.active : styles.idle,
                    )}
                  >
                    <Icon />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.title}</span>
                      <span className="block truncate text-xs text-sidebar-muted-foreground">
                        {SETTINGS_SECTION_LABELS[item.pane]}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p
              role="status"
              className="px-(--sidebar-row-content-inset) py-6 text-center text-xs text-sidebar-muted-foreground"
            >
              No settings found
            </p>
          )
        ) : (
          SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon;
            const active = section.id === pane;
            const heading =
              section.id === PLUG_IN_PANES[0] ? (
                <div aria-hidden className={look === "sidebar" ? "h-4" : "h-3"} />
              ) : null;
            return (
              <Fragment key={section.id}>
                {heading}
                <button
                  type="button"
                  onClick={() => onSelect(section.id)}
                  {...PLACE}
                  aria-current={active ? "page" : undefined}
                  className={cn(styles.row, active ? styles.selected : styles.idle)}
                >
                  <Icon />
                  <span className="truncate">{section.label}</span>
                </button>
              </Fragment>
            );
          })
        )}
      </ScrollArea>
      <div className={cn("flex shrink-0 flex-col gap-0.5", styles.footer)}>
        {features.defaultMailApp ? (
          <DefaultMailRow className={cn(styles.row, styles.idle)} />
        ) : null}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onBack}
            className={cn(styles.row, styles.idle, "min-w-0 flex-1")}
          >
            <ArrowLeftIcon />
            <span className="truncate">Back</span>
          </button>
          <HelpMenu />
        </div>
      </div>
    </>
  );
}

function HelpMenu() {
  return (
    <DropdownMenu>
      <HintTooltip label="Help">
        <DropdownMenuTrigger render={<IconButton label="Help" />}>
          <CircleHelpIcon className="size-4" />
        </DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent side="top">
        <DropdownMenuItem icon={<MessageSquareIcon />} onClick={requestProblemReport}>
          Send feedback
        </DropdownMenuItem>
        <DropdownMenuItem icon={<ScrollTextIcon />} onClick={() => openLink(changelogUrl())}>
          Changelog
          <ArrowUpRightIcon className="ms-1 inline size-3.5 align-[-2px]" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DefaultMailRow({ className }: { className: string }) {
  const [isDefault, setIsDefault] = useState<boolean | null>(null);
  const refresh = async () => {
    try {
      setIsDefault((await mailApi.getDefaultMailStatus()).isDefault);
    } catch (err) {
      console.log("[SettingsNav:defaultMailStatus] failed", { error: String(err) });
    }
  };
  const refreshForEffect = useLatest(refresh);
  useEffect(() => {
    void refreshForEffect.current();
  }, [refreshForEffect]);
  if (isDefault !== false) return null;
  return (
    <HintTooltip label="Use Otter for email links">
      <button
        type="button"
        onClick={async () => {
          console.log("[SettingsNav:setDefaultMailApp]");
          try {
            await mailApi.setDefaultMailApp();
          } catch (err) {
            console.log("[SettingsNav:setDefaultMailApp] failed", { error: String(err) });
          }
          void refresh();
        }}
        className={className}
      >
        <MailCheckIcon />
        <span className="truncate">Set as default mail app</span>
      </button>
    </HintTooltip>
  );
}
