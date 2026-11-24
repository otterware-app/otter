import { Button } from "@otter/ui-native/components/button";
import { router } from "expo-router";
import { View } from "react-native";

import { Placeholder } from "../frame/placeholder.tsx";

/** Scheduled (ScheduledScreen.swift): what the agents run on a schedule. */
export function ScheduledScreen() {
  return (
    <View style={{ flex: 1 }}>
      <Placeholder
        title="Scheduled"
        line="Each agent's tasks, their next run and their last, go here."
        icon="clock"
      />
      <View
        style={{ position: "absolute", top: 320, left: 0, right: 0, alignItems: "center", gap: 10 }}
      >
        <Button
          title="A task"
          variant="secondary"
          onPress={() => router.push({ pathname: "/tasks/[id]", params: { id: "fake:task" } })}
        />
        <Button title="New task" variant="secondary" onPress={() => router.push("/tasks/new")} />
      </View>
    </View>
  );
}
