import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button } from "@/components/base/buttons/button";
import {
  SettingsCard,
  SettingsRow,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { getAppVersion } from "@/lib/platform";
import { useUpdateStore, type UpdateStage } from "@/features/update/store";
import { useUpdateStageMessage } from "@/features/update/stage-message";

/** Row description for the current update stage. */
function describeUpdate(input: {
  stage: UpdateStage;
  message: string | null | undefined;
  latestVersion: string | null | undefined;
  latestPubDate: string | null | undefined;
  language: string;
  t: TFunction;
}): string | undefined {
  const { stage, message, latestVersion, latestPubDate, language, t } = input;
  if (stage === "checking") return t("settings.updateChecking");
  if (stage === "latest") {
    // The "up to date" line keeps its own richer copy (version + date).
    const parsed = latestPubDate ? new Date(latestPubDate) : null;
    const date =
      parsed && !Number.isNaN(parsed.getTime())
        ? parsed.toLocaleDateString(language)
        : null;
    if (!latestVersion) return t("settings.updateLatest");
    return date
      ? t("settings.updateLatestDetail", { version: latestVersion, date })
      : t("settings.updateLatestDetailNoDate", { version: latestVersion });
  }
  return message ?? undefined;
}

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
  const updateDescription = describeUpdate({
    stage: updateStage,
    message: updateMessage,
    latestVersion,
    latestPubDate,
    language: i18n.language,
    t,
  });

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
            <UpdateControls
              stage={updateStage}
              inFlight={updateInFlight}
              onCheck={() => void checkForUpdates({ interactive: true })}
              onStart={() => void startUpdate()}
            />
          </SettingsRow>
        </SettingsCard>
      </div>
    </div>
  );
}

/** Row controls: check button plus the update CTA once a release is known. */
function UpdateControls({
  stage,
  inFlight,
  onCheck,
  onStart,
}: {
  stage: UpdateStage;
  inFlight: boolean;
  onCheck: () => void;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  if (inFlight) {
    // Progress rides in the description; the CTA stays visible but inert so
    // the row does not jump mid-install.
    return (
      <Button size="small" variant="primary" disabled>
        {t("settings.updateNow")}
      </Button>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        size="small"
        variant="secondary"
        disabled={stage === "checking"}
        onClick={onCheck}
      >
        {t("settings.checkUpdates")}
      </Button>
      {stage === "available" && (
        <Button size="small" variant="primary" onClick={onStart}>
          {t("settings.updateNow")}
        </Button>
      )}
    </div>
  );
}
