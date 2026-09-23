import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCrashReports,
  createCrashReport,
  dismissCrash,
  formatCrashReport,
  getCrashReports,
  getCrashSnapshot,
  LAST_CRASH_STORAGE_KEY,
  reportCrash,
  setCrashAppVersion,
  subscribeCrashes,
} from "./crash";

describe("crash store", () => {
  beforeEach(() => {
    localStorage.clear();
    setCrashAppVersion(undefined);
    clearCrashReports();
  });

  it("normalizes an Error and persists the latest report", () => {
    setCrashAppVersion("1.2.3");
    const report = reportCrash("render", new Error("boom"));

    expect(report.message).toBe("boom");
    expect(report.source).toBe("render");
    expect(report.appVersion).toBe("1.2.3");
    expect(getCrashSnapshot()?.id).toBe(report.id);

    const persisted = JSON.parse(localStorage.getItem(LAST_CRASH_STORAGE_KEY)!);
    expect(persisted.message).toBe("boom");
    expect(persisted.source).toBe("render");
  });

  it("accepts non-Error values", () => {
    expect(reportCrash("unhandledrejection", "plain reason").message).toBe("plain reason");
    expect(reportCrash("error", { code: 7 }).message).toBe('{"code":7}');
  });

  it("notifies subscribers and clears on dismiss without dropping history", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCrashes(listener);

    reportCrash("error", new Error("first"));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getCrashReports()).toHaveLength(1);

    dismissCrash();
    expect(getCrashSnapshot()).toBeNull();
    // Dismiss hides the screen; the diagnostic ring keeps the report.
    expect(getCrashReports()).toHaveLength(1);
    unsubscribe();
  });

  it("de-dupes an identical burst", () => {
    reportCrash("error", new Error("same"));
    reportCrash("error", new Error("same"));
    expect(getCrashReports()).toHaveLength(1);
  });

  it("formats a report for copying", () => {
    const report = createCrashReport("render", new Error("kaput"));
    report.stack = "Error: kaput\n    at x";
    const text = formatCrashReport(report);
    expect(text).toContain("source:  render");
    expect(text).toContain("message: kaput");
    expect(text).toContain("at x");
  });
});
