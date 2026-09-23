import { useTranslation } from "react-i18next";
import Archive from "lucide-react/dist/esm/icons/archive";
import ArchiveRestore from "lucide-react/dist/esm/icons/archive-restore";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus";
import GitBranchPlus from "lucide-react/dist/esm/icons/git-branch-plus";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { ContextMenu, type ContextMenuEntry } from "@/components/context-menu";
import { useChatStore } from "@/features/chat/store";
import { useWorktreeStore } from "@/features/worktree/store";
import { ipc, worktreeMetaOf } from "@/lib/ipc";

export interface WorkspaceMenuState {
  x: number;
  y: number;
  workspaceId: string;
  /** Row lives in the 已归档 section: the archive entry flips to 取消归档. */
  archived: boolean;
}

export interface BlankMenuState {
  x: number;
  y: number;
}

/**
 * Right-click menu for sidebar workspace rows. Chrome (portal anchoring,
 * viewport clamping, Escape/outside dismissal) comes from the shared
 * ContextMenu; this component only owns the workspace action entries.
 */
export function WorkspaceContextMenu({
  menu,
  onClose,
  onSetAlias,
  onSetArchived,
  onNewWorktree,
  onDeleteWorktree,
}: {
  menu: WorkspaceMenuState;
  onClose: () => void;
  onSetAlias?: (workspaceId: string) => void;
  onSetArchived?: (workspaceId: string, archived: boolean) => void;
  onNewWorktree?: (workspaceId: string) => void;
  onDeleteWorktree?: (workspaceId: string) => void;
}) {
  const { t } = useTranslation();
  // Worktree 子行与普通行共用此菜单：worktree 行多出「在访达中显示」
  // 与「删除 Worktree…」，隐藏归档（子行不支持归档/分组/拖拽）。
  const workspace = useChatStore((s) => s.workspaces.find((w) => w.id === menu.workspaceId));
  const isWorktree = workspace != null && (worktreeMetaOf(workspace) != null || workspace.parentId != null);
  // git 层面 locked 的 worktree 禁删（原因进 title，不谎报可点）。
  const lockReason = useWorktreeStore((s) =>
    workspace ? s.lockedPaths[workspace.path] : undefined,
  );

  const entries: (ContextMenuEntry | "separator")[] = [];
  if (onNewWorktree && workspace) {
    entries.push({
      id: "new-worktree",
      label: t("worktree.newWorktree"),
      icon: <GitBranchPlus className="size-4" aria-hidden />,
      onSelect: () => onNewWorktree(menu.workspaceId),
    });
  }
  if (onSetAlias) {
    entries.push({
      id: "set-alias",
      label: t("chat.setWorkspaceAlias"),
      icon: <Pencil className="size-4" aria-hidden />,
      onSelect: () => onSetAlias(menu.workspaceId),
    });
  }
  if (isWorktree && workspace) {
    const isMac = navigator.platform.includes("Mac");
    const isWindows = navigator.platform.includes("Win");
    entries.push({
      id: "reveal-worktree",
      label: isMac
        ? t("files.revealInFinder")
        : isWindows
          ? t("files.revealInExplorer")
          : t("files.revealInFileManager"),
      icon: <FolderOpen className="size-4" aria-hidden />,
      onSelect: () => void ipc.revealInFileManager(workspace.path).catch(() => undefined),
    });
    if (onDeleteWorktree) {
      entries.push("separator");
      entries.push({
        id: "delete-worktree",
        label: t("worktree.deleteWorktree"),
        icon: <Trash2 className="size-4" aria-hidden />,
        danger: true,
        disabled: lockReason !== undefined,
        title:
          lockReason !== undefined
            ? lockReason || t("worktree.lockedDeleteDisabled")
            : undefined,
        onSelect: () => onDeleteWorktree(menu.workspaceId),
      });
    }
  }
  if (onSetArchived && !isWorktree) {
    entries.push({
      id: "toggle-archive",
      label: menu.archived ? t("chat.unarchiveWorkspace") : t("chat.archiveWorkspace"),
      icon: menu.archived ? (
        <ArchiveRestore className="size-4" aria-hidden />
      ) : (
        <Archive className="size-4" aria-hidden />
      ),
      onSelect: () => onSetArchived(menu.workspaceId, !menu.archived),
    });
  }

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      ariaLabel={menu.workspaceId}
      entries={entries}
      onClose={onClose}
    />
  );
}

/**
 * Right-click menu for the workspace section's blank area: create a group
 * without a trip to Settings → 工作区. Selecting the entry opens the
 * sidebar's inline name composer (owned by the sidebar component).
 */
export function WorkspaceBlankContextMenu({
  menu,
  onClose,
  onCreateGroup,
}: {
  menu: BlankMenuState;
  onClose: () => void;
  onCreateGroup?: () => void;
}) {
  const { t } = useTranslation();

  const entries: ContextMenuEntry[] = [];
  if (onCreateGroup) {
    entries.push({
      id: "create-group",
      label: t("chat.newGroup"),
      icon: <FolderPlus className="size-4" aria-hidden />,
      onSelect: onCreateGroup,
    });
  }

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      ariaLabel={t("chat.workspaces")}
      entries={entries}
      onClose={onClose}
    />
  );
}
