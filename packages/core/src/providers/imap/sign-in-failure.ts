import { MailProtocolError } from "../../protocols/index.js";

export class NeedsPassword extends Error {
  constructor(email: string) {
    super(`Enter the password for ${email} to sync it.`);
  }
}

export const isSignInFailure = (err: unknown): boolean =>
  err instanceof NeedsPassword || (err instanceof MailProtocolError && err.kind === "auth");
