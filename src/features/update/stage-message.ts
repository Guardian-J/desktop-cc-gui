import { useTranslation } from "react-i18next";
import { downloadPercent, type UpdateStage } from "./store";

interface StageMessageInput {
  stage: UpdateStage;
  /** Version of the pending update, shown on the "available" stage. */
  version?: string;
  downloadedBytes: number;
  totalBytes?: number;
  error?: string;
}

/**
 * One-line copy for the update stages that more than one surface renders —
 * the floating toast (UpdateToast) and the settings update row
 * (AboutSection) — so the two can never drift apart while both are on
 * screen during a download.
 *
 * The caller owns the stages with surface-specific copy: the toast hides
 * idle/checking/latest, the settings row renders its own "checking" and
 * "latest" lines (the latter with the release date).
 */
export function useUpdateStageMessage({
  stage,
  version,
  downloadedBytes,
  totalBytes,
  error,
}: StageMessageInput): string | null {
  const { t } = useTranslation();
  switch (stage) {
    case "available":
      return t("settings.updateAvailable", { version });
    case "downloading": {
      const percent = downloadPercent(downloadedBytes, totalBytes);
      return t("settings.updateDownloading") + (percent !== null ? ` ${percent}%` : "");
    }
    case "installing":
      return t("settings.updateInstalling");
    case "restarting":
      return t("settings.updateRestarting");
    case "error":
      return t("settings.updateError", { message: error });
    default:
      return null;
  }
}
