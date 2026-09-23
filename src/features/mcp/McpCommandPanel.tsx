/**
 * `/mcp`：输入框里敲 `/mcp`（或在 `/` 选择器里点它）弹出的 MCP 面板——
 * 相当于 CLI 的 `/mcp` 交互命令，按当前会话引擎列出配置清单与运行时状态。
 *
 * 数据来自与设置页同一个 `mcp_inventory` 命令（`useMcpInventory`），因此两处
 * 的「配置已启用 / 运行时已连接」永远一致；面板不做搜索与筛选，只回答
 * 「这台 CLI 现在有哪些 MCP 服务、什么状态」。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Settings from "lucide-react/dist/esm/icons/settings";
import { Button } from "@/components/base/buttons/button";
import { CenteredSpinner, EmptyState } from "@/components/base/empty-state";
import { ActionFeedbackIcon, useActionFeedback } from "@/components/base/action-feedback";
import { ModalShell } from "@/components/dialogs";
import { LocalOnlyNotice } from "@/components/application/settings/local-only-notice";
import { isWeb } from "@/lib/transport";
import { useChatStore } from "@/features/chat/store";
import { McpDetailDialog } from "./McpDetailDialog";
import { McpConfigList, McpSourceHint, RuntimeBlock } from "./McpSection";
import {
  latestCheckedAt,
  probeable,
  useAutoProbe,
  useMcpProbeStore,
} from "./probe-store";
import { engineLabel, openMcpSettings } from "./labels";
import { useMcpPanel } from "./panel";
import type { McpConfigEntry } from "./types";
import { useMcpInventory } from "./useMcpInventory";

export function McpCommandPanel() {
  const open = useMcpPanel((state) => state.open);
  if (!open) return null;
  return <PanelBody />;
}

function PanelBody() {
  const { t, i18n } = useTranslation();
  const closePanel = useMcpPanel((state) => state.closePanel);
  const engineId = useChatStore((state) => state.active?.engine ?? null);
  const workspacePath = useChatStore((state) => state.active?.workspacePath ?? null);
  const store = useMcpInventory(workspacePath);
  const engine = store.inventory?.engines.find((item) => item.id === engineId) ?? null;
  const [selected, setSelected] = useState<McpConfigEntry | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const refreshAction = useActionFeedback({ spin: true });
  const probeAll = useMcpProbeStore((state) => state.probeAll);
  const probingAll = useMcpProbeStore((state) => state.runningAll);
  const probeError = useMcpProbeStore((state) => state.error);
  const probeResults = useMcpProbeStore((state) => state.results);
  const label = engineId ? engineLabel(engineId) : t("mcp.command.title");
  const probeableCount = (engine?.config.entries ?? []).filter(probeable).length;
  // 打开面板即检测：新鲜缓存直接复用（重复打开不重复启动服务）。
  useAutoProbe(engine?.config.entries, workspacePath, !isWeb);
  const checkedAt = latestCheckedAt(engine?.config.entries ?? [], probeResults);

  const handleToggle = (entry: McpConfigEntry, enabled: boolean) => {
    setToggleError(null);
    void store.setEnabled(entry, enabled).catch((error: unknown) => {
      setToggleError(error instanceof Error ? error.message : String(error));
    });
  };

  return (
    <ModalShell
      onClose={closePanel}
      label={t("mcp.command.title")}
      className="w-[560px] max-w-[94vw]"
      dialogClassName="flex max-h-[70vh] flex-col gap-3"
    >
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-title-3-medium text-text-primary">
          {t("mcp.command.heading", { name: label })}
        </h3>
        <Button
          variant="secondary"
          size="small"
          title={t("mcp.probe.hint")}
          disabled={store.loading || probingAll || probeableCount === 0}
          onClick={() => void probeAll(engine?.config.entries ?? [], workspacePath)}
        >
          {t("mcp.probe.checkAll")}
        </Button>
        <Button
          variant="secondary"
          size="small"
          disabled={store.loading || refreshAction.feedback === "running"}
          onClick={() => {
            if (refreshAction.feedback === "running") return;
            void refreshAction.start(() => store.reload()).catch(() => undefined);
          }}
        >
          <ActionFeedbackIcon icon={RefreshCw} feedback={refreshAction.feedback} spin />
          {t("common.refresh")}
        </Button>
        <Button
          variant="secondary"
          size="small"
          leadingIcon={Settings}
          onClick={() => {
            closePanel();
            openMcpSettings(engineId ?? "claude");
          }}
        >
          {t("mcp.command.manage")}
        </Button>
      </div>

      {isWeb ? (
        <LocalOnlyNotice message={t("mcp.desktopOnly")} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {store.loading && !store.inventory ? (
            <CenteredSpinner className="py-8" />
          ) : typeof store.error === "string" ? (
            <p role="alert" className="text-body-2-regular text-text-error-primary">
              {store.error}
            </p>
          ) : store.error ? (
            <p role="alert" className="text-body-2-regular text-text-error-primary">
              {store.error.message}
            </p>
          ) : null}

          {toggleError ? (
            <p role="alert" className="text-body-2-regular text-text-error-primary">
              {toggleError}
            </p>
          ) : null}

          {probeError ? (
            <p role="alert" className="text-body-2-regular text-text-error-primary">
              {probeError}
            </p>
          ) : null}

          {engine?.support === "none" ? (
            <p className="rounded-2lg bg-background-tertiary-default px-3 py-2 text-caption-1-regular text-text-secondary">
              {t("mcp.support.none", { name: label })}
            </p>
          ) : null}

          {engine && engine.support !== "none" && engine.config.errors.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {engine.config.errors.map((error) => (
                <li
                  key={`${error.source}:${error.path}`}
                  className="rounded-2lg border border-separator-border px-3 py-2 text-caption-1-regular"
                >
                  <span className="text-text-error-primary">{error.message}</span>
                  <span className="ml-2 break-all font-mono text-text-tertiary">
                    {error.path}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {engine && engine.support !== "none" ? (
            <section className="flex flex-col gap-2">
              <h4 className="text-body-medium text-text-primary">
                {t("mcp.config.title")}
                {checkedAt
                  ? ` · ${t("mcp.probe.lastChecked", {
                      time: new Intl.DateTimeFormat(i18n.language, {
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(checkedAt)),
                    })}`
                  : ""}
              </h4>
              {engine.config.entries.length === 0 ? (
                <>
                  <EmptyState className="py-4">
                    <p className="text-body-2-regular">{t("mcp.config.empty")}</p>
                  </EmptyState>
                  <McpSourceHint sources={engine.sources} />
                </>
              ) : (
                <McpConfigList
                  entries={engine.config.entries}
                  pendingId={store.pendingId}
                  selectedId={selected?.id ?? null}
                  workspacePath={workspacePath}
                  onOpen={setSelected}
                  onToggle={handleToggle}
                />
              )}
            </section>
          ) : null}

          {engine && engine.support !== "none" ? (
            <RuntimeBlock section={engine.runtime} filter="all" query="" />
          ) : null}

          {engine && engine.support !== "none" && !engine.available ? (
            <p className="rounded-2lg bg-background-tertiary-default px-3 py-2 text-caption-1-regular text-text-secondary">
              {t("mcp.notInstalled")}
            </p>
          ) : null}

          {engine && engine.support === "native" && engine.config.entries.length > 0 ? (
            <p className="text-caption-1-regular text-text-tertiary">
              {t("mcp.detail.restartHint")}
            </p>
          ) : null}
        </div>
      )}

      {selected ? (
        <McpDetailDialog
          entry={selected}
          pending={store.pendingId === selected.id}
          workspacePath={workspacePath}
          onToggle={(enabled) => handleToggle(selected, enabled)}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </ModalShell>
  );
}
