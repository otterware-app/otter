export type ResourceKind = "mail" | "calendar";

export type AccessNeed = {
  operation: "listCalendars" | "saveSignature";
  consequence: string;
  allow: string;
};

export type ConnectionResource = {
  kind: ResourceKind;
  needs: AccessNeed[];
};

export type ConnectionSummary = {
  id: string;
  provider: "google" | "microsoft" | "imap";
  label: string;
  signedIn: boolean;
  resources: ConnectionResource[];
};
