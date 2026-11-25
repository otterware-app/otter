import { useEffect, useState } from "react";
import { XIcon } from "lucide-react";

import { Button, IconButton } from "@otter/ui/components/button";
import { Text } from "@otter/ui/components/text";
import { desktopBridge } from "./bridge";

type Request = { id: string; webContentsId: number; site: string; permissions: string[] };

const WANTS: Record<string, string> = {
  camera: "use your camera",
  microphone: "use your microphone",
  location: "know your location",
  notifications: "show notifications",
  clipboard: "see text and images you copy",
};

function wants(permissions: string[]): string {
  if (permissions.includes("camera") && permissions.includes("microphone")) {
    return "use your camera and microphone";
  }
  return permissions.map((p) => WANTS[p] ?? p).join(" and ");
}

/** What a page in this tab asks to use, Chrome's way: under the address bar, over the page. */
export function PermissionPrompt({ pageId }: { pageId: number | null }) {
  const [requests, setRequests] = useState<Request[]>([]);
  useEffect(() => {
    const offs = [
      desktopBridge().on("browser:permissionRequest", (params) => {
        const request = params as Request;
        if (request.webContentsId === pageId) setRequests((all) => [...all, request]);
      }),
      desktopBridge().on("browser:permissionAnswered", (params) => {
        const { id } = params as { id: string };
        setRequests((all) => all.filter((r) => r.id !== id));
      }),
    ];
    if (pageId !== null) {
      void desktopBridge()
        .invoke<Request[]>("browser:pendingPermissions", pageId)
        .then((waiting) =>
          setRequests((all) => [...all, ...waiting.filter((w) => !all.some((r) => r.id === w.id))]),
        );
    }
    return () => offs.forEach((off) => off());
  }, [pageId]);
  const request = requests[0];
  if (!request) return null;
  const answer = (allow: boolean, remember: boolean) =>
    void desktopBridge().invoke("browser:answerPermission", { id: request.id, allow, remember });
  return (
    <div className="absolute top-3 left-3 z-20 flex w-80 max-w-[calc(100%-1.5rem)] flex-col gap-3 rounded-xl border border-border bg-popover p-4 shadow-lg">
      <div className="flex items-start gap-2">
        <Text className="min-w-0 flex-1">
          <span className="font-medium">{request.site}</span> wants to {wants(request.permissions)}
        </Text>
        <IconButton
          label="Dismiss"
          size="icon"
          className="-mt-1 -mr-1 shrink-0"
          onClick={() => answer(false, false)}
        >
          <XIcon className="size-4" />
        </IconButton>
      </div>
      <div className="flex flex-col gap-1.5">
        <Button size="sm" variant="primary" onClick={() => answer(true, true)}>
          Allow while visiting the site
        </Button>
        <Button size="sm" variant="secondary" onClick={() => answer(true, false)}>
          Allow this time
        </Button>
        <Button size="sm" variant="secondary" onClick={() => answer(false, true)}>
          Never allow
        </Button>
      </div>
    </div>
  );
}
