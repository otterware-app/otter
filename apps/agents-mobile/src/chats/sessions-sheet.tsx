import { SheetPlaceholder } from "../frame/placeholder.tsx";

/** "On your agents" (ChatsScreen.swift's SessionsSheet): sessions the agents keep that aren't chats here. */
export function SessionsSheet() {
  return (
    <SheetPlaceholder
      title="On your agents"
      line="Chats started in an agent's own app, to go on with here."
      icon="bubble.left.and.bubble.right"
    />
  );
}
