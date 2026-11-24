import type { AppSettings } from "@otter/contracts";
import { requireNativeModule } from "expo";

export type MailOAuthProvider = "gmail" | "outlook";
type MailSignIn = { email: string; name: string; picture?: string };

/** Our module (ios/OtterMobileModule.swift). Bytes cross it as base64. */
export const native = requireNativeModule<{
  keychainGet(service: string, name: string): Promise<string | null>;
  keychainSet(service: string, name: string, value: string): Promise<void>;
  keychainDelete(service: string, name: string): Promise<void>;
  googleIdToken(): Promise<string | null>;
  cancelGoogleSignIn(): Promise<void>;
  mailSignedInAddresses(provider: MailOAuthProvider): Promise<string[]>;
  mailSignIn(provider: MailOAuthProvider, loginHint: string | null): Promise<MailSignIn | null>;
  mailToken(
    provider: MailOAuthProvider,
    email: string,
    id: boolean,
    force: boolean,
  ): Promise<string | null>;
  mailForget(provider: MailOAuthProvider, email: string): Promise<void>;
  mailPushConfig(): { topic: string; environment: "sandbox" | "production" } | null;
  writeMailPushConfiguration(configuration: string | null): Promise<void>;
  mailSocketOpen(host: string, port: number, tls: boolean): Promise<string>;
  mailSocketRead(id: string): Promise<string | null>;
  mailSocketWrite(id: string, base64: string): Promise<void>;
  mailSocketStartTls(id: string): Promise<void>;
  mailSocketClose(id: string): void;
  existingMailSettings(): {
    "otter:user"?: string;
    "otter:mailboxes"?: string;
    "otter:addresses"?: string;
    ui?: Record<string, string>;
    sync?: Partial<Pick<AppSettings, "notificationsMode" | "readLanguages" | "autoTranslate">>;
  };
  existingMailDrafts(userId: string): Promise<string[]>;
  existingMailDraftAttachment(folder: string, filename: string): Promise<string>;
  makeAgentPicture(uri: string, maxLength: number): Promise<string>;
  ed25519Generate(): { privateKey: string; publicKey: string };
  ed25519Sign(privateKey: string, data: string): Promise<string>;
  existingAgentOutbox(userId: string): Promise<string | null>;
  existingAgentSettings(): { deviceId?: string; notifications?: string; user?: string };
  ed25519PublicKey(privateKey: string): string | null;
  launchedAt(): number;
  formatMailDate(timestamp: number): string;
}>("OtterMobile");
