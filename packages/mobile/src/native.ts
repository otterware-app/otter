import { requireNativeModule } from "expo";

/** Our module (ios/OtterMobileModule.swift). Bytes cross it as base64. */
export const native = requireNativeModule<{
  keychainGet(service: string, name: string): Promise<string | null>;
  keychainSet(service: string, name: string, value: string): Promise<void>;
  keychainDelete(service: string, name: string): Promise<void>;
  googleIdToken(): Promise<string | null>;
  cancelGoogleSignIn(): Promise<void>;
  makeAgentPicture(uri: string, maxLength: number): Promise<string>;
  ed25519Generate(): { privateKey: string; publicKey: string };
  ed25519Sign(privateKey: string, data: string): Promise<string>;
  existingAgentOutbox(userId: string): Promise<string | null>;
  existingAgentSettings(): { deviceId?: string; notifications?: string; user?: string };
  ed25519PublicKey(privateKey: string): string | null;
  launchedAt(): number;
}>("OtterMobile");
