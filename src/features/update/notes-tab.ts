import { create } from "zustand";

/**
 * 版本更新说明的中心页签（原生单实例，开/关与激活语义同插件中心、
 * 任务工作台）。检测到新版本时 update store 自动打开并聚焦；页签关闭只收起
 * 这个面，更新状态本身仍在 update store（浮层提示照常给「立即更新」）。
 */

export const RELEASE_NOTES_TAB_KEY = "release-notes:latest";

interface ReleaseNotesTabState {
  /** 页签存在（保持挂载，可见性由 active 决定）。 */
  open: boolean;
  /** 该页签是否为当前中心面。 */
  active: boolean;
  /** 打开或聚焦说明页签。 */
  openTab: () => void;
  activate: () => void;
  deactivate: () => void;
  close: () => void;
}

export const useReleaseNotesTabStore = create<ReleaseNotesTabState>()((set, get) => ({
  open: false,
  active: false,

  openTab: () => set({ open: true, active: true }),
  activate: () => set({ active: true }),
  deactivate: () => {
    if (!get().active) return;
    set({ active: false });
  },
  close: () => set({ open: false, active: false }),
}));
