import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Maximize from "lucide-react/dist/esm/icons/maximize";
import Minus from "lucide-react/dist/esm/icons/minus";
import Play from "lucide-react/dist/esm/icons/play";
import Plus from "lucide-react/dist/esm/icons/plus";
import Scan from "lucide-react/dist/esm/icons/scan";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import { localizeMissionIssues } from "../ai-orchestrator";
import { countRunUnits, runStatus } from "../types";
import { usesOnlySimulatedCapabilities, validateMissionFlow } from "../engine/validator";
import { injectDemoFailure, latestRunOf, startMissionRun } from "../runtime";
import { useMissionStore } from "../store";
import { MISSION_NODE_TYPES } from "./canvas/MissionNodes";
import {
  buildMissionCanvas,
  type MissionCanvasNodeData,
  type MissionItemNodeData,
} from "./canvas/mission-graph";
import { NodeInspector } from "./NodeInspector";

/**
 * 画布：流程定义 / 运行实例双视图 + 节点详情。
 *
 * React Flow 只是画布组件；节点位置来自自动布局，人不能拖动/连线。
 * 运行视图把 foreach 展开成每项一张任务卡，状态来自调度器快照。
 */
export function CanvasPane() {
  const { t } = useTranslation();
  const {
    flows,
    runs,
    selectedFlowId,
    selectedRunId,
    canvasMode,
    selectedNodeKey,
    setCanvasMode,
    selectNode,
    selectFlow,
  } = useMissionStore(
    useShallow((s) => ({
      flows: s.flows,
      runs: s.runs,
      selectedFlowId: s.selectedFlowId,
      selectedRunId: s.selectedRunId,
      canvasMode: s.canvasMode,
      selectedNodeKey: s.selectedNodeKey,
      setCanvasMode: s.setCanvasMode,
      selectNode: s.selectNode,
      selectFlow: s.selectFlow,
    })),
  );
  const [startIssues, setStartIssues] = useState<string[] | null>(null);

  const flow = flows.find((item) => item.id === selectedFlowId) ?? null;
  const run = useMemo(() => {
    if (!flow) return null;
    if (selectedRunId && runs[selectedRunId]) return runs[selectedRunId];
    return latestRunOf(flow, runs);
  }, [flow, runs, selectedRunId]);

  const issues = useMemo(
    () => (flow?.draft ? validateMissionFlow(flow.draft) : []),
    [flow?.draft],
  );
  const mode = canvasMode === "run" && run ? "run" : "definition";
  const canvas = useMemo(() => {
    if (!flow?.draft) return { nodes: [], edges: [] };
    return buildMissionCanvas({
      definition: flow.draft,
      run,
      mode,
      selectedNodeKey,
      issues,
    });
  }, [flow?.draft, run, mode, selectedNodeKey, issues]);

  const activeRun = useMemo(() => {
    if (!flow) return null;
    return (
      flow.runIds
        .map((id) => runs[id])
        .find((item) => item && item.endedAt === undefined && !item.cancelled) ?? null
    );
  }, [flow, runs]);

  const handleRun = useCallback(() => {
    if (!flow) return;
    if (activeRun) {
      selectFlow(flow.id, "run", activeRun.id);
      return;
    }
    const result = startMissionRun(flow.id);
    if (result.ok) {
      setStartIssues(null);
      return;
    }
    if (result.activeRunId) {
      selectFlow(flow.id, "run", result.activeRunId);
      return;
    }
    setStartIssues(
      result.issues && result.issues.length > 0
        ? localizeMissionIssues(result.issues)
        : [result.error ?? t("mission.startRunFailed")],
    );
  }, [flow, activeRun, selectFlow, t]);

  const handleNodeClick = useCallback(
    (node: Node) => {
      const data = node.data as MissionCanvasNodeData;
      if (data.kind === "item") {
        const item = (data as MissionItemNodeData).item;
        const representative =
          item.tasks.find((task) =>
            ["running", "waiting_human", "failed"].includes(task.status),
          ) ?? item.tasks[0];
        if (representative) selectNode(`task:${representative.id}`);
        return;
      }
      if (data.kind === "group") {
        selectNode(`node:${data.node.id}`);
        return;
      }
      if (data.kind === "definition") {
        const bodyPrefix = node.id.startsWith("body:") ? node.id : null;
        selectNode(bodyPrefix ?? `node:${data.node.id}`);
      }
    },
    [selectNode],
  );

  if (!flow) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <h2 className="text-title-3-medium text-text-secondary">
            {t("mission.canvasEmptyTitle")}
          </h2>
          <p className="mt-2 whitespace-pre-line text-body-2-regular text-text-tertiary">
            {t("mission.canvasEmptyDesc")}
          </p>
        </div>
      </div>
    );
  }

  const draft = flow.draft;
  const unitCounts = run ? countRunUnits(run) : null;
  const stateLabel = run
    ? t(
        run.interrupted
          ? "mission.contextStateInterrupted"
          : `mission.contextState${runStatusKey(run)}`,
      )
    : t("mission.contextStateDraft");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background-secondary-default/30">
      <div className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-separator-border bg-background-primary-default px-4 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-body-medium text-text-primary">
            {flow.name || t("mission.title")}
          </h1>
          <div className="text-caption-1-regular text-text-tertiary">
            {!draft
              ? t("mission.noDraft")
              : mode === "run" && run
                ? t("mission.snapshotVersion", {
                    runId: run.id,
                    version: run.snapshot.version,
                  })
                : t("mission.draftVersion", { version: draft.version })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 rounded-md bg-background-secondary-default p-0.5">
            <button
              type="button"
              onClick={() => setCanvasMode("definition")}
              className={cx(
                "cursor-pointer rounded-sm px-2 py-1 text-caption-1-medium transition-colors",
                mode === "definition"
                  ? "bg-background-primary-default text-text-primary shadow-xs"
                  : "text-text-tertiary hover:text-text-secondary",
              )}
            >
              {t("mission.modeDefinition")}
            </button>
            <button
              type="button"
              disabled={!run}
              onClick={() => setCanvasMode("run")}
              className={cx(
                "cursor-pointer rounded-sm px-2 py-1 text-caption-1-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                mode === "run"
                  ? "bg-background-primary-default text-text-primary shadow-xs"
                  : "text-text-tertiary hover:text-text-secondary",
              )}
            >
              {t("mission.modeRun")}
            </button>
          </div>
          <Button
            size="small"
            leadingIcon={Play}
            disabled={!draft}
            onClick={handleRun}
          >
            {activeRun
              ? t("mission.viewCurrentRun")
              : flow.runIds.length > 0
                ? t("mission.startNewRun")
                : t("mission.runFlow")}
          </Button>
        </div>
      </div>

      <div className="flex min-h-8 shrink-0 items-center justify-between gap-3 border-b border-separator-border bg-background-primary-default/60 px-4 py-1.5 text-caption-1-regular text-text-tertiary">
        <span>
          {!draft
            ? t("mission.contextIdle")
            : mode === "definition"
              ? t("mission.contextDefinition", {
                  runNote:
                    run && run.endedAt === undefined
                      ? ` ${t("mission.contextRunDraftNewer", {
                          draft: draft.version,
                          run: run.snapshot.version,
                        })}`
                      : "",
                })
              : t("mission.contextRunSameVersion")}
        </span>
        <span className="shrink-0 whitespace-nowrap">{stateLabel}</span>
      </div>

      {startIssues && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 border-b border-status-rose-text/40 bg-status-rose-background/30 px-4 py-2 text-caption-1-regular text-status-rose-text"
        >
          <ul className="list-disc space-y-0.5 pl-4">
            {startIssues.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          <Button size="xs" variant="ghost" onClick={() => setStartIssues(null)}>
            {t("mission.close")}
          </Button>
        </div>
      )}

      {run && mode === "run" && unitCounts && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-separator-border bg-background-primary-default px-4 py-1.5 text-caption-1-regular text-text-tertiary">
          <strong className="text-body-2-medium text-text-secondary">
            {t("mission.runtimeTerminal", {
              done: unitCounts.done + unitCounts.excluded,
              total: unitCounts.total,
            })}
          </strong>
          {(
            [
              ["running", "metricRunning"],
              ["queued", "metricQueued"],
              ["waiting", "metricWaiting"],
              ["failed", "metricFailed"],
              ["excluded", "metricExcluded"],
            ] as const
          ).map(([key, label]) => (
            <span key={key} className="inline-flex items-center gap-1">
              <b className="font-medium text-text-secondary">{unitCounts[key]}</b>
              {t(`mission.${label}`)}
            </span>
          ))}
          <span>{t("mission.concurrencyNote", { concurrency: run.snapshot.settings.concurrency })}</span>
          {/* 演示流程可手动注入失败，现场体验恢复链路；真实引擎不提供该入口。 */}
          {unitCounts.running > 0 && usesOnlySimulatedCapabilities(run.snapshot) && (
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto"
              onClick={() => injectDemoFailure(run.id)}
            >
              {t("mission.demoFailureButton")}
            </Button>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {!draft || canvas.nodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
            <div className="mb-4 grid size-12 place-items-center rounded-xl bg-background-secondary-default text-title-2-medium text-text-tertiary">
              ⌘
            </div>
            <h2 className="text-title-3-medium text-text-secondary">
              {t("mission.canvasEmptyTitle")}
            </h2>
            <p className="mt-2 whitespace-pre-line text-body-2-regular text-text-tertiary">
              {t("mission.canvasEmptyDesc")}
            </p>
          </div>
        ) : (
          <ReactFlowProvider>
            <ReactFlow
              nodes={canvas.nodes}
              edges={canvas.edges}
              nodeTypes={MISSION_NODE_TYPES}
              onNodeClick={(_, node) => handleNodeClick(node)}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
              minZoom={0.15}
              maxZoom={1.8}
              proOptions={{ hideAttribution: true }}
              className="[&_.react-flow__node]:cursor-pointer [&_.react-flow__node]:!bg-transparent"
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={18}
                size={1}
                color="var(--color-border-button-default)"
              />
              <CanvasToolbar />
            </ReactFlow>
          </ReactFlowProvider>
        )}
        <NodeInspector />
      </div>

      <div className="flex min-h-8 shrink-0 items-center justify-between gap-3 border-t border-separator-border bg-background-primary-default px-4 py-1.5 text-caption-1-regular text-text-tertiary">
        <span>
              {mode === "run" && run
                ? t("mission.canvasFooterRun", {
                    tasks: run.tasks.length,
                    nodes: canvas.nodes.filter((node) => node.type !== "missionItem").length,
                  })
                : t("mission.canvasFooterDefinition", { count: canvas.nodes.length })}
        </span>
        <span>{t("mission.canvasPanHelp")}</span>
      </div>
    </div>
  );
}

function runStatusKey(run: NonNullable<ReturnType<typeof latestRunOf>>): string {
  const status = runStatus(run);
  return status[0].toUpperCase() + status.slice(1);
}

/** 画布工具条：缩放 / 全图 / 聚焦并行任务。 */
function CanvasToolbar() {
  const { t } = useTranslation();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const focusPool = useCallback(() => {
    const group = document.querySelector(".react-flow__node-missionGroup");
    if (!group) {
      void fitView({ padding: 0.2 });
      return;
    }
    const nodeId = (group as HTMLElement).getAttribute("data-id");
    if (!nodeId) {
      void fitView({ padding: 0.2 });
      return;
    }
    void fitView({ nodes: [{ id: nodeId }], padding: 0.25, maxZoom: 1.1, duration: 300 });
  }, [fitView]);
  return (
    <div className="absolute bottom-4 left-4 z-10 flex items-center gap-0.5 rounded-md border border-border-button-default bg-background-primary-default p-0.5 shadow-xs">
      <Button
        size="xs"
        variant="ghost"
        iconOnly
        leadingIcon={Minus}
        aria-label={t("mission.canvasZoomOut")}
        onClick={() => void zoomOut()}
      />
      <Button
        size="xs"
        variant="ghost"
        iconOnly
        leadingIcon={Plus}
        aria-label={t("mission.canvasZoomIn")}
        onClick={() => void zoomIn()}
      />
      <Button
        size="xs"
        variant="ghost"
        iconOnly
        leadingIcon={Scan}
        aria-label={t("mission.canvasFit")}
        onClick={() => void fitView({ padding: 0.2 })}
      />
      <Button
        size="xs"
        variant="ghost"
        iconOnly
        leadingIcon={Maximize}
        aria-label={t("mission.canvasFocusPool")}
        onClick={focusPool}
      />
    </div>
  );
}
