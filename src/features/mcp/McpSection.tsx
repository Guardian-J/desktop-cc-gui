/**
 * 设置 → 能力扩展 → MCP.
 *
 * Every engine the app can drive gets a tab, whether or not it ships MCP
 * support: the config inventory (what the CLI files declare, enable switches
 * only for sources whose write semantics are verified) and the runtime
 * inventory (what a live session actually connected, workspace- and
 * session-scoped, with its collection time). Engines that carry MCP through
 * plugins say so; engines without MCP say so instead of showing an empty
 * list as if nothing were configured. A vendor's runtime that this app cannot
 * query states that rather than pretending there are no servers.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Lock from "lucide-react/dist/esm/icons/lock";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Search from "lucide-react/dist/esm/icons/search";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Switch } from "@/components/base/switch/switch";
import { CenteredSpinner, EmptyState } from "@/components/base/empty-state";
import { PillTab, PillTabList } from "@/components/base/tabs/pill-tab";
import { ActionFeedbackIcon, useActionFeedback } from "@/components/base/action-feedback";
import { LocalOnlyNotice } from "@/components/application/settings/local-only-notice";
import { useChatStore } from "@/features/chat/store";
import { isWeb } from "@/lib/transport";
import { cx } from "@/utils/cx";
import { McpDetailDialog } from "./McpDetailDialog";
import { engineIdFromHash, engineLabel, readonlyReasonText } from "./labels";
import type {
  McpConfigEntry,
  McpEngineId,
  McpEngineInventory,
  McpRuntimeSection,
  McpSourceInfo,
} from "./types";
import { useMcpInventory } from "./useMcpInventory";

type KindFilter = "all" | "config" | "runtime";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-body-medium text-text-primary">{children}</h3>;
}

function ConfigRow({
  entry,
  pending,
  selected,
  onOpen,
  onToggle,
}: {
  entry: McpConfigEntry;
  pending: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const meta = entry.command
    ? `${entry.command}${entry.argsCount > 0 ? ` +${entry.argsCount}` : ""}`
    : (entry.url ?? t("mcp.transportUnknown"));
  const readonlyReason = readonlyReasonText(t, entry);
  return (
    <li
      className={cx(
        "flex items-center gap-2 rounded-2lg border border-separator-border px-3 py-2",
        selected && "bg-background-secondary-hover",
        pending && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("mcp.row.open", { name: entry.name })}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
      >
        <span className="flex w-full items-center gap-2">
          <span className="truncate text-body-regular text-text-primary" title={entry.name}>
            {entry.name}
          </span>
          <span className="shrink-0 rounded-full bg-background-tertiary-default px-1.5 py-0.5 text-[10px] text-text-secondary">
            {t(`mcp.source.${entry.source}`)}
          </span>
          {!entry.enabled ? (
            <span className="shrink-0 rounded-full bg-background-tertiary-default px-1.5 py-0.5 text-[10px] text-text-tertiary">
              {t("mcp.disabled")}
            </span>
          ) : null}
        </span>
        <span className="w-full truncate text-caption-1-regular text-text-secondary" title={meta}>
          {entry.transport ? `${entry.transport} · ` : ""}
          {meta}
        </span>
      </button>
      {entry.writable ? (
        <Switch
          size="sm"
          aria-label={t("mcp.toggle", { name: entry.name })}
          isSelected={entry.enabled}
          isDisabled={pending}
          onChange={onToggle}
        />
      ) : (
        <span
          className="flex size-6 items-center justify-center text-text-tertiary"
          title={readonlyReason}
        >
          <Lock className="size-4" aria-hidden />
          <span className="sr-only">{readonlyReason}</span>
        </span>
      )}
    </li>
  );
}

/** Config rows for one engine; shared by the settings page and the `/mcp`
 *  panel so both surfaces show identical state. */
export function McpConfigList({
  entries,
  pendingId,
  selectedId,
  onOpen,
  onToggle,
}: {
  entries: McpConfigEntry[];
  pendingId: string | null;
  selectedId: string | null;
  onOpen: (entry: McpConfigEntry) => void;
  onToggle: (entry: McpConfigEntry, enabled: boolean) => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {entries.map((entry) => (
        <ConfigRow
          key={entry.id}
          entry={entry}
          pending={pendingId === entry.id}
          selected={selectedId === entry.id}
          onOpen={() => onOpen(entry)}
          onToggle={(enabled) => onToggle(entry, enabled)}
        />
      ))}
    </ul>
  );
}

