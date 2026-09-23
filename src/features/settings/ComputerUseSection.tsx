import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/base/buttons/button";
import { Chip } from "@/components/base/chips/chip";
import {
  SettingsCard,
  SettingsRow,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { errorText } from "@/lib/errors";
import { fileUrl, IS_MAC } from "@/lib/platform";
import { ipc, type ComputerUsePermissionStatus } from "@/lib/ipc";
import { useChatStore } from "@/features/chat/store";
import { engineSupportsComputerUse } from "@/features/chat/computer-use";

/**
 * 设置 → 电脑操控: what the computer-use driver needs, how to grant it, and
 * which engines can receive it.
 *
 * There is deliberately no on/off switch here. A computer-use turn is opt-in
 * per send (`/ccgui-cua <task>` in the composer), never a global mode: the
 * driver pre-approves machine input, so it must not be reachable from an
 * ordinary message that the user did not mean as a machine command. This
 * page is the setup/status surface that command points at.
 *
 * The virtual pointer is not a setting either — the app draws it for the
 * whole run (src-tauri/src/cu_overlay.rs); the model has no tool that can
 * hide it. The copy says so, because "can I see what it is doing" is the
 * first question this page has to answer.
 */
export function ComputerUseSection() {
  const { t } = useTranslation();
  const engines = useChatStore((s) => s.engines);
  const [status, setStatus] = useState<ComputerUsePermissionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragSource, setDragSource] = useState<{ path: string; icon: string } | null>(
    null,
  );

  const refreshStatus = useCallback(() => {
    void ipc
      .computerUsePermissionStatus()
      .then((next) => {
        setStatus(next);
        setError(null);
      })
      .catch((e) => setError(errorText(e)));
  }, []);

  useEffect(() => {
    refreshStatus();
    // Drag-to-grant material; a failure only loses the affordance.
    void ipc
      .computerUseDragSource()
      .then(setDragSource)
      .catch(() => {});
  }, [refreshStatus]);

  // Settings panes only accept a real app drag, so the grant affordance is a
  // draggable icon rather than a button. The import is dynamic: the plugin
  // has no meaning in web mode, where this page still renders.
  const startAppDrag = useCallback(() => {
    if (!dragSource) return;
    void import("@crabnebula/tauri-plugin-drag")
      .then(({ startDrag }) =>
        startDrag({ item: [dragSource.path], icon: dragSource.icon }),
      )
      .catch((e) => setError(errorText(e)));
  }, [dragSource]);

  const openPane = useCallback(
    (kind: "accessibility" | "screenRecording") => {
      void ipc
        .computerUseOpenPermissionSettings(kind)
        .then(() => refreshStatus())
        .catch((e) => setError(errorText(e)));
    },
    [refreshStatus],
  );

  const granted = (ok: boolean | undefined) => (
    <Chip selected={ok === true}>
      {ok ? t("settings.computerUseGranted") : t("settings.computerUseNotGranted")}
    </Chip>
  );

  return (
    <div className="flex w-full flex-col gap-6">
      {error && (
        <p role="alert" className="text-body-regular text-text-error-primary">
          {t("common.error")}: {error}
        </p>
      )}

      <div className="flex w-full flex-col gap-2">
        <SettingsSectionLabel>{t("settings.computerUsePermissions")}</SettingsSectionLabel>
        <SettingsCard>
          {status && !status.osPermissionsRequired ? (
            <SettingsRow
              label={t("settings.computerUseNoGrantNeeded")}
              description={t("settings.computerUseNoGrantNeededDesc")}
            />
          ) : (
            <>
              <SettingsRow
                label={t("settings.computerUseAccessibility")}
                description={t("settings.computerUseAccessibilityDesc")}
              >
                <div className="flex items-center gap-2">
                  {granted(status?.accessibility)}
                  {IS_MAC && (
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => openPane("accessibility")}
                    >
                      {t("settings.computerUseOpenPane")}
                    </Button>
                  )}
                </div>
              </SettingsRow>
              <SettingsRow
                label={t("settings.computerUseScreenRecording")}
                description={t("settings.computerUseScreenRecordingDesc")}
              >
                <div className="flex items-center gap-2">
                  {granted(status?.screenRecording)}
                  {IS_MAC && (
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => openPane("screenRecording")}
                    >
                      {t("settings.computerUseOpenPane")}
                    </Button>
                  )}
                </div>
              </SettingsRow>
            </>
          )}
        </SettingsCard>
        {IS_MAC && status?.osPermissionsRequired && (
          <p className="px-3 text-body-2-regular text-text-secondary">
            {t("settings.computerUseDragHint")}
          </p>
        )}
        {IS_MAC && dragSource && status?.osPermissionsRequired && (
          <button
            type="button"
            // Drag must begin on the press, not the click: the OS takes over
            // the pointer immediately and the button never sees a mouseup.
            onMouseDown={startAppDrag}
            className="mx-3 flex w-fit cursor-grab items-center gap-2 rounded-lg border border-border-secondary bg-background-primary-default px-3 py-2 text-left"
          >
            <img src={fileUrl(dragSource.icon)} alt="" className="size-6 shrink-0" />
            <span className="text-body-regular text-text-primary">
              {t("settings.computerUseDragApp")}
            </span>
          </button>
        )}
      </div>

      <div className="flex w-full flex-col gap-2">
        <SettingsSectionLabel>{t("settings.computerUseUsage")}</SettingsSectionLabel>
        <SettingsCard>
          <SettingsRow
            label={t("settings.computerUseTrigger")}
            description={t("settings.computerUseTriggerDesc")}
          />
          <SettingsRow
            label={t("settings.computerUseCursor")}
            description={t("settings.computerUseCursorDesc")}
          />
        </SettingsCard>
      </div>

      <div className="flex w-full flex-col gap-2">
        <SettingsSectionLabel>{t("settings.computerUseEngines")}</SettingsSectionLabel>
        <SettingsCard>
          {engines.map((engine) => (
            <SettingsRow
              key={engine.id}
              label={CLI_DISPLAY_NAMES[engine.id] ?? engine.id}
              labelAdornment={<EngineIcon engine={engine.id} size={14} />}
            >
              <Chip selected={engineSupportsComputerUse(engines, engine.id)}>
                {engineSupportsComputerUse(engines, engine.id)
                  ? t("settings.computerUseEngineSupported")
                  : t("settings.computerUseEngineUnsupported")}
              </Chip>
            </SettingsRow>
          ))}
        </SettingsCard>
        <p className="px-3 text-body-2-regular text-text-secondary">
          {t("settings.computerUseEnginesDesc")}
        </p>
      </div>
    </div>
  );
}
