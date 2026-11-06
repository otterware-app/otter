import type { HostEffect, HostRequestParams, HostRequestResults } from "@otter-mail/contracts/rpc";

export type { GoogleSignInResult } from "@otter-mail/contracts/rpc";
export { GMAIL_SIGN_IN_CANCELLED as SIGN_IN_CANCELLED } from "@otter-mail/contracts/relay";

/** Core's requests the page answers (core's RPC protocol, `@otter-mail/contracts/rpc`). */
type PageRequestKind =
  | "todoistSignIn"
  | "pickFiles"
  | "googleSignIn"
  | "outlookSignIn"
  | "detectLanguage"
  | "translate";

export type PageRequests = {
  [K in PageRequestKind]: { params: HostRequestParams<K>; result: HostRequestResults[K] };
};

export type PageEffect = Extract<HostEffect, { _tag: "notify" | "badge" | "download" | "open" }>;
