import { create } from "zustand";
import { ipc } from "@/lib/ipc";

/**
 * Beta entry points (设置 → 其他 → 内测功能): feature id -> enabled, persisted
 * in AppSettings.betaFeatures. Every flag defaults to off, so a missing key
 * (old settings file, failed fetch) keeps its entry hidden.
 *
 * The store exists because the gate lives on surfaces that are not settings
 * pages (the sidebar and the center tab strip) and has to re-render the moment
 * a switch flips; a plain `getAppSettings()` read cannot notify them.
 */

/** Catalog of beta entries. `labelKey`/`descriptionKey` are i18n keys; ids
 *  are the settings keys. Add an entry here and it shows up on the settings
 *  page automatically. */
export const BETA_FEATURES = [
  {
    id: "newBrowser",
    labelKey: "settings.betaNewBrowser",
    descriptionKey: "settings.betaNewBrowserDesc",
  },
  {
    id: "missionWorkbench",
    labelKey: "settings.betaMissionWorkbench",
    descriptionKey: "settings.betaMissionWorkbenchDesc",
  },
] as const;

export type BetaFeatureId = (typeof BETA_FEATURES)[number]["id"];

interface BetaFeaturesState {
  features: Record<string, boolean>;
  hydrate: (features: Record<string, boolean> | null | undefined) => void;
  setFeature: (id: BetaFeatureId, enabled: boolean) => Promise<void>;
}

export const useBetaFeaturesStore = create<BetaFeaturesState>((set, get) => ({
  features: {},
  hydrate: (features) => set({ features: features ? { ...features } : {} }),
  setFeature: async (id, enabled) => {
    const previous = get().features;
    // Apply in memory first so the entry appears/disappears without a reload;
    // a failed write rolls the switch back instead of faking a saved state.
    set({ features: { ...previous, [id]: enabled } });
    try {
      const settings = await ipc.getAppSettings();
      await ipc.updateAppSettings({
        ...settings,
        betaFeatures: { ...(settings.betaFeatures ?? {}), [id]: enabled },
      });
    } catch (error) {
      set({ features: previous });
      throw error;
    }
  },
}));

/** One beta flag; absent/false = the entry is hidden. */
export function useBetaFeature(id: BetaFeatureId): boolean {
  return useBetaFeaturesStore((state) => state.features[id] === true);
}

/** Load the persisted flags from settings. At startup this shares the
 *  cached settings promise (ipc.ts), so it adds no IPC round-trip. */
export async function hydrateBetaFeatures(): Promise<void> {
  try {
    const settings = await ipc.getAppSettings();
    useBetaFeaturesStore.getState().hydrate(settings.betaFeatures);
  } catch {
    // Default off: an unreadable settings file never reveals beta entries.
  }
}
