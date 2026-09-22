import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { ipc, type AppSettings, type PetPackage } from "@/lib/ipc";
import {
  atlasBackgroundPosition,
  PET_CELL_HEIGHT,
  PET_CELL_WIDTH,
  type PetStatus,
} from "./pet-atlas";

interface NativePetState {
  status: PetStatus;
  lookDirection: number;
  changedAt: number;
}

const DEFAULT_STATE: NativePetState = {
  status: "idle",
  lookDirection: 0,
  changedAt: 0,
};

export default function PetOverlayApp() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [pet, setPet] = useState<PetPackage | null>(null);
  const [state, setState] = useState(DEFAULT_STATE);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const previous = {
      rootBackground: root.style.background,
      bodyBackground: body.style.background,
      bodyOverflow: body.style.overflow,
    };
    root.style.background = "transparent";
    body.style.background = "transparent";
    body.style.overflow = "hidden";
    return () => {
      root.style.background = previous.rootBackground;
      body.style.background = previous.bodyBackground;
      body.style.overflow = previous.bodyOverflow;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void ipc
      .getAppSettings()
      .then(async (next) => {
        if (cancelled) return;
        setSettings(next);
        const packageData = await ipc.getPetPackage(next.petId ?? "damiao-codex");
        if (!cancelled) setPet(packageData);
      })
      .catch((error) => console.error("[pet-overlay] load failed", error));
    const unlisten = listen<NativePetState>("pet://state", (event) => {
      setState(event.payload);
      setFrame(0);
    });
    return () => {
      cancelled = true;
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setFrame((value) => value + 1), state.status === "waiting" ? 520 : 180);
    return () => window.clearInterval(id);
  }, [state.status]);

  const backgroundPosition = useMemo(
    () => atlasBackgroundPosition(state.status, frame, state.lookDirection),
    [frame, state.lookDirection, state.status],
  );

  const savePosition = async () => {
    try {
      const position = await getCurrentWindow().outerPosition();
      const scale = await getCurrentWindow().scaleFactor();
      await ipc.savePetPosition({ x: position.x / scale, y: position.y / scale });
    } catch (error) {
      console.warn("[pet-overlay] position save failed", error);
    }
  };

  if (!pet || !settings) return null;
  return (
    <main
      aria-label={pet.displayName}
      className="pet-overlay"
      onPointerDown={() => void getCurrentWindow().startDragging()}
      onPointerUp={() => void savePosition()}
      onPointerCancel={() => void savePosition()}
    >
      <div
        className="pet-sprite"
        role="img"
        aria-label={pet.description || pet.displayName}
        style={{
          width: PET_CELL_WIDTH,
          height: PET_CELL_HEIGHT,
          backgroundImage: `url(${pet.spritesheetDataUrl})`,
          backgroundPosition,
        }}
      />
    </main>
  );
}
