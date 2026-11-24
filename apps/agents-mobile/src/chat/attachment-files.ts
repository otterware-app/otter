import type { AttachmentFiles, PickedFile } from "@otter/client/agents/chat-attachments";
import { MAX_ATTACHMENTS } from "@otter/client/agents/chat-attachments";
import { fileBytes } from "@otter/mobile/file-bytes";
import { CameraView } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

/** A file the phone handed the composer: a `file://` URL, or a pasted image's `data:` URL. */
export type PhoneFile = PickedFile & { uri: string };

// VisionKit requires a camera on iPhone. CameraView.isAvailableAsync only exists on web.
export const cameraAvailable = CameraView.isDocumentScannerAvailable;

const base64Bytes = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/** What `useChatAttachments` asks of the phone: a file's bytes, and an image's picture while it's in the composer. */
export const phoneFiles: AttachmentFiles<PhoneFile> = {
  bytes: (file) =>
    file.uri.startsWith("data:")
      ? Promise.resolve(base64Bytes(file.uri.slice(file.uri.indexOf(",") + 1)))
      : fileBytes(file.uri),
  preview: (file) => file.uri,
};

const photo = (asset: ImagePicker.ImagePickerAsset): PhoneFile => ({
  uri: asset.uri,
  name: asset.fileName ?? "Photo.jpg",
  type: asset.mimeType ?? "image/jpeg",
  size: asset.fileSize ?? 0,
});

/** Photos from the library, as JPEG where they're HEIC (agents take GIF, JPEG, PNG and WebP). */
export async function pickPhotos(room: number): Promise<PhoneFile[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, Math.min(room, MAX_ATTACHMENTS)),
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  return result.canceled ? [] : result.assets.map(photo);
}

export async function takePhoto(): Promise<PhoneFile[]> {
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 });
  return result.canceled ? [] : result.assets.map((a) => ({ ...photo(a), name: "Photo.jpg" }));
}

export async function pickDocuments(): Promise<PhoneFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
  });
  return result.canceled
    ? []
    : result.assets.map((a) => ({
        uri: a.uri,
        name: a.name,
        type: a.mimeType ?? "application/octet-stream",
        size: a.size ?? 0,
      }));
}

/** The image on the clipboard, when there is one. */
export async function pastedImage(): Promise<PhoneFile[]> {
  const image = await Clipboard.getImageAsync({ format: "png" });
  if (!image) return [];
  const base64 = image.data.slice(image.data.indexOf(",") + 1);
  return [
    {
      uri: image.data,
      name: "Pasted image.png",
      type: "image/png",
      size: Math.floor((base64.length * 3) / 4),
    },
  ];
}
