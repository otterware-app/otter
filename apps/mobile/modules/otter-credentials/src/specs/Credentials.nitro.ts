import type { HybridObject } from "react-native-nitro-modules";

export interface SignedIn {
  email: string;
  name?: string;
  picture?: string;
}

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

  /** Google's consent in a browser sheet (PKCE, the iOS client); the refresh token stays here. */
  signInGoogle(loginHint: string | undefined): Promise<SignedIn>;
  /** Google's consent for who you are only (the Otter account): an ID token, nothing kept. */
  googleIdTokenSignIn(): Promise<string>;
  /** Microsoft's consent (PKCE, msauth.<bundle id>://auth); the refresh token stays here. */
  signInMicrosoft(loginHint: string | undefined): Promise<SignedIn>;
  cancelSignIn(): void;

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
