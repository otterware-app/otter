import { useState, type ReactNode } from "react";
import { GripVerticalIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { cn } from "./ui";
import {
  arrangeFolders,
  setSidebarLayout,
  useSidebarLayout,
  visibilityOf,
  type BadgeStyle,
  type FolderVisibility,
} from "./sidebar-layout";

export type SidebarFolder = { id: string; name: string; icon: ReactNode };

const VISIBILITY_LABELS: Record<FolderVisibility, string> = {
  always: "Always show",
  badged: "Show when badged",
  never: "Don't show",
};

const BADGE_GLYPHS: Record<BadgeStyle, ReactNode> = {
  count: <span className="w-3 text-center text-xs text-muted-foreground tabular-nums">1</span>,
  dot: (
    <span className="flex w-3 justify-center">
      <span className="size-1.5 rounded-full bg-primary" />
    </span>
  ),
};

export function CustomizeSidebarDialog({
  open,
  onOpenChange,
  folders,
  defaultOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** This mailbox's folders, in the sidebar's order. */
  folders: SidebarFolder[];
  /** Every folder id, mailboxes' others too, in the default order. */
  defaultOrder: readonly string[];
}) {
  const layout = useSidebarLayout();
  const [dragged, setDragged] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const endDrag = () => {
    setDragged(null);
    setDrop(null);
  };

  const move = (id: string, target: string, after: boolean) => {
    const order = arrangeFolders(defaultOrder, layout.order).filter((f) => f !== id);
    order.splice(order.indexOf(target) + (after ? 1 : 0), 0, id);
    setSidebarLayout({ ...layout, order });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>Customize sidebar</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5 overflow-y-auto px-6 pb-6">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
            <span className="text-sm font-medium">Default badge style</span>
            <Select
              value={layout.badge}
              onValueChange={(badge) => setSidebarLayout({ ...layout, badge: badge as BadgeStyle })}
            >
              <SelectTrigger variant="pill" aria-label="Default badge style">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {(["count", "dot"] as const).map((style) => (
                  <SelectItem key={style} value={style}>
                    <span className="flex items-center gap-2">
                      {BADGE_GLYPHS[style]}
                      {style === "count" ? "Count" : "Dot"}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Folders</h3>
            <div className="flex flex-col rounded-xl border border-border p-1.5">
              {folders.map((folder) => {
                const visibility = visibilityOf(layout, folder.id);
                const dropHere = drop?.id === folder.id ? drop : null;
                return (
                  <div
                    key={folder.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", folder.name);
                      setDragged(folder.id);
                    }}
                    onDragOver={(e) => {
                      if (!dragged) return;
                      e.preventDefault();
                      if (dragged === folder.id) {
                        setDrop(null);
                        return;
                      }
                      const box = e.currentTarget.getBoundingClientRect();
                      setDrop({ id: folder.id, after: e.clientY > box.top + box.height / 2 });
                    }}
                    onDrop={(e) => {
                      if (!dragged) return;
                      e.preventDefault();
                      if (drop) move(dragged, drop.id, drop.after);
                      endDrag();
                    }}
                    onDragEnd={endDrag}
                    className={cn(
                      "group relative flex h-10 items-center gap-2.5 rounded-lg ps-1 pe-1.5 text-sm",
                      dragged === folder.id && "opacity-40",
                    )}
                  >
                    {dropHere ? (
                      <span
                        aria-hidden
                        className={cn(
                          "pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-primary",
                          dropHere.after ? "-bottom-px" : "-top-px",
                        )}
                      />
                    ) : null}
                    <GripVerticalIcon
                      aria-hidden
                      className="size-4 shrink-0 cursor-grab text-muted-foreground/60 group-hover:text-muted-foreground"
                    />
                    <span
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2.5 [&>svg]:size-4 [&>svg]:shrink-0",
                        visibility === "never" && "text-muted-foreground/60",
                      )}
                    >
                      {folder.icon}
                      <span className="truncate">{folder.name}</span>
                    </span>
                    <Select
                      value={visibility}
                      onValueChange={(value) =>
                        setSidebarLayout({
                          ...layout,
                          visibility: {
                            ...layout.visibility,
                            [folder.id]: value as FolderVisibility,
                          },
                        })
                      }
                    >
                      <SelectTrigger
                        variant="pill"
                        aria-label={`${folder.name} in the sidebar`}
                        className="border-transparent"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        {(Object.keys(VISIBILITY_LABELS) as FolderVisibility[]).map((value) => (
                          <SelectItem key={value} value={value}>
                            {VISIBILITY_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
