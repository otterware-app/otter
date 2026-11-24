import { cover, sheet } from "../../../frame/stack-options.ts";
import { TabStack } from "../../../frame/tab-stack.tsx";

export const unstable_settings = { anchor: "index" };

export default function ChatsStack() {
  return (
    <TabStack
      tab="chats"
      root="index"
      presented={{
        sessions: sheet(),
        "agents/[id]/details": sheet([0.5, 1]),
        "agents/[id]/model": sheet(),
        "agents/[id]/queue": sheet([0.65, 1]),
        "agents/[id]/browser": cover,
        "agents/[id]/talk": cover,
      }}
    />
  );
}
