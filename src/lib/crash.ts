import { useSyncExternalStore } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isWeb } from "./transport";

/**
 * Crash capture — guarantees a broken app is explainable instead of a silent
 * white screen. Three producers feed one store:
 *
 *   - the top-level React error boundary (render / lifecycle errors),
 *   - the global `error` / `unhandledrejection` listeners below (async and
 *     event-handler errors React boundaries never see),
 *   - the boot watchdog in index.html (bundle failed to load, or a crash
 *     before React mounted) — it reads the same persisted report.
 *
 * Consumers are `CrashScreen` (full page, React) and the plain-DOM boot
 * fallback in index.html (used when React cannot render at all). Reports are
 * kept in an in-memory ring for diagnostics and mirrored to localStorage so
 * the next launch can explain a crash that happened before React mounted.
 */

export type CrashSource = "render" | "error" | "unhandledrejection" | "boot";

export interface CrashReport {
  id: number;
  source: CrashSource;
  message: string;
  stack?: string;
  componentStack?: string;
  time: string;
  appVersion?: string;
  userAgent: string;
}

/** Same key index.html's boot watchdog reads. Keep in sync. */
export const LAST_CRASH_STORAGE_KEY = "ccgui:last-crash";
const MAX_KEPT = 20;
/** De-dupe a burst of identical errors (e.g. one rejection loop). */
const DEDUPE_WINDOW_MS = 2000;

let seq = 0;
let appVersion: string | undefined;
let reports: CrashReport[] = [];
let latest: CrashReport | null = null;
let lastSignature = "";
let lastSignatureAt = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function normalize(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message || error.name || "Error", stack: error.stack };
  }
  if (typeof error === "string") return { message: error };
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

function currentUserAgent(): string {
  return typeof navigator === "undefined" ? "unknown" : navigator.userAgent;
}

/** Cached from bootstrap so reports carry the running version. */
export function setCrashAppVersion(version: string | null | undefined): void {
  if (version) appVersion = version;
}

/**
 * Build a report without publishing it. The React boundary uses this in the
 * static `getDerivedStateFromError`, which must stay side-effect free.
 */
export function createCrashReport(
  source: CrashSource,
  error: unknown,
  componentStack?: string,
): CrashReport {
  const { message, stack } = normalize(error);
  return {
    id: ++seq,
    source,
    message,
    stack,
    componentStack,
    time: new Date().toISOString(),
    appVersion,
    userAgent: currentUserAgent(),
  };
}

function persist(report: CrashReport): void {
  try {
    window.localStorage.setItem(LAST_CRASH_STORAGE_KEY, JSON.stringify(report));
  } catch {
    // Storage disabled/full: the in-memory report still reaches the UI.
  }
}

/** Record a report, mirror it to storage, and wake subscribers. */
export function publishCrash(report: CrashReport): void {
  const now = Date.now();
  const signature = `${report.source}:${report.message}`;
  if (signature === lastSignature && now - lastSignatureAt < DEDUPE_WINDOW_MS) return;
  lastSignature = signature;
  lastSignatureAt = now;

  reports = [...reports, report].slice(-MAX_KEPT);
  latest = report;
  persist(report);
  notify();
}

export function reportCrash(
  source: CrashSource,
  error: unknown,
  componentStack?: string,
): CrashReport {
  const report = createCrashReport(source, error, componentStack);
  publishCrash(report);
  return report;
}

/** Latest undismissed crash, or null. Stable ref for useSyncExternalStore. */
export function getCrashSnapshot(): CrashReport | null {
  return latest;
}

export function subscribeCrashes(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/** Hide the crash screen without clearing the diagnostic ring. */
export function dismissCrash(): void {
  if (!latest) return;
  latest = null;
  notify();
}

/** Drop the diagnostic ring and dedupe state (user "clear", or test setup). */
export function clearCrashReports(): void {
  reports = [];
  latest = null;
  lastSignature = "";
  lastSignatureAt = 0;
  notify();
}

/** All kept reports, oldest first — for diagnostics export. */
export function getCrashReports(): CrashReport[] {
  return reports;
}

export function useCrashReport(): CrashReport | null {
  return useSyncExternalStore(subscribeCrashes, getCrashSnapshot, getCrashSnapshot);
}

/** Human-readable dump for the "copy details" action. */
export function formatCrashReport(report: CrashReport): string {
  const lines = [
    "CC GUI crash report",
    `time:    ${report.time}`,
    `source:  ${report.source}`,
    `version: ${report.appVersion ?? "unknown"}`,
    `message: ${report.message}`,
  ];
  if (report.stack) lines.push("", "stack:", report.stack);
  if (report.componentStack) lines.push("", "component stack:", report.componentStack);
  lines.push("", `userAgent: ${report.userAgent}`);
  return lines.join("\n");
}

let installed = false;

/** Install window-level capture once. Idempotent. */
export function installGlobalCrashHandlers(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    // Resource load failures (img/script) surface as `error` events on the
    // element with no Error object — not app crashes; ignore them.
    if (!event.error && !event.message) return;
    reportCrash("error", event.error ?? event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportCrash("unhandledrejection", event.reason);
  });
}

/** Mark the app as successfully mounted for index.html's boot watchdog. */
export function markAppMounted(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.appMounted = "1";
}

export function isAppMounted(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.appMounted === "1";
}

export function reloadApp(): void {
  window.location.reload();
}

/** Quit the desktop app; no-op affordance on web (caller hides the button). */
export function quitApp(): void {
  if (isWeb) return;
  void getCurrentWindow().destroy().catch(() => {});
}
