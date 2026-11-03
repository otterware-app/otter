export const SIGNED_OUT_MESSAGE = "Signed out of Google. Sign in to this account again.";

export class SignInCancelledError extends Error {
  constructor() {
    super("Sign-in was cancelled.");
  }
}

/** The browser step was never finished: the user's to retry, not a failure to report. */
export class SignInTimedOutError extends Error {}
