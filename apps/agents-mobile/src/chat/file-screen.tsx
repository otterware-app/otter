import { useLocalSearchParams } from "expo-router";

import { Placeholder } from "../frame/placeholder.tsx";

/** A file where the agent runs (FileScreen.swift): text with line numbers, Markdown, or Quick Look. */
export function FileScreen() {
  const { path } = useLocalSearchParams<"/chats/[id]/file">();
  return (
    <Placeholder
      title={path?.split("/").pop() ?? "File"}
      line="The file, read from the agent's gateway, goes here."
      icon="doc.text"
    />
  );
}
