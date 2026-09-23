/**
 * 使用情况: two separate lists — invocation statistics (Claude Code
 * transcripts; the scope is stated, and "no data" is shown as such) and the
 * management action log.
 */
import { useTranslation } from "react-i18next";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { Button } from "@/components/base/buttons/button";
import { CenteredSpinner, EmptyState } from "@/components/base/empty-state";
import { ActionFeedbackIcon, useActionFeedback } from "@/components/base/action-feedback";
import { useSkillUsage } from "./useSkillUsage";
import { formatTokens } from "./utils";

const ACTION_KEYS: Record<string, string> = {
  install: "install",
  uninstall: "uninstall",
  restore: "restore",
  set_targets: "setTargets",
  import: "import",
  delete_local: "deleteLocal",
};

export function SkillUsagePane() {
  const { t, i18n } = useTranslation();
  const usage = useSkillUsage(true);
  const refreshAction = useActionFeedback({ spin: true });
  const summary = usage.usage;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption-1-regular text-text-tertiary">
          {t("skills.usage.scope")}
        </p>
        <Button
          variant="secondary"
          size="small"
          disabled={usage.usageLoading || refreshAction.feedback === "running"}
          onClick={() => {
            if (refreshAction.feedback === "running") return;
            void refreshAction.start(() => usage.refresh(true)).catch(() => undefined);
          }}
        >
          <ActionFeedbackIcon icon={RefreshCw} feedback={refreshAction.feedback} spin />
          {t("common.refresh")}
        </Button>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-body-medium text-text-primary">{t("skills.usage.invocations")}</h3>
        {usage.usageLoading && !summary ? (
          <CenteredSpinner className="py-8" />
        ) : usage.usageError ? (
          <p role="alert" className="text-body-2-regular text-text-error-primary">
            {usage.usageError}
          </p>
        ) : !summary || summary.scannedFiles === 0 ? (
          <EmptyState className="py-8">
            <p className="text-body-2-regular">{t("skills.usage.noData")}</p>
          </EmptyState>
        ) : summary.skills.length === 0 ? (
          <EmptyState className="py-8">
            <p className="text-body-2-regular">{t("skills.usage.noInvocations")}</p>
          </EmptyState>
        ) : (
          <>
            <p className="text-caption-1-regular text-text-tertiary">
              {t("skills.usage.summary", {
                files: summary.scannedFiles,
                total: summary.totalInvocations,
              })}
              {summary.cached ? ` · ${t("skills.discover.cached")}` : ""}
            </p>
            <table className="w-full table-fixed text-body-2-regular">
              <thead>
                <tr className="text-left text-caption-1-regular text-text-tertiary">
                  <th className="w-1/2 py-1 font-normal">{t("skills.usage.skill")}</th>
                  <th className="w-1/6 py-1 text-right font-normal">{t("skills.usage.calls")}</th>
                  <th className="w-1/6 py-1 text-right font-normal">{t("skills.usage.tokens")}</th>
                  <th className="w-1/6 py-1 text-right font-normal">{t("skills.usage.lastUsed")}</th>
                </tr>
              </thead>
              <tbody>
                {summary.skills.map((entry) => (
                  <tr key={entry.skill} className="border-t border-separator-border">
                    <td className="truncate py-1.5 pr-2 text-text-primary" title={entry.skill}>
                      {entry.skill}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-text-secondary">
                      {entry.invocations}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-text-secondary">
                      {formatTokens(entry.tokens?.total_tokens)}
                    </td>
                    <td className="py-1.5 text-right text-text-tertiary">
                      {entry.lastUsedAt
                        ? new Intl.DateTimeFormat(i18n.language, {
                            month: "short",
                            day: "numeric",
                          }).format(new Date(entry.lastUsedAt))
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {summary.unusedInstalled.length > 0 ? (
              <p className="text-caption-1-regular text-text-tertiary">
                {t("skills.usage.unused", { count: summary.unusedInstalled.length })}
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-body-medium text-text-primary">{t("skills.activity.title")}</h3>
        <p className="text-caption-1-regular text-text-tertiary">{t("skills.activity.scope")}</p>
        {usage.activityLoading && usage.activity.length === 0 ? (
          <CenteredSpinner className="py-6" />
        ) : usage.activityError ? (
          <p role="alert" className="text-body-2-regular text-text-error-primary">
            {usage.activityError}
          </p>
        ) : usage.activity.length === 0 ? (
          <EmptyState className="py-6">
            <p className="text-body-2-regular">{t("skills.activity.empty")}</p>
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-1">
            {usage.activity.map((entry, index) => (
              <li
                key={`${entry.ts}-${entry.action}-${entry.directory ?? index}`}
                className="flex items-center justify-between gap-2 rounded-2lg border border-separator-border px-3 py-1.5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 rounded-full bg-background-tertiary-default px-1.5 py-0.5 text-[10px] text-text-secondary">
                    {t(`skills.activity.action.${ACTION_KEYS[entry.action] ?? "other"}`)}
                  </span>
                  <span className="truncate text-body-2-regular text-text-primary">
                    {entry.name || entry.directory || ""}
                  </span>
                </span>
                <span className="shrink-0 text-caption-1-regular text-text-tertiary">
                  {new Intl.DateTimeFormat(i18n.language, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(entry.ts))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
