import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/base/buttons/button";
import {
  SettingsCard,
  SettingsRow,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { getAppVersion } from "@/lib/platform";
import { useUpdateStore } from "@/features/update/store";
import { useUpdateStageMessage } from "@/features/update/stage-message";

/** Update page: app identity + version and the check-for-updates row. */
export function UpdateSection() {
  const { t, i18n } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  const updateStage = useUpdateStore((s) => s.stage);
  const updateVersion = useUpdateStore((s) => s.version);
  const downloadedBytes = useUpdateStore((s) => s.downloadedBytes);
  const totalBytes = useUpdateStore((s) => s.totalBytes);
  const updateError = useUpdateStore((s) => s.error);
  const latestVersion = useUpdateStore((s) => s.latestVersion);
  const latestPubDate = useUpdateStore((s) => s.latestPubDate);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const startUpdate = useUpdateStore((s) => s.startUpdate);

  // available / downloading / installing / restarting / error share the
  // toast's copy — both can be on screen at once during a download.
  const updateMessage = useUpdateStageMessage({
    stage: updateStage,
    version: updateVersion,
    downloadedBytes,
    totalBytes,
    error: updateError,
  });
  /** An install is running: the row reports progress instead of offering
   *  a check that would race it. */
  const updateInFlight =
    updateStage === "downloading" || updateStage === "installing" || updateStage === "restarting";

  useEffect(() => {
    let cancelled = false;
    getAppVersion()
      .then((v) => {
        if (!cancelled && v) setVersion(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  let updateDescription: string | undefined;
  if (updateStage === "checking") {
    updateDescription = t("settings.updateChecking");
  } else if (updateStage === "latest") {
    // The "up to date" line keeps its own richer copy (version + date).
    const parsed = latestPubDate ? new Date(latestPubDate) : null;
    const date =
      parsed && !Number.isNaN(parsed.getTime())
        ? parsed.toLocaleDateString(i18n.language)
        : null;
    updateDescription = !latestVersion
      ? t("settings.updateLatest")
      : date
        ? t("settings.updateLatestDetail", { version: latestVersion, date })
        : t("settings.updateLatestDetailNoDate", { version: latestVersion });
  } else {
    updateDescription = updateMessage ?? undefined;
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {/* App identity + version */}
      <div className="flex w-full flex-col gap-2">
        <SettingsSectionLabel>{t("settings.checkUpdates")}</SettingsSectionLabel>
        <SettingsCard>
          <SettingsRow label="CC GUI" description={t("settings.aboutDesc")}>
            <span className="text-body-regular text-text-secondary">
              {version ? `v${version}` : "…"}
            </span>
          </SettingsRow>
          <SettingsRow label={t("settings.checkUpdates")} description={updateDescription}>
            {updateInFlight ? (
              // Progress rides in the description; the CTA stays visible but
              // inert so the row does not jump mid-install.
              <Button size="small" variant="primary" disabled>
                {t("settings.updateNow")}
              </Button>
            ) : (
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="small"
                  variant="secondary"
                  disabled={updateStage === "checking"}
                  onClick={() => void checkForUpdates({ interactive: true })}
                >
                  {t("settings.checkUpdates")}
                </Button>
                {updateStage === "available" && (
                  <Button size="small" variant="primary" onClick={() => void startUpdate()}>
                    {t("settings.updateNow")}
                  </Button>
                )}
              </div>
            )}
          </SettingsRow>
        </SettingsCard>
      </div>
    </div>
  );
}
