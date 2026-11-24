import { requireNativeModule } from "expo";

/** Our module (ios/OtterMobileModule.swift). Bytes cross it as base64. */
export const native = requireNativeModule<{
  keychainGet(service: string, name: string): Promise<string | null>;
  keychainSet(service: string, name: string, value: string): Promise<void>;
  keychainDelete(service: string, name: string): Promise<void>;
  ed25519Generate(): { privateKey: string; publicKey: string };
  ed25519Sign(privateKey: string, data: string): Promise<string>;
  launchedAt(): number;
}>("OtterMobile");
