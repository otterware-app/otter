import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRightIcon,
  EyeOffIcon,
  MoreVerticalIcon,
  PinIcon,
  PinOffIcon,
  PuzzleIcon,
  Settings2Icon,
} from "lucide-react";

import { ipc } from "~/lib/ipc";
import { mailApi } from "../mail/api";
import { CHROME_WEB_STORE_URL, openTab, setExtensionsButton, setPinned, useBrowser } from "./store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuTrigger,
} from "@otter/ui/components/dropdown-menu";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { IconButton, buttonVariants } from "@otter/ui/components/button";
import { cn } from "@otter/ui/lib/utils";

type ExtensionAction = {
  id: string;
  name: string;
  title: string;
  icon: string | null;
  badgeText: string;
  badgeBackgroundColor: string;
  badgeTextColor: string;
  hasPopup: boolean;
  enabled: boolean;
  optionsUrl: string | null;
};

const ACTIONS_KEY = ["browser-extension-actions"];

export function useExtensionActions(): ExtensionAction[] {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ACTIONS_KEY,
    queryFn: () => ipc<ExtensionAction[]>("browser:extensionActions"),
  });
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ACTIONS_KEY });
    const offs = [
      window.desktopBridge.on("browser:extensionActionsChanged", refresh),
      window.desktopBridge.on("browser:extensionsChanged", refresh),
    ];
    return () => offs.forEach((off) => off());
  }, [queryClient]);
  return query.data ?? [];
}

function run(id: string, anchor: Element | null) {
  const rect = anchor?.getBoundingClientRect();
  if (!rect) return;
  void ipc("browser:runAction", {
    id,
    anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  });
}

function ActionIcon({ action, className }: { action: ExtensionAction; className?: string }) {
  return (
    <span className={cn("relative flex size-4 shrink-0 items-center justify-center", className)}>
      {action.icon ? (
        <img src={action.icon} alt="" className={cn("size-4", !action.enabled && "opacity-40")} />
      ) : (
        <PuzzleIcon className="size-4 text-muted-foreground" />
      )}
      {action.badgeText ? (
        <span
          className="absolute -bottom-1.5 -right-2 min-w-3.5 rounded-sm px-0.5 text-center text-4xs font-semibold leading-[13px]"
          style={{ background: action.badgeBackgroundColor, color: action.badgeTextColor }}
        >
          {action.badgeText.slice(0, 4)}
        </span>
      ) : null}
    </span>
  );
}

export function ExtensionToolbar() {
  const actions = useExtensionActions();
  const pinned = useBrowser((s) => s.pinned);
  const showButton = useBrowser((s) => s.extensionsButton);
  const menuButton = useRef<HTMLButtonElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const onToolbar = pinned
    .map((id) => actions.find((action) => action.id === id))
    .filter((action): action is ExtensionAction => action !== undefined);

  useEffect(
    () =>
      window.desktopBridge.on("browser:openExtensionPopup", (params) => {
        const { id } = params as { id: string };
        run(id, buttons.current.get(id) ?? menuButton.current);
      }),
    [],
  );

  if (onToolbar.length === 0 && (!showButton || actions.length === 0)) return null;
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-foreground/[0.06] p-0.5">
      {onToolbar.map((action) => (
        <HintTooltip key={action.id} label={action.title} side="bottom">
          <IconButton
            ref={(node) => {
              if (node) buttons.current.set(action.id, node);
              else buttons.current.delete(action.id);
            }}
            label={action.title}
            className="rounded-full"
            onClick={(e) => run(action.id, e.currentTarget)}
          >
            <ActionIcon action={action} />
          </IconButton>
        </HintTooltip>
      ))}
      {showButton && actions.length > 0 ? (
        <DropdownMenu>
          <HintTooltip label="Extensions" side="bottom">
            <DropdownMenuTrigger
              render={<IconButton ref={menuButton} label="Extensions" className="rounded-full" />}
            >
              <PuzzleIcon className="size-4" />
            </DropdownMenuTrigger>
          </HintTooltip>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Extensions ({actions.length})</DropdownMenuLabel>
            {actions.map((action) => {
              const isPinned = pinned.includes(action.id);
              return (
                <div key={action.id} className="flex items-center gap-0.5">
                  <DropdownMenuItem
                    className="min-w-0 flex-1"
                    icon={<ActionIcon action={action} />}
                    onClick={() => run(action.id, menuButton.current)}
                  >
                    {action.name}
                  </DropdownMenuItem>
                  <HintTooltip label={isPinned ? "Unpin" : "Pin to toolbar"} side="bottom">
                    <IconButton
                      label={isPinned ? "Unpin" : "Pin to toolbar"}
                      className={cn(isPinned && "text-foreground")}
                      onClick={() => setPinned(action.id, !isPinned)}
                    >
                      <PinIcon className={cn("size-4", isPinned && "fill-current")} />
                    </IconButton>
                  </HintTooltip>
                  <DropdownMenuSub
                    label={`More for ${action.name}`}
                    trigger={
                      <div
                        className={cn(
                          buttonVariants({ variant: "ghost-muted", size: "icon-sm" }),
                          "data-popup-open:bg-accent-surface data-popup-open:text-foreground",
                        )}
                      >
                        <MoreVerticalIcon className="size-4" />
                      </div>
                    }
                  >
                    {action.optionsUrl ? (
                      <DropdownMenuItem
                        icon={<Settings2Icon className="size-4" />}
                        onClick={() => openTab(action.optionsUrl!)}
                      >
                        Options
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      icon={
                        isPinned ? (
                          <PinOffIcon className="size-4" />
                        ) : (
                          <PinIcon className="size-4" />
                        )
                      }
                      onClick={() => setPinned(action.id, !isPinned)}
                    >
                      {isPinned ? "Unpin" : "Pin to toolbar"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={<PuzzleIcon className="size-4" />}
                      onClick={() => void mailApi.openSettings({ pane: "browser" })}
                    >
                      Manage extension
                    </DropdownMenuItem>
                  </DropdownMenuSub>
                </div>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void mailApi.openSettings({ pane: "browser" })}>
              <span className="flex items-center justify-between gap-2">
                Manage extensions
                <ArrowUpRightIcon className="size-4 text-muted-foreground" />
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openTab(CHROME_WEB_STORE_URL)}>
              <span className="flex items-center justify-between gap-2">
                Visit Web Store
                <ArrowUpRightIcon className="size-4 text-muted-foreground" />
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setExtensionsButton(false)}>
              <span className="flex items-center justify-between gap-2">
                Hide from toolbar
                <EyeOffIcon className="size-4 text-muted-foreground" />
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
