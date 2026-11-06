import { requireNativeModule } from "expo";

export type PickedFile = { name: string; mimeType: string; size: number; base64: string };

type FilesModule = {
  /** Quick Look. */
  preview(name: string, base64: string): Promise<void>;
  /** The share sheet, with Save to Files; settles when it closes. */
  share(name: string, base64: string): Promise<void>;
  /** `remaining`: bytes the draft can still take; more rejects with "Attachments must total 25 MB or less." */
  pickDocuments(remaining: number): Promise<PickedFile[]>;
  pickPhotos(remaining: number): Promise<PickedFile[]>;
};

export const files = requireNativeModule<FilesModule>("OtterFiles");
