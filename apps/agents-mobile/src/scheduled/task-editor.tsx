import { useLocalSearchParams } from "expo-router";

import { SheetPlaceholder } from "../frame/placeholder.tsx";

/** Making or editing a task (TaskEditor.swift). */
export function TaskEditor() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <SheetPlaceholder
      title={id ? "Edit task" : "New scheduled task"}
      line="Its name, what to do, when, and where results go."
      icon="calendar.badge.plus"
    />
  );
}
