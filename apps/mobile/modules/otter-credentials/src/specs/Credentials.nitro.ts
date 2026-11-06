import type { HybridObject } from "react-native-nitro-modules";

export interface AccessToken {
  accessToken: string;
  idToken?: string;
  expiresAt: number;
}

/**
 * The one place credentials live: the iPhone app's Keychain (service
 * dev.otterware.mail, the variant's access group), shared with the
 * notification extension. Refresh tokens never leave it: JS gets access tokens.
 */
export interface Credentials extends HybridObject<{ ios: "swift" }> {
  getSecret(name: string): string | undefined;
  setSecret(name: string, value: string): void;
  deleteSecret(name: string): void;

  hasGoogle(email: string): boolean;
  googleAccessToken(email: string, force: boolean): Promise<AccessToken>;
  forgetGoogle(email: string): void;

  hasMicrosoft(email: string): boolean;
  microsoftAccessToken(email: string, force: boolean): Promise<AccessToken>;
  forgetMicrosoft(email: string): void;

  /** What the notification extension may enrich, as PushState.Configuration JSON. */
  pushConfiguration(): string | undefined;
  configurePush(json: string | undefined): void;
  readonly appGroup: string;
}
