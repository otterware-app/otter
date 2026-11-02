/**
 * Connections (docs/connections.md): each sign-in to an outside service and what it provides.
 * Derived from the mailboxes and their providers; nothing here is stored or synced.
 */

/** What a connection provides. `calendar` is the service's calendars, not one calendar. */
export type ResourceKind = "mail" | "calendar";

/**
 * Something a resource can't do because the sign-in wasn't given permission for it: allowing it
 * signs in again for that address. Copy names the consequence, never the scope.
 */
export type AccessNeed = {
  /** Stable, for code: what can't be done. */
  operation: "listCalendars" | "saveSignature";
  /** What the user sees happening: "Only your main calendar is showing". */
  consequence: string;
  /** The Allow button: "Allow calendar access". */
  allow: string;
};

export type ConnectionResource = {
  kind: ResourceKind;
  needs: AccessNeed[];
};

export type ConnectionSummary = {
  /** The mailbox's id (its address) for the built-in connections. */
  id: string;
  provider: "google" | "microsoft" | "imap";
  /** Who it signed in as. */
  label: string;
  signedIn: boolean;
  resources: ConnectionResource[];
};
