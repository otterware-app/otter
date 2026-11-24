import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Undo2Icon } from "lucide-react";
import { IconButton } from "./button";
import { ScrollArea } from "./scroll-area";
import { cn } from "../lib/utils";
import { HintTooltip } from "./tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

interface SettingsSearchTargetContextValue {
  readonly targetId: string | null;
  readonly onTargetHandled: () => void;
}

const noop = () => undefined;
const SettingsSearchTargetContext = createContext<SettingsSearchTargetContextValue>({
  targetId: null,
  onTargetHandled: noop,
});

export function SettingsSearchTargetProvider({
  targetId,
  onTargetHandled,
  children,
}: {
  targetId: string | null;
  onTargetHandled: () => void;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ targetId, onTargetHandled }), [onTargetHandled, targetId]);
  return <SettingsSearchTargetContext value={value}>{children}</SettingsSearchTargetContext>;
}

function scrollAndFocusSettingsTarget(target: HTMLElement): void {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: target.offsetHeight > window.innerHeight / 2 ? "start" : "center",
  });
  target.focus({ preventScroll: true });
  target.classList.remove("settings-search-target-pulse");
  if (prefersReducedMotion) return;
  void target.offsetWidth;
  target.classList.add("settings-search-target-pulse");
  // The class also suppresses the focus outline (the pulse is the destination
  // indicator), so drop it once the element is no longer the destination.
  target.addEventListener("blur", () => target.classList.remove("settings-search-target-pulse"), {
    once: true,
  });
}

export function useSettingsSearchTarget<T extends HTMLElement>(id: string | undefined) {
  const { targetId, onTargetHandled } = useContext(SettingsSearchTargetContext);
  const isSearchTarget = id !== undefined && id === targetId;
  return useCallback(
    (target: T | null) => {
      if (target && isSearchTarget) {
        scrollAndFocusSettingsTarget(target);
        onTargetHandled();
      }
    },
    [isSearchTarget, onTargetHandled],
  );
}

export function SettingsSearchTarget({ children, ...props }: ComponentProps<"div">) {
  const targetRef = useSettingsSearchTarget<HTMLDivElement>(props.id);
  return (
    <div {...props} ref={targetRef} tabIndex={props.id ? -1 : props.tabIndex}>
      {children}
    </div>
  );
}

export function SettingsGroup({
  variant = "grouped",
  divided = true,
  className,
  ...props
}: ComponentProps<"div"> & { variant?: "grouped" | "plain"; divided?: boolean }) {
  const targetRef = useSettingsSearchTarget<HTMLDivElement>(props.id);
  return (
    <div
      {...props}
      ref={targetRef}
      tabIndex={props.id ? -1 : props.tabIndex}
      data-slot={variant === "grouped" ? "settings-group" : undefined}
      className={cn(
        "relative overflow-visible text-foreground",
        variant === "grouped" ? "rounded-xl border border-border/60 bg-card" : "space-y-1",
        // The Margin layout: rows on hairlines, no card.
        variant === "grouped" &&
          "layout-margin:rounded-none layout-margin:border-x-0 layout-margin:border-t-0 layout-margin:border-border layout-margin:bg-transparent layout-margin:[&>*+*]:border-border",
        variant === "grouped" && divided && "[&>*+*]:border-t [&>*+*]:border-border/40",
        variant === "grouped" &&
          "[&>*:first-child]:rounded-t-[calc(var(--radius-xl)-1px)] [&>*:last-child]:rounded-b-[calc(var(--radius-xl)-1px)]",
        className,
      )}
    />
  );
}

