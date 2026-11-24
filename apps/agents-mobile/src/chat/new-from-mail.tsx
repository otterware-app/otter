import { Placeholder } from "../frame/placeholder.tsx";

/**
 * Otter Mail's Send to agent: `<bundle id>://new?mail=<json>` (apps/ios's MailContext.swift)
 * opens a new chat with the mail attached. Reserved: it lands here for now.
 */
export function NewFromMail() {
  return (
    <Placeholder
      title="New chat"
      line="A new chat with the mail from Otter Mail attached goes here."
      icon="envelope"
    />
  );
}
