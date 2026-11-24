export {
  MailProtocolError,
  type Connector,
  type MailAuth,
  type MailErrorKind,
  type ServerOptions,
} from "./common.ts";
export {
  connectImap,
  ImapClient,
  ImapError,
  type CopyResult,
  type FetchQuery,
  type IdleSession,
  type ImapFolder,
  type ImapOptions,
  type ImapUpdate,
  type MailboxStatus,
  type SearchCriteria,
  type SelectedMailbox,
  type SpecialUse,
} from "./imap/client.ts";
export {
  decodeHeader,
  inUidRanges,
  parseUidRanges,
  parseUidSet,
  uidSet,
  type BodyStructure,
  type FetchedMessage,
  type ImapAddress,
  type ImapEnvelope,
  type UidRange,
} from "./imap/structures.ts";
export { decodeMailboxName, encodeMailboxName } from "./imap/utf7.ts";
export {
  connectSmtp,
  sendMail,
  SmtpClient,
  SmtpError,
  type SmtpEnvelope,
  type SmtpOptions,
  type SmtpReply,
  type SmtpSendResult,
} from "./smtp/client.ts";
export { parseMessage, type ParsedAttachment, type ParsedMessage } from "./mime.ts";
