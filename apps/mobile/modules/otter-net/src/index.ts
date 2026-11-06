import { createHybridObject } from "@otter-mail/mobile-worker";
import type { HttpRequest, HttpResponseHead, WebSocketConnection } from "./specs/Net.nitro";

export type { HttpRequest, HttpResponseHead, WebSocketConnection };

export const createHttpRequest = () => createHybridObject<HttpRequest>("HttpRequest");
export const createWebSocketConnection = () =>
  createHybridObject<WebSocketConnection>("WebSocketConnection");
