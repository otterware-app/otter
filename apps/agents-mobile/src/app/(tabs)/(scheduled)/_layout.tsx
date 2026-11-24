import { sheet } from "../../../frame/stack-options.ts";
import { TabStack } from "../../../frame/tab-stack.tsx";

export const unstable_settings = { anchor: "scheduled/index" };

export default function ScheduledStack() {
  return (
    <TabStack
      tab="scheduled"
      root="scheduled/index"
      presented={{ "scheduled/new": sheet(), "scheduled/[id]/edit": sheet() }}
    />
  );
}