export function RuntimeBlock({
  section,
  filter,
  query,
}: {
  section: McpRuntimeSection;
  filter: KindFilter;
  query: string;
}) {
  const { t, i18n } = useTranslation();
  if (filter === "config") return null;
  const needle = query.trim().toLowerCase();
  const entries = needle
    ? section.entries.filter((entry) => entry.name.toLowerCase().includes(needle))
    : section.entries;
  const collected = section.collectedAt
    ? new Intl.DateTimeFormat(i18n.language, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(section.collectedAt))
    : null;
  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>{t("mcp.runtime.title")}</SectionTitle>
      {section.status !== "ready" && section.status !== "session_ended" ? (
        <p
          className={cx(
            "rounded-2lg bg-background-tertiary-default px-3 py-2 text-caption-1-regular",
            section.status === "unsupported"
              ? "text-text-secondary"
              : "text-text-tertiary",
          )}
        >
          {section.reason ?? t(`mcp.runtime.status.${section.status}`)}
        </p>
      ) : (
        <>
          <p className="text-caption-1-regular text-text-tertiary">
            {t(`mcp.runtime.status.${section.status}`)}
            {section.sessionId ? ` · ${t("mcp.runtime.session", { id: section.sessionId })}` : ""}
            {collected ? ` · ${t("mcp.runtime.collectedAt", { time: collected })}` : ""}
          </p>
          {entries.length === 0 ? (
            <EmptyState className="py-4">
              <p className="text-body-2-regular">
                {needle ? t("mcp.runtime.noMatch") : t("mcp.runtime.empty")}
              </p>
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-1">
              {entries.map((entry) => (
                <li
                  key={entry.name}
                  className="flex items-center gap-2 rounded-2lg border border-separator-border px-3 py-2"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-body-regular text-text-primary">
                      {entry.name}
                    </span>
                    {entry.builtin ? (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/60">
                        {t("mcp.builtin")}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-caption-1-regular text-text-secondary">
                    {entry.toolNames.length > 0
                      ? t("mcp.runtime.tools", { count: entry.toolNames.length })
                      : (entry.status ?? t("mcp.runtime.statusUnknown"))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Where this page looks for the engine's config; missing files still show so
 *  an empty inventory never reads as "this CLI has no MCP support". */
export function McpSourceHint({ sources }: { sources: McpSourceInfo[] }) {
  const { t } = useTranslation();
  if (sources.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-2lg bg-background-tertiary-default px-3 py-2">
      <span className="text-caption-1-medium text-text-secondary">
        {t("mcp.sources.title")}
      </span>
      {sources.map((info) => (
        <span
          key={`${info.source}:${info.path}`}
          className="flex flex-wrap items-baseline gap-x-2 text-caption-1-regular text-text-tertiary"
        >
          <span className="shrink-0">{t(`mcp.source.${info.source}`)}</span>
          <span className="min-w-0 break-all font-mono" title={info.path}>
            {info.path}
          </span>
          {!info.exists ? <span className="shrink-0">{t("mcp.sources.missing")}</span> : null}
        </span>
      ))}
    </div>
  );
}

/** Engine-level support statement for the selected tab. */
function SupportNote({ engine }: { engine: McpEngineInventory }) {
  const { t } = useTranslation();
  const name = engineLabel(engine.id);
  if (engine.support === "none") {
    return (
      <p className="rounded-2lg bg-background-tertiary-default px-3 py-2 text-caption-1-regular text-text-secondary">
        {t("mcp.support.none", { name })}
      </p>
    );
  }
  if (engine.support === "plugin") {
    return (
      <p className="rounded-2lg bg-background-tertiary-default px-3 py-2 text-caption-1-regular text-text-secondary">
        {t("mcp.support.plugin", { name })}
      </p>
    );
  }
  return null;
}

export function McpSection() {
  const { t } = useTranslation();
  const activeWorkspace = useChatStore((state) => state.active?.workspacePath ?? null);
  const store = useMcpInventory(activeWorkspace);
  const [engineId, setEngineId] = useState<McpEngineId>(
    (engineIdFromHash(window.location.hash) as McpEngineId | null) ?? "claude",
  );
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [selected, setSelected] = useState<McpConfigEntry | null>(null);
  const refreshAction = useActionFeedback({ spin: true });
  const [toggleError, setToggleError] = useState<string | null>(null);

  const engines = store.inventory?.engines ?? [];
  const engine = useMemo(
    () => engines.find((item) => item.id === engineId) ?? engines[0] ?? null,
    [engines, engineId],
  );

  const filteredEntries = useMemo(() => {
    if (!engine) return [];
    const needle = query.trim().toLowerCase();
    return engine.config.entries.filter(
      (entry) => !needle || entry.name.toLowerCase().includes(needle),
    );
  }, [engine, query]);

  const showConfig = kind !== "runtime";
  const noEntries = (engine?.config.entries.length ?? 0) === 0;
  const searching = query.trim().length > 0;

  const handleToggle = (entry: McpConfigEntry, enabled: boolean) => {
    setToggleError(null);
    void store.setEnabled(entry, enabled).catch((error: unknown) => {
      setToggleError(error instanceof Error ? error.message : String(error));
    });
  };

  // Desktop-only (web dispatch excludes mcp_inventory / mcp_set_enabled).
  if (isWeb) {
    return <LocalOnlyNotice message={t("mcp.desktopOnly")} />;
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <PillTabList className="flex-wrap">
        {engines.map((item) => (
          <PillTab
            key={item.id}
            isSelected={engine?.id === item.id}
            onSelect={() => {
              setEngineId(item.id);
              setSelected(null);
            }}
          >
            {engineLabel(item.id)}{" "}
            {item.config.entries.length > 0 ? (
              <span
                className="ml-0.5 rounded-full bg-background-tertiary-default px-1.5 text-caption-1-regular text-text-tertiary"
                title={t("mcp.tabCount", { count: item.config.entries.length })}
              >
                {item.config.entries.length}
              </span>
            ) : null}
          </PillTab>
        ))}
      </PillTabList>

      <div className="flex items-center gap-2">
        <Input
          aria-label={t("mcp.searchPlaceholder")}
          placeholder={t("mcp.searchPlaceholder")}
          value={query}
          onChange={setQuery}
          leadingIcon={Search}
          size="small"
          className="flex-1"
        />
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
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(["all", "config", "runtime"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
            className={cx(
              "rounded-full px-2 py-0.5 text-caption-1-regular transition-colors",
              kind === value
                ? "bg-background-tertiary-default text-text-primary"
                : "bg-background-secondary-default text-text-secondary hover:bg-background-tertiary-default",
            )}
          >
            {t(`mcp.filter.${value}`)}
          </button>
        ))}
        <span className="ml-1 text-caption-1-regular text-text-tertiary">
          {t("mcp.count", {
            config: engine?.config.entries.length ?? 0,
            runtime: engine?.runtime.entries.length ?? 0,
          })}
        </span>
      </div>

      {store.loading && !store.inventory ? (
        <CenteredSpinner className="py-10" />
      ) : typeof store.error === "string" ? (
        <div className="flex flex-col items-start gap-2 py-6">
          <p role="alert" className="text-body-2-regular text-text-error-primary">
            {store.error}
          </p>
          <Button variant="secondary" size="small" onClick={() => void store.reload()}>
            {t("common.refresh")}
          </Button>
        </div>
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

      {engine ? <SupportNote engine={engine} /> : null}

      {engine && engine.support !== "none" && !engine.available ? (
        <p className="rounded-2lg bg-background-tertiary-default px-3 py-2 text-caption-1-regular text-text-secondary">
          {t("mcp.notInstalled")}
        </p>
      ) : null}

      {engine && engine.config.errors.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {engine.config.errors.map((error) => (
            <li
              key={`${error.source}:${error.path}`}
              className="rounded-2lg border border-separator-border px-3 py-2 text-caption-1-regular"
            >
              <span className="text-text-error-primary">{error.message}</span>
              <span className="ml-2 break-all font-mono text-text-tertiary">{error.path}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {engine && engine.support !== "none" && showConfig ? (
        <section className="flex flex-col gap-2">
          <SectionTitle>{t("mcp.config.title")}</SectionTitle>
          {filteredEntries.length === 0 ? (
            <>
              <EmptyState className="py-6">
                <p className="text-body-2-regular">{t("mcp.config.empty")}</p>
              </EmptyState>
              {noEntries && !searching ? <McpSourceHint sources={engine.sources} /> : null}
            </>
          ) : (
            <McpConfigList
              entries={filteredEntries}
              pendingId={store.pendingId}
              selectedId={selected?.id ?? null}
              onOpen={setSelected}
              onToggle={handleToggle}
            />
          )}
        </section>
      ) : null}

      {engine && engine.support !== "none" ? (
        <RuntimeBlock section={engine.runtime} filter={kind} query={query} />
      ) : null}

      {selected ? (
        <McpDetailDialog
          entry={selected}
          pending={store.pendingId === selected.id}
          onToggle={(enabled) => handleToggle(selected, enabled)}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
