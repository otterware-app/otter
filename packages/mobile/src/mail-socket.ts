import { fromBase64, toBase64, type ByteStream, type Platform } from "@otter/core";

import { native } from "./native.ts";

const WRITE_CHUNK = 64 * 1024;

export const connectMailSocket: Platform["connect"] = async (host, port, { tls }) => {
  const socket = await native.mailSocketOpen(host, port, tls);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    native.mailSocketClose(socket);
  };
  const stream: ByteStream = {
    async read() {
      if (closed) return null;
      try {
        const value = await native.mailSocketRead(socket);
        if (closed) return null;
        if (value !== null) return fromBase64(value);
        close();
        return null;
      } catch (error) {
        if (closed) return null;
        close();
        throw error;
      }
    },
    async write(data) {
      try {
        for (let offset = 0; offset < data.length; offset += WRITE_CHUNK) {
          await native.mailSocketWrite(
            socket,
            toBase64(data.subarray(offset, offset + WRITE_CHUNK)),
          );
        }
      } catch (error) {
        close();
        throw error;
      }
    },
    async startTls() {
      try {
        await native.mailSocketStartTls(socket);
      } catch (error) {
        close();
        throw error;
      }
    },
    close,
  };
  return stream;
};
