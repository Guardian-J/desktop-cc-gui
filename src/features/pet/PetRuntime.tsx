import { useEffect } from "react";
import { useChatStore } from "@/features/chat/store";
import { ensureMissionPersistenceLoaded } from "@/features/mission/runtime";
import { useMissionStore } from "@/features/mission/store";
import { ipc } from "@/lib/ipc";
import { derivePetState } from "./pet-state";

/** Main-window-only bridge. The overlay is a separate Tauri window and loads
 * PetOverlayApp through the #/pet-overlay route. */
export function PetRuntime() {
  useEffect(() => {
    let disposed = false;
    ensureMissionPersistenceLoaded();
    let last = "";
    const publish = () => {
      const snapshot = derivePetState(useChatStore.getState(), useMissionStore.getState());
      const key = `${snapshot.status}:${snapshot.lookDirection}`;
      if (key === last || disposed) return;
      last = key;
      void ipc
        .setPetState({ ...snapshot, changedAt: Date.now() })
        .catch((error) => console.warn("[pet] state publish failed", error));
    };
    publish();
    const unsubscribeChat = useChatStore.subscribe(publish);
    const unsubscribeMission = useMissionStore.subscribe(publish);
    return () => {
      disposed = true;
      unsubscribeChat();
      unsubscribeMission();
    };
  }, []);
  return null;
}
