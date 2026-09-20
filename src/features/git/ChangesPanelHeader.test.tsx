import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn<(workspacePath: string, force?: boolean) => Promise<void>>(),
  errors: {} as Record<string, string | null>,
  notRepo: {} as Record<string, boolean>,
}));

// Only the header's refresh feedback touches the store; pull/push/branches
// stay unused in these tests.
vi.mock("./store", () => ({
  useGitStore: {
    getState: () => ({
      refresh: mocks.refresh,
      errorByWorkspace: mocks.errors,
      notRepoByWorkspace: mocks.notRepo,
    }),
  },
}));

import "@/lib/i18n";
import { ChangesPanelHeader } from "./ChangesPanelHeader";

// React 18's act() requires this flag to be set by the test environment.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const WS = "/repo";

describe("ChangesPanelHeader refresh feedback", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.refresh.mockReset();
    for (const key of Object.keys(mocks.errors)) delete mocks.errors[key];
    for (const key of Object.keys(mocks.notRepo)) delete mocks.notRepo[key];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
  });

  afterEach(async () => {
    if (root) {
      const current = root;
      await act(async () => current.unmount());
    }
    container.remove();
    vi.useRealTimers();
  });

  async function render() {
    const nextRoot = createRoot(container);
    root = nextRoot;
    await act(async () => {
      nextRoot.render(
        <ChangesPanelHeader
          workspacePath={WS}
          notRepo={false}
          branch="main"
          ahead={0}
          behind={0}
          branches={[]}
          pending={{}}
          error={null}
          run={(_key, action) => {
            void action().catch(() => undefined);
          }}
          onDismissError={() => undefined}
        />,
      );
    });
  }

  function refreshButton() {
    return container.querySelector<HTMLButtonElement>('button[aria-label="刷新"]')!;
  }

  function visibleCheck() {
    // The check stays mounted and cross-fades; visibility is its classes.
    return container.querySelector(".lucide-check.opacity-100");
  }

  function arrowRestored() {
    const arrow = container.querySelector(".lucide-refresh-cw");
    return arrow?.parentElement?.className.includes("opacity-100") === true;
  }

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("spins, flashes a check on success, then returns to the arrow", async () => {
    const pending = deferred();
    mocks.refresh.mockReturnValue(pending.promise);
    await render();

    act(() => refreshButton().click());
    expect(container.querySelector(".animate-refresh-spin")).not.toBeNull();
    expect(visibleCheck()).toBeNull();

    // The swap waits out the rest of the ~600ms lap even when the refresh
    // resolves instantly, so the arrow finishes an upright turn.
    await act(async () => pending.resolve());
    act(() => vi.advanceTimersByTime(500));
    expect(visibleCheck()).toBeNull();
    expect(container.querySelector(".animate-refresh-spin")).not.toBeNull();

    act(() => vi.advanceTimersByTime(200));
    expect(visibleCheck()).not.toBeNull();
    expect(container.querySelector(".animate-refresh-spin")).toBeNull();

    // The check dwells ~900ms, then the arrow returns.
    act(() => vi.advanceTimersByTime(1000));
    expect(visibleCheck()).toBeNull();
    expect(arrowRestored()).toBe(true);
  });

  it("returns to the arrow without a check when the refresh fails", async () => {
    const pending = deferred();
    mocks.refresh.mockReturnValue(pending.promise);
    await render();

    act(() => refreshButton().click());
    expect(container.querySelector(".animate-refresh-spin")).not.toBeNull();

    await act(async () => {
      mocks.errors[WS] = "boom";
      pending.resolve();
    });
    act(() => vi.advanceTimersByTime(700));
    expect(visibleCheck()).toBeNull();
    expect(container.querySelector(".animate-refresh-spin")).toBeNull();
    expect(arrowRestored()).toBe(true);
  });
});
