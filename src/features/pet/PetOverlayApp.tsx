import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { ipc, type AppSettings, type PetPackage } from "@/lib/ipc";
import {
  atlasBackgroundPosition,
  PET_BUBBLE_HEIGHT,
  PET_BUBBLE_WIDTH,
  PET_CELL_HEIGHT,
  PET_CELL_WIDTH,
  type PetAnimation,
  type PetStatus,
} from "./pet-atlas";
import type { PetActivity } from "./pet-state";
import {
  DEFAULT_PET_SCALE,
  normalizePetScale,
  PET_BASE_SCALE,
  PET_SCALE_OPTIONS,
} from "./pet-scale";

interface NativePetState {
  sessionKey: string | null;
  sessionName: string | null;
  status: PetStatus;
  activity: PetActivity;
  lookDirection: number;
  cursorNearby: boolean;
  cursorOver: boolean;
  changedAt: number;
}

const DEFAULT_STATE: NativePetState = {
  sessionKey: null,
  sessionName: null,
  status: "idle",
  activity: "idle",
  lookDirection: 0,
  cursorNearby: false,
  cursorOver: false,
  changedAt: 0,
};

const IDLE_ANIMATIONS: readonly PetAnimation[] = ["stand", "rest", "lay"];

export default function PetOverlayApp() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [pet, setPet] = useState<PetPackage | null>(null);
  const [state, setState] = useState(DEFAULT_STATE);
  const [frame, setFrame] = useState(0);
  const [idleAnimation, setIdleAnimation] = useState<PetAnimation>("stand");
  const [scale, setScale] = useState(DEFAULT_PET_SCALE);
  const scaleRef = useRef(DEFAULT_PET_SCALE);
  const [reducedMotion, setReducedMotion] = useState(false);
  const renderScale = PET_BASE_SCALE * scale;

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
    const unlistenState = listen<NativePetState>("pet://state", (event) => {
      setState({ ...DEFAULT_STATE, ...event.payload });
    });
    const unlistenScale = listen<number>("pet://scale", (event) => {
      const next = normalizePetScale(event.payload);
      scaleRef.current = next;
      setScale(next);
      setSettings((current) => (current ? { ...current, petScale: next } : current));
    });
    void (async () => {
      try {
        const next = await ipc.getAppSettings();
        const petId = next.petId?.trim();
        // The native host only creates this window with a pet selected; with
        // none there is nothing to render (and nothing localized to show).
        if (!petId) {
          console.warn("[pet-overlay] no pet selected, staying hidden");
          return;
        }
        const packageData = await ipc.getPetPackage(petId);
        if (cancelled) return;
        setSettings(next);
        setPet(packageData);
        const initialScale = normalizePetScale(next.petScale);
        setScale(initialScale);
        scaleRef.current = initialScale;
        // Visibility is owned by the Rust host: pet_set_visible shows the
        // window once state is emitted. No JS show() here — the capability
        // set deliberately does not grant it.
      } catch (error) {
        console.error("[pet-overlay] load failed", error);
      }
    })();
    return () => {
      cancelled = true;
      void unlistenState.then((dispose) => dispose());
      void unlistenScale.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setFrame(0);
  }, [state.activity, state.cursorNearby, state.cursorOver, state.status]);

  useEffect(() => {
    if (state.status !== "idle" || state.cursorNearby || state.cursorOver) return;
    let timer: number | null = null;
    const changeIdleAnimation = () => {
      setIdleAnimation((current) => {
        const candidates = IDLE_ANIMATIONS.filter((candidate) => candidate !== current);
        return candidates[Math.floor(Math.random() * candidates.length)] ?? "stand";
      });
      timer = window.setTimeout(changeIdleAnimation, 2800 + Math.random() * 3200);
    };
    changeIdleAnimation();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [state.cursorNearby, state.cursorOver, state.status]);

  const animation = useMemo<PetAnimation>(() => {
    if (state.cursorOver) return "jump";
    if (state.status !== "idle") return state.status;
    if (state.cursorNearby) return "idle";
    return idleAnimation;
  }, [idleAnimation, state.cursorNearby, state.cursorOver, state.status]);

  const activityText =
    state.activity === "thinking"
      ? t("settings.petActivityThinking")
      : state.activity === "tool"
        ? t("settings.petActivityTool")
        : state.activity === "command"
          ? t("settings.petActivityCommand")
          : state.activity === "waiting"
            ? t("settings.petActivityWaiting")
            : state.activity === "failed"
              ? t("settings.petActivityFailed")
              : state.activity === "completed"
                ? t("settings.petActivityCompleted")
                : "";
  const sessionName = state.sessionName?.trim() ?? "";
  const bubbleText = activityText
    ? sessionName
      ? t("settings.petActivityWithSession", {
          session: sessionName,
          status: activityText,
        })
      : activityText
    : "";

  useEffect(() => {
    const frameDelay = reducedMotion
      ? 420
      : animation === "jump"
        ? 125
        : animation === "lay"
          ? 420
          : state.status === "waiting"
            ? 520
            : 180;
    const id = window.setInterval(() => setFrame((value) => value + 1), frameDelay);
    return () => window.clearInterval(id);
  }, [animation, reducedMotion, state.status]);

  const backgroundPosition = useMemo(
    () => atlasBackgroundPosition(animation, frame, state.lookDirection, pet?.frameCounts, renderScale),
    [animation, frame, pet?.frameCounts, renderScale, state.lookDirection],
  );

  const savePosition = async () => {
    try {
      const window = getCurrentWindow();
      const position = await window.outerPosition();
      const dpi = await window.scaleFactor();
      await ipc.savePetPosition({
        x: position.x / dpi + ((PET_BUBBLE_WIDTH - PET_CELL_WIDTH) / 2) * renderScale,
        y: position.y / dpi + PET_BUBBLE_HEIGHT,
      });
    } catch (error) {
      console.warn("[pet-overlay] position save failed", error);
    }
  };

  const cycleScale = async () => {
    const current = scaleRef.current;
    const currentIndex = PET_SCALE_OPTIONS.findIndex((value) => Math.abs(value - current) < 0.001);
    const next = PET_SCALE_OPTIONS[(currentIndex + 1) % PET_SCALE_OPTIONS.length];
    scaleRef.current = next;
    setScale(next);
    try {
      const applied = await ipc.setPetScale(next);
      scaleRef.current = applied;
      setScale(normalizePetScale(applied));
    } catch (error) {
      scaleRef.current = current;
      setScale(current);
      console.warn("[pet-overlay] resize failed", error);
    }
  };

  if (!pet || !settings) return null;
  return (
    <main
      aria-label={pet.displayName}
      className="pet-overlay"
      data-tauri-drag-region
      style={{
        width: PET_BUBBLE_WIDTH * renderScale,
        height: PET_CELL_HEIGHT * renderScale + PET_BUBBLE_HEIGHT,
      }}
      onMouseUp={() => void savePosition()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void cycleScale();
      }}
    >
      <div
        className={`pet-bubble${bubbleText ? " pet-bubble-visible" : ""}`}
        aria-live="polite"
        aria-hidden={!bubbleText}
        aria-label={bubbleText || undefined}
      >
        {sessionName ? <span className="pet-bubble-session">{sessionName}</span> : null}
        <span className="pet-bubble-status">{activityText}</span>
      </div>
      <div
        data-tauri-drag-region
        className="pet-sprite"
        role="img"
        aria-label={pet.description || pet.displayName}
        style={{
          position: "absolute",
          left: ((PET_BUBBLE_WIDTH - PET_CELL_WIDTH) / 2) * renderScale,
          bottom: 0,
          width: PET_CELL_WIDTH * renderScale,
          height: PET_CELL_HEIGHT * renderScale,
          backgroundImage: `url(${pet.spritesheetDataUrl})`,
          backgroundSize: `${PET_CELL_WIDTH * 8 * renderScale}px ${PET_CELL_HEIGHT * 11 * renderScale}px`,
          backgroundPosition,
        }}
      />
    </main>
  );
}
