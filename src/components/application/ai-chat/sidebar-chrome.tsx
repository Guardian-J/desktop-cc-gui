"use client";

import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import Globe from "lucide-react/dist/esm/icons/globe";
import MessageSquarePlus from "lucide-react/dist/esm/icons/message-square-plus";
import PanelLeft from "lucide-react/dist/esm/icons/panel-left";
import ScanSearch from "lucide-react/dist/esm/icons/scan-search";
import Settings from "lucide-react/dist/esm/icons/settings";
import {
  WorkspaceBlankContextMenu,
  WorkspaceContextMenu,
  type BlankMenuState,
  type WorkspaceMenuState,
} from "@/components/application/ai-chat/workspace-context-menu";
import {
  ThreadContextMenu,
  type ThreadMenuState,
} from "@/components/application/ai-chat/thread-context-menu";
import type { ThreadAction } from "@/components/application/ai-chat/sidebar-types";
import { cx } from "@/utils/cx";
import { needsWindowControls, useTitlebarStyle } from "@/features/settings/titlebar";
import { WindowControls } from "@/components/application/window-controls";
import { useRemoteControl } from "@/hooks/use-remote-control";

type IconComponent = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

/** Shared look for the icon buttons in the window drag strip. */
const headerButtonClasses = cx(
  "flex size-7 cursor-pointer items-center justify-center rounded-lg transition-colors duration-150",
  "text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary",
);

/** Top-level nav row — icon + label, p 8, radius/2lg. */
function NavItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: IconComponent;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cx(
        "flex w-full cursor-pointer items-center gap-2 rounded-2lg p-2 transition-colors duration-150 ease",
        "hover:bg-background-secondary-hover",
      )}
    >
      <Icon className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
      <span className="text-body-2-medium whitespace-nowrap text-text-secondary">{label}</span>
    </button>
  );
}

/** Icon button opening the session search palette (⌘L); shared by the drag
 *  strip and the flat variant's brand row. */
function SearchPaletteButton({ onOpen }: { onOpen?: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-label={t("chat.searchSessions")}
      title={t("chat.searchSessions")}
      onClick={onOpen}
      className={headerButtonClasses}
    >
      <ScanSearch className="size-4" aria-hidden />
    </button>
  );
}

/** Window drag strip reaching the overlay titlebar: macOS traffic lights
 *  float over its left edge, action icons pin right. Windows 仿 mac 模式在
 *  这里放自绘三色按钮。 */
export function SidebarDragStrip({
  onClose,
  onOpenSearch,
}: {
  onClose?: () => void;
  onOpenSearch?: () => void;
}) {
  const { t } = useTranslation();
  const titlebarStyle = useTitlebarStyle();
  return (
    <div
      data-tauri-drag-region
      className="flex h-10 w-full shrink-0 items-center justify-between gap-1 border-b border-separator-border px-3"
    >
      <div className="flex min-w-0 items-center">
        {needsWindowControls(titlebarStyle) && <WindowControls />}
      </div>
      <div className="flex items-center gap-1">
        <SearchPaletteButton onOpen={onOpenSearch} />
        <button
          type="button"
          aria-label={t("chat.collapseSidebar")}
          title={t("chat.collapseSidebar")}
          onClick={onClose}
          className={headerButtonClasses}
        >
          <PanelLeft className="size-4 -scale-x-100" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** App identity row (flat/embedded variant only). */
export function SidebarBrandRow({ onOpenSearch }: { onOpenSearch?: () => void }) {
  return (
    <div className="flex w-full flex-row items-center justify-between">
      <span className="flex items-center gap-2 px-1">
        <img src="/app-icon.png" alt="CC GUI" className="size-7 rounded-lg" />
        <span className="text-headline-medium text-text-primary">CC GUI</span>
      </span>
      <SearchPaletteButton onOpen={onOpenSearch} />
    </div>
  );
}

/** Primary actions: 新建会话/浏览器 (会话搜索在顶栏图标 + ⌘L 弹窗). */
export function SidebarPrimaryNav({
  onNewSession,
  onNewBrowser,
}: {
  onNewSession?: () => void;
  onNewBrowser?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <nav className="flex w-full shrink-0 flex-col gap-1">
      <NavItem icon={MessageSquarePlus} label={t("chat.newSession")} onClick={onNewSession} />
      {onNewBrowser && (
        <NavItem icon={Globe} label={t("chat.newBrowser")} onClick={onNewBrowser} />
      )}
    </nav>
  );
}

/** Secondary nav (设置) with the floating web-remote badge. The badge is
 *  floating, not laid out: it covers the empty half of the row (设置 keeps
 *  its full width and hover) and lets clicks through. */
export function SidebarFooter({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { t } = useTranslation();
  const remoteActive = useRemoteControl();
  return (
    <div className="flex w-full shrink-0 flex-col gap-3 px-3 pb-3">
      <div className="relative flex w-full items-center">
        <nav className="flex w-full flex-col gap-1">
          <NavItem icon={Settings} label={t("settings.title")} onClick={onOpenSettings} />
        </nav>
        {remoteActive && (
          <div
            title={t("settings.webRemoteActive")}
            className="pointer-events-none absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-full bg-button-primary px-2.5 py-1 shadow-xs"
          >
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-text-white" />
            <span className="text-body-2-medium whitespace-nowrap text-text-white">
              {t("settings.webRemoteActive")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Workspace, thread, and blank-area right-click menus; each mounts only
 *  while its state is open and at least one entry has a handler. */
export function SidebarContextMenus({
  workspaceMenu,
  threadMenu,
  blankMenu,
  onCloseWorkspaceMenu,
  onCloseThreadMenu,
  onCloseBlankMenu,
  onWorkspaceAlias,
  onSetWorkspaceArchived,
  onCreateGroup,
  onThreadAction,
  onCopyThreadId,
}: {
  workspaceMenu: WorkspaceMenuState | null;
  threadMenu: ThreadMenuState | null;
  blankMenu: BlankMenuState | null;
  onCloseWorkspaceMenu: () => void;
  onCloseThreadMenu: () => void;
  onCloseBlankMenu: () => void;
  onWorkspaceAlias?: (id: string) => void;
  onSetWorkspaceArchived?: (id: string, archived: boolean) => void;
  onCreateGroup?: () => void;
  onThreadAction?: (id: string, action: ThreadAction) => void;
  onCopyThreadId?: (id: string) => void;
}) {
  return (
    <>
      {workspaceMenu && (onWorkspaceAlias || onSetWorkspaceArchived) && (
        <WorkspaceContextMenu
          menu={workspaceMenu}
          onClose={onCloseWorkspaceMenu}
          onSetAlias={onWorkspaceAlias}
          onSetArchived={onSetWorkspaceArchived}
        />
      )}
      {blankMenu && onCreateGroup && (
        <WorkspaceBlankContextMenu
          menu={blankMenu}
          onClose={onCloseBlankMenu}
          onCreateGroup={onCreateGroup}
        />
      )}
      {threadMenu && (onThreadAction || onCopyThreadId) && (
        <ThreadContextMenu
          menu={threadMenu}
          onClose={onCloseThreadMenu}
          onThreadAction={onThreadAction}
          onCopyId={onCopyThreadId}
        />
      )}
    </>
  );
}
