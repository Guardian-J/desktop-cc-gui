import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import i18n from "./lib/i18n";
import { ipc } from "./lib/ipc";
import { applyTheme, THEME_STORAGE_KEY } from "./features/settings/theme";
import { hydrateBetaFeatures } from "./features/settings/beta-features";

// Apply the locally cached theme synchronously, before first paint, so the
// window never flashes the wrong color scheme while settings load.
const cachedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
if (cachedTheme) applyTheme(cachedTheme);

// Kick off the authoritative settings fetch at module scope (shared cached
// promise in ipc.ts); apply theme/language as soon as it resolves. Rendering
// is not blocked on this.
void ipc
  .getAppSettings()
  .then((settings) => {
    applyTheme(settings.theme);
    if (settings.language && settings.language !== i18n.language) {
      void i18n.changeLanguage(settings.language);
    }
  })
  .catch(() => {});

// 内测入口（设置 → 其他 → 内测功能）决定侧栏和页签条是否渲染，随启动设置
// 一起水合（共用同一个缓存的 settings promise）。
void hydrateBetaFeatures();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
// Analytics stays off the cold-start critical path: install after first paint
// via dynamic import. setTimeout (not requestIdleCallback) because older
// WebKitGTK lacks it. The install itself no-ops outside production.
window.setTimeout(() => {
  void import("./lib/analytics")
    .then(({ installBaiduTongji }) => installBaiduTongji())
    .catch((error) => {
      console.warn(
        "[analytics] deferred Baidu Tongji install failed",
        error instanceof Error ? error.message : String(error),
      );
    });
}, 3000);
