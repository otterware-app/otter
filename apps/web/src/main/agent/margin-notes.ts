import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  noteTargetKey,
  type MarginNote,
  type NoteChat,
  type NoteTarget,
} from "@otter/contracts/margin-notes";

import { agentContribution } from "../extensions/registry";
import { mailApi } from "../mail/api";
import { buildHandoffText } from "./chat-context";
import { clampTitle, newChat, sendMessage } from "./chat-store";

const NOTES_KEY = ["margin-notes"] as const;

/** Every open note, kept current by `notes:changed`. */
function useAllNotes() {
  const qc = useQueryClient();
  useEffect(
    () =>
      window.desktopBridge.on("notes:changed", () => {
        void qc.invalidateQueries({ queryKey: NOTES_KEY });
      }),
    [qc],
  );
  return useQuery({
    queryKey: NOTES_KEY,
    queryFn: (): Promise<MarginNote[]> => window.desktopBridge.invoke("notes:list", {}),
    staleTime: 60_000,
  });
}

/** The open notes an agent wrote beside `target` (or beside any of `targets`). */
export function useMarginNotes(target: NoteTarget | NoteTarget[] | null): MarginNote[] {
  const notes = useAllNotes().data ?? [];
  if (!target) return [];
  const keys = new Set((Array.isArray(target) ? target : [target]).map(noteTargetKey));
  return notes.filter((note) => note.state === "open" && keys.has(noteTargetKey(note.target)));
}

/** Accepts the note: its action starts a chat with its agent about what it's on. */
export async function acceptNote(id: string): Promise<void> {
  const chat = await window.desktopBridge.invoke<NoteChat | null>("notes:accept", { id });
  if (!chat) return;
  const { thread, about, prompt, agentId } = chat;
  const kind = (await mailApi.agentProviders()).providers.find((p) => p.id === agentId)?.kind;
  sendMessage(
    {
      id: crypto.randomUUID(),
      convoId: newChat(agentId),
      provider: agentId,
      question: prompt,
      input: thread
        ? buildHandoffText(
            prompt,
            { conversations: [thread] },
            agentContribution(kind ?? "")?.mailReader,
          )
        : `${prompt}\n\n${about}`,
      title: clampTitle(chat.title),
      ...(thread && {
        context: {
          subjects: [thread.subject],
          count: 1,
          kind: "mail" as const,
          items: [
            {
              title: thread.subject,
              target: { kind: "thread" as const, id: thread.threadId, accountId: thread.accountId },
            },
          ],
        },
      }),
    },
    "queue",
  );
}

export function dismissNote(id: string): Promise<void> {
  return window.desktopBridge.invoke("notes:dismiss", { id });
}
