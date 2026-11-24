import { OUTLOOK_CAPABILITIES } from "@otter/contracts";

import { OUTLOOK_SIGNED_OUT_MESSAGE } from "../../microsoft.ts";
import { platform } from "../../platform.ts";
import * as mailStore from "../../services/mail-store.ts";
import type { MailProvider } from "../provider.ts";
import * as calendar from "./calendar.ts";
import { forgetFolders, labelsOf, readMailbox } from "./folders.ts";
import { describeError, errorKind, forgetGraph, isCoolingDown, tier } from "./graph.ts";
import * as messages from "./messages.ts";
import { readProfile } from "./profile.ts";
import * as search from "./search.ts";
import * as send from "./send.ts";
import { backfillOutlook, forgetOutlookSync, needsBackfill, syncOutlook } from "./sync.ts";
import { endSubscription, renewSubscription } from "./watch.ts";
import * as writes from "./writes.ts";

export const outlookProvider: MailProvider = {
  kind: "outlook",
  capabilities: OUTLOOK_CAPABILITIES,

  isSignedIn: (accountId) => platform().microsoft?.isSignedIn(accountId) ?? false,
  signedOutMessage: OUTLOOK_SIGNED_OUT_MESSAGE,
  async removeAccount(accountId) {
    await endSubscription(accountId);
    forgetOutlookSync(accountId);
    forgetFolders(accountId);
    forgetGraph(accountId);
    await platform().microsoft?.removeTokens(accountId);
  },

  sync: syncOutlook,
  needsBackfill,
  backfill: backfillOutlook,
  background: (lane, fn) => tier().run(lane, fn),
  isCoolingDown,
  errorKind,
  describeError,

  watchViaRelay: (accountId) => renewSubscription(accountId),

  async listLabels(accountId) {
    return labelsOf(accountId, await readMailbox(accountId));
  },
  getSummaries: messages.getSummaries,
  getMessage: messages.getMessage,
  fetchAttachment: messages.fetchAttachment,
  getReplyHeaders: messages.getReplyHeaders,
  getUnsubscribeHeaders: messages.getUnsubscribeHeaders,
  listIds: search.listIds,
  search: (accountId, q, pageToken, maxResults) =>
    search.search(accountId, q, pageToken, maxResults, mailStore.getLabels(accountId)),

  modifyMessage: writes.modifyMessage,
  modifyThread: writes.modifyThread,
  trashMessage: writes.trashMessage,
  trashThread: writes.trashThread,
  untrashMessage: writes.untrashMessage,
  untrashThread: writes.untrashThread,
  markRead: writes.markRead,
  deleteForever: writes.deleteForever,
  emptyFolder: writes.emptyFolder,

  createLabel: writes.createLabel,
  updateLabel: writes.updateLabel,
  deleteLabel: writes.deleteLabel,

  send: (accountId, mail) => send.send(accountId, mail),
  sendDraft: (accountId, draftId) => send.sendDraft(accountId, draftId),
  scheduleSend: send.scheduleSend,
  cancelScheduledSend: send.cancelScheduledSend,
  sendRaw: (accountId, raw) => send.sendRaw(accountId, raw),

  saveDraft: send.saveDraft,
  deleteDraft: send.deleteDraft,
  getDraftVersion: send.getDraftVersion,
  getDraftRevision: send.getDraftRevision,
  findDraftId: send.findDraftId,

  readProfile,

  calendar,
};
