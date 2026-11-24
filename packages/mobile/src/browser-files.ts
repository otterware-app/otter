import { File } from "expo-file-system";

/** A document picker result copied to the cache and ready for the agent's page. */
export function browserFile({ uri, name }: { uri: string; name: string }) {
  const file = new File(uri);
  return { name, size: file.size, data: () => file.base64() };
}
