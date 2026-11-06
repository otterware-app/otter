export { makeCoreClient, type CoreClient } from "./client.ts";
export { makeClient, makeClientProtocol, type RpcPort } from "@otter-mail/contracts/rpc-port";
export {
  CORE_RPC,
  CoreHostRpcs,
  CoreInvokeError,
  CoreStartError,
  type CoreEvent,
  type HostEffect,
  type HostMessage,
  type HostRequest,
  type HostRequestKind,
  type HostRequestParams,
  type HostRequestResults,
} from "@otter-mail/contracts/rpc";