export function SettingsSectionHeader({
  title,
  description,
  icon,
  action,
  muted,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-7 items-center justify-between gap-4 px-[17px]",
        muted ? "mb-1" : "mb-3",
        // The Margin layout's SectionHead: a label on an ink rule.
        "layout-margin:mb-0 layout-margin:border-t layout-margin:border-foreground layout-margin:px-0 layout-margin:py-1.5",
      )}
    >
      <div className="min-w-0">
        <h2
          data-slot="settings-section-title"
          className={cn(
            "flex items-center gap-2 text-sm",
            muted ? "text-muted-foreground" : "font-medium text-foreground",
            "layout-margin:font-mono layout-margin:text-2xs layout-margin:font-normal layout-margin:tracking-widest layout-margin:text-foreground layout-margin:uppercase",
          )}
        >
          {icon}
          {title}
        </h2>
        {description ? (
          <p
            data-slot="settings-section-description"
            className="mt-0.5 text-body leading-[18px] text-muted-foreground"
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  icon,
  headerAction,
  variant = "grouped",
  margin,
  children,
  className,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  headerAction?: ReactNode;
  variant?: "grouped" | "plain";
  /** The Margin layout's: help or a preview beside the section, under its description. */
  margin?: ReactNode;
  children: ReactNode;
}) {
  const targetRef = useSettingsSearchTarget<HTMLElement>(props.id);
  return (
    <section
      {...props}
      ref={targetRef}
      tabIndex={props.id ? -1 : props.tabIndex}
      className={cn(
        description || margin
          ? "layout-margin:relative layout-margin:[&_[data-slot=settings-section-description]]:hidden"
          : undefined,
        className,
      )}
    >
      <SettingsSectionHeader
        title={title}
        description={description}
        icon={icon}
        action={headerAction}
      />
      {variant === "grouped" ? <SettingsGroup>{children}</SettingsGroup> : children}
      {description || margin ? (
        <aside
          data-slot="settings-section-margin"
          className="hidden flex-col gap-4 pt-4 text-body text-muted-foreground layout-margin:flex @min-[64rem]/settings-page:absolute @min-[64rem]/settings-page:top-0 @min-[64rem]/settings-page:left-[calc(100%+2.5rem)] @min-[64rem]/settings-page:w-60 @min-[64rem]/settings-page:pt-9"
        >
          {description ? <p>{description}</p> : null}
          {margin}
        </aside>
      ) : null}
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  status,
  control,
  resetAction,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  control?: ReactNode;
  resetAction?: ReactNode;
  children?: ReactNode;
}) {
  const targetRef = useSettingsSearchTarget<HTMLDivElement>(props.id);
  return (
    <div
      {...props}
      ref={targetRef}
      tabIndex={props.id ? -1 : props.tabIndex}
      data-slot="settings-row"
      className={cn(
        "@container/settings-row px-4",
        children ? "pt-2.5 pb-1" : "py-2.5",
        "layout-margin:px-0 layout-margin:py-3.5",
        className,
      )}
    >
      <div className="flex min-h-9 flex-col gap-3 @min-[30rem]/settings-row:flex-row @min-[30rem]/settings-row:items-center @min-[30rem]/settings-row:gap-8">
        <div className="min-w-0 flex-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="text-sm font-normal text-foreground layout-margin:font-medium">
              {title}
            </h3>
            {resetAction ? (
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                {resetAction}
              </span>
            ) : null}
          </div>
          {description ? (
            <p className="mt-0.5 max-w-[30rem] text-body leading-[18px] text-muted-foreground">
              {description}
            </p>
          ) : null}
          {status ? <div className="mt-1 text-xs text-muted-foreground">{status}</div> : null}
        </div>
        {control ? (
          <div
            data-slot="settings-row-control"
            className="flex min-w-0 shrink-0 items-center gap-2 @min-[30rem]/settings-row:justify-end"
          >
            {control}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SettingsSelect({
  value,
  onValueChange,
  options,
  placeholder,
  ariaLabel,
  className,
  disabled,
}: {
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      items={options}
      value={value ?? ""}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger variant="pill" aria-label={ariaLabel} className={className}>
        <SelectValue placeholder={placeholder ?? "Loading…"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SettingsResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <HintTooltip label="Reset to default">
      <IconButton
        label={`Reset ${label} to default`}
        size="icon-xs"
        className="size-5 rounded-md"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
      >
        <Undo2Icon className="size-3" />
      </IconButton>
    </HintTooltip>
  );
}

export function SettingsPageContainer({
  title,
  description,
  lead,
  action,
  searchId,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  /** The Margin layout's line under the title, for a page without a description. */
  lead?: ReactNode;
  action?: ReactNode;
  searchId?: string;
}) {
  const headerRef = useSettingsSearchTarget<HTMLElement>(searchId);
  return (
    <ScrollArea
      className="flex-1"
      viewportClassName="@container/settings-page"
      data-settings-page-scroll=""
    >
      <div
        {...props}
        className={cn(
          "mx-auto w-full max-w-[47rem] space-y-10 px-6 pb-20 pt-14",
          // The Margin layout: one column at the reading measure, the sections' margins beside it.
          "layout-margin:max-w-[calc(var(--reading-width)+3rem)] layout-margin:@min-[64rem]/settings-page:max-w-[calc(var(--reading-width)+20.5rem)] layout-margin:@min-[64rem]/settings-page:pr-[19rem]",
          className,
        )}
      >
        {title ? (
          <header
            id={searchId}
            ref={headerRef}
            tabIndex={searchId ? -1 : undefined}
            className="flex items-end justify-between gap-4 px-[17px] outline-none layout-margin:px-0"
          >
            <div className="min-w-0">
              <h1
                data-slot="settings-page-title"
                className="text-2xl font-medium leading-8 tracking-[-0.01em] text-foreground layout-margin:font-reading layout-margin:text-5xl layout-margin:leading-tight layout-margin:font-normal layout-margin:tracking-tight"
              >
                {title}
              </h1>
              {description ? (
                <p
                  data-slot="settings-page-description"
                  className="mt-1.5 text-sm text-muted-foreground layout-margin:mt-1 layout-margin:font-reading layout-margin:text-xl"
                >
                  {description}
                </p>
              ) : lead ? (
                <p
                  data-slot="settings-page-description"
                  className="mt-1 hidden font-reading text-xl text-muted-foreground layout-margin:block"
                >
                  {lead}
                </p>
              ) : null}
            </div>
            {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
          </header>
        ) : null}
        {children}
      </div>
    </ScrollArea>
  );
}
