import { File } from "expo-file-system";

/** A file the app was handed (a picked photo or document, by its `file://` URL), read whole. */
export const fileBytes = (uri: string): Promise<Uint8Array> => new File(uri).bytes();
