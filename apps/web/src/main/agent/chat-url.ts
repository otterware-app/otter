import { defaultUrlTransform } from "react-markdown";
import { isChatFileLink } from "@otter/client/agents/chat-links";

export function chatUrlTransform(url: string): string {
  if (isChatFileLink(url) || /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,/i.test(url))
    return url;
  return defaultUrlTransform(url);
}
