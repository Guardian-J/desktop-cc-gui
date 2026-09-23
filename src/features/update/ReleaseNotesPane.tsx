import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import Info from "lucide-react/dist/esm/icons/info";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import RefreshCcw from "lucide-react/dist/esm/icons/refresh-ccw";
import { ActionFeedbackIcon, useActionFeedback, type ActionFeedback } from "@/components/base/action-feedback";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { CHANGELOG_DATA, type ChangelogEntry } from "@/version/changelog";
import { useUpdateDescription } from "./stage-message";
import { useUpdateStore, type UpdateStage } from "./store";

/**
 * Resolve content to display. Shows both EN and ZH when both exist,
 * ordered by the active UI language (zh / zh-TW get Chinese first).
 */
function resolveChangelogContent(
  entry: ChangelogEntry,
  language?: string,
): { lang: "zh" | "en"; text: string }[] {
  const parts = [
    { lang: "zh" as const, text: entry.content.zh },
    { lang: "en" as const, text: entry.content.en },
  ].filter((part) => part.text);
  return (language ?? "").toLowerCase().startsWith("zh") ? parts : parts.reverse();
}

/** One release-notes markdown body (either a local bilingual entry or the
 *  update manifest's `notes`) in the app's prose mapping. */
function ChangelogMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h4 className="pt-1 pb-1 text-body-medium text-text-primary">{children}</h4>
        ),
        p: ({ children }) => <p className="py-0.5 text-body-regular text-text-primary">{children}</p>,
        ul: ({ children }) => (
          <ul className="flex list-disc flex-col gap-1 py-1 pl-5 text-body-regular text-text-primary marker:text-text-tertiary">
            {children}
          </ul>
        ),
        li: ({ children }) => <li className="pl-0.5">{children}</li>,
        strong: ({ children }) => (
          <strong className="font-semibold text-text-primary">{children}</strong>
        ),
        code: ({ children }) => (
          <code className="rounded-sm bg-background-tertiary-default px-1 py-0.5 font-mono text-[0.85em] text-text-primary">
            {children}
          </code>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

/** 版本号比较：两边都去掉可选前缀 v，忽略大小写。 */
function sameVersion(a: string, b: string): boolean {
  return a.trim().replace(/^v/i, "").toLowerCase() === b.trim().replace(/^v/i, "").toLowerCase();
}

/** 本地版本记录里与 `version` 同名的条目；没有版本号（手动打开页签）时取最新
 *  一条，读到的就是最近一次发布的说明。有版本号但没有对应条目时不回落到
 *  别的版本——不能把 v1.0.7 的说明挂在 v1.0.8 的标题下。 */
function localEntryFor(version?: string): ChangelogEntry | undefined {
  if (!version) return CHANGELOG_DATA[0];
  return CHANGELOG_DATA.find((entry) => sameVersion(entry.version, version));
}

/**
 * 版本更新页签（中心面，单实例）：新版本的更新说明 + 就地更新入口。
 *
 * 内容优先级：本次检测到的更新清单 `notes`（新版本自己带的说明，单语
 * markdown）→ 本地 `CHANGELOG_DATA` 同版本条目（双语按当前语言排序）
 * → 「该版本未附带说明」。页签在发现新版本时自动打开，但本身不依赖更新
 * 状态：更新被「稍后」关掉后仍可继续读说明（`notesRelease` 不随 dismiss 清空）。
 *
 * 页头就是更新入口：发现新版本给「立即更新」，任何时候都能就地「检查更新」
 * （结果行复用设置页同一份文案，见 `useUpdateDescription`）。
 */
/** Pane header: title, announced version/date and the update/check actions. */
function ReleaseHeader({
  displayVersion,
  displayDate,
  stage,
  checkFeedback,
  onUpdate,
  onCheck,
}: {
  displayVersion: string | undefined;
  displayDate: string | undefined;
  stage: UpdateStage;
  checkFeedback: ActionFeedback;
  onUpdate: () => void;
  onCheck: () => void;
}) {
  const { t } = useTranslation();
  const inFlight =
    stage === "downloading" || stage === "installing" || stage === "restarting";
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-separator-border px-4">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="shrink-0 text-title-3-medium text-text-primary">{t("changelog.title")}</h1>
        {displayVersion && (
          <span className="shrink-0 rounded-full bg-background-tertiary-default px-2 py-0.5 text-caption-1-medium text-text-secondary">
            v{displayVersion}
          </span>
        )}
        {displayDate && (
          <span className="shrink-0 text-caption-1-regular text-text-tertiary">{displayDate}</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {stage === "available" && (
          <Button size="small" variant="primary" onClick={onUpdate}>
            {t("settings.updateNow")}
          </Button>
        )}
        {inFlight && (
          <Loader2
            className="size-4 shrink-0 animate-spin text-foreground-icon-secondary"
            aria-hidden
          />
        )}
        <Button
          size="small"
          variant="secondary"
          disabled={stage === "checking" || inFlight}
          onClick={onCheck}
        >
          <span className="flex items-center gap-1.5">
            <ActionFeedbackIcon
              icon={RefreshCcw}
              feedback={checkFeedback}
              spin
              iconClassName="size-3.5"
            />
            {t("settings.checkUpdates")}
          </span>
        </Button>
      </div>
    </div>
  );
}

/** Check/download result line; 检查中转圈由按钮承担，这里只给文字结果。 */
function ReleaseDescription({
  description,
  failed,
}: {
  description: string | undefined;
  failed: boolean;
}) {
  if (!description) return null;
  return (
    <div
      role={failed ? "alert" : undefined}
      className={cx(
        "flex shrink-0 items-start gap-2 border-b border-separator-border px-4 py-2 text-body-2-medium",
        failed ? "text-text-error-primary" : "text-text-secondary",
      )}
    >
      {failed ? (
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      ) : (
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      )}
      <span className="min-w-0">{description}</span>
    </div>
  );
}

/** Release-notes body: manifest notes, bilingual local entry, or the empty
 *  copy. */
function ReleaseBody({
  body,
  parts,
}: {
  body: string | undefined;
  parts: { lang: "zh" | "en"; text: string }[];
}) {
  const { t } = useTranslation();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      <div className="mx-auto flex w-full max-w-[52rem] flex-col gap-4">
        {body ? (
          <ChangelogMarkdown text={body} />
        ) : parts.length > 0 ? (
          parts.map((part, idx) => (
            <div
              key={part.lang}
              className={cx(idx > 0 && "border-t border-separator-border pt-3")}
            >
              <ChangelogMarkdown text={part.text} />
            </div>
          ))
        ) : (
          <p className="text-body-regular text-text-secondary">
            {t("settings.updateNotesEmpty")}
          </p>
        )}
      </div>
    </div>
  );
}

export function ReleaseNotesPane() {
  const { i18n } = useTranslation();
  const stage = useUpdateStore((s) => s.stage);
  const version = useUpdateStore((s) => s.version);
  const notesRelease = useUpdateStore((s) => s.notesRelease);
  const downloadedBytes = useUpdateStore((s) => s.downloadedBytes);
  const totalBytes = useUpdateStore((s) => s.totalBytes);
  const error = useUpdateStore((s) => s.error);
  const latestVersion = useUpdateStore((s) => s.latestVersion);
  const latestPubDate = useUpdateStore((s) => s.latestPubDate);
  const startUpdate = useUpdateStore((s) => s.startUpdate);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  // 检查更新是刷新型动作：转圈 → 对号（§4.1）。检查失败（stage error）不出
  // 对号，失败信息由结果行用 role="alert" 说明。
  const checkAction = useActionFeedback({ spin: true });

  // 页签标题上的版本：优先本次检测结果，其次是最近一次发现的快照，
  // 最后才是本地最新条目（手动打开、还没有任何更新检查时）。
  const announced = version ?? notesRelease?.version;
  const local = useMemo(() => localEntryFor(announced), [announced]);
  const displayVersion = announced ?? local?.version;
  const displayDate = notesRelease?.date ?? local?.date;
  const body = notesRelease?.body?.trim();
  const parts = local ? resolveChangelogContent(local, i18n.language) : [];
  const description = useUpdateDescription({
    stage,
    version,
    downloadedBytes,
    totalBytes,
    error,
    latestVersion,
    latestPubDate,
  });
  const failed = stage === "error";

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background-primary-default">
      <ReleaseHeader
        displayVersion={displayVersion}
        displayDate={displayDate}
        stage={stage}
        checkFeedback={checkAction.feedback}
        onUpdate={() => void startUpdate()}
        onCheck={() =>
          void checkAction.start(
            () => checkForUpdates({ interactive: true }),
            // 非抛错型动作把失败写进 store（store.ts 的 error 分支）。
            () => useUpdateStore.getState().stage === "error",
          )
        }
      />
      <ReleaseDescription description={description} failed={failed} />
      <ReleaseBody body={body} parts={parts} />
    </div>
  );
}
