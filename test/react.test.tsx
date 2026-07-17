// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createState, defineMachine, guarded } from "../src/index";
import { useMachine } from "../src/react";
import { publishMachine } from "./fixtures/publish";
import type { PublishDeps } from "./fixtures/publish";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeDeps() {
  const quota = deferred<boolean>();
  const upload = deferred<{ url: string }>();
  const signals: AbortSignal[] = [];
  const deps: PublishDeps = {
    hasQuota: vi.fn(() => quota.promise),
    upload: vi.fn((_size: number, signal: AbortSignal) => {
      signals.push(signal);
      return upload.promise;
    }),
  };
  return { deps, quota, upload, signals };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useMachine", () => {
  it("walks the happy path: each waiting state runs its effect and advances", async () => {
    const { deps, quota, upload } = makeDeps();
    const { result } = renderHook(() => useMachine(publishMachine, deps));

    expect(result.current.state).toEqual({ step: "idle" });

    act(() => result.current.send({ type: "begin", size: 512 }));
    expect(result.current.state).toEqual({ step: "checkingQuota", size: 512 });
    expect(deps.hasQuota).toHaveBeenCalledExactlyOnceWith(512);

    await act(async () => quota.resolve(true));
    expect(result.current.state).toEqual({ step: "uploading", size: 512 });

    await act(async () => upload.resolve({ url: "https://cdn.example/f/512" }));
    expect(result.current.state).toEqual({
      step: "done",
      url: "https://cdn.example/f/512",
    });
  });

  it("routes an insufficient quota to failed without ever uploading", async () => {
    const { deps, quota } = makeDeps();
    const { result } = renderHook(() => useMachine(publishMachine, deps));

    act(() => result.current.send({ type: "begin", size: 512 }));
    await act(async () => quota.resolve(false));

    expect(result.current.state).toEqual({
      step: "failed",
      reason: "Not enough space",
      retryable: false,
    });
    expect(deps.upload).not.toHaveBeenCalled();
  });

  it("drops the resolved action of an effect whose state was left", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { deps, quota } = makeDeps();
    const { result } = renderHook(() => useMachine(publishMachine, deps));

    act(() => result.current.send({ type: "begin", size: 512 }));
    act(() => result.current.send({ type: "cancel" }));
    expect(result.current.state).toEqual({ step: "idle" });

    await act(async () => quota.resolve(true));
    expect(result.current.state).toEqual({ step: "idle" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("aborts the entry's signal when the state is left", async () => {
    const { deps, quota, signals } = makeDeps();
    const { result } = renderHook(() => useMachine(publishMachine, deps));

    act(() => result.current.send({ type: "begin", size: 512 }));
    await act(async () => quota.resolve(true));
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    act(() => result.current.send({ type: "cancel" }));
    expect(signals[0]?.aborted).toBe(true);
  });

  it("keeps the deps a running effect started with", async () => {
    const first = makeDeps();
    const second = makeDeps();
    const { result, rerender } = renderHook(
      ({ deps }: { deps: PublishDeps }) => useMachine(publishMachine, deps),
      { initialProps: { deps: first.deps } },
    );

    act(() => result.current.send({ type: "begin", size: 512 }));
    rerender({ deps: second.deps });

    await act(async () => first.quota.resolve(true));
    expect(result.current.state).toEqual({ step: "uploading", size: 512 });
    expect(first.deps.hasQuota).toHaveBeenCalledOnce();
    expect(second.deps.hasQuota).not.toHaveBeenCalled();
    // The next entry picks up the latest deps.
    expect(second.deps.upload).toHaveBeenCalledOnce();
    expect(first.deps.upload).not.toHaveBeenCalled();
  });

  it("keeps send referentially stable across state changes", () => {
    const { deps } = makeDeps();
    const { result } = renderHook(() => useMachine(publishMachine, deps));
    const initialSend = result.current.send;

    act(() => result.current.send({ type: "begin", size: 1 }));
    expect(result.current.send).toBe(initialSend);
  });

  it("answers allowed and can for the current state", () => {
    const { deps } = makeDeps();
    const { result } = renderHook(() => useMachine(publishMachine, deps));

    expect(result.current.allowed()).toEqual(["begin"]);
    expect(result.current.can("cancel")).toBe(false);

    act(() => result.current.send({ type: "begin", size: 1 }));
    expect(result.current.allowed().sort()).toEqual(["cancel", "quotaResolved"]);
    expect(result.current.can("cancel")).toBe(true);
  });

  it("reflects guards through allowed/can and no-ops a declined send", () => {
    type CountState = { step: "counting"; n: number };
    type CountAction = { type: "increment" };
    const capped = defineMachine(
      createState<CountState, CountAction>({
        initial: { step: "counting", n: 0 },
        states: {
          counting: {
            increment: guarded(
              (state: CountState) => state.n < 2,
              (state: CountState): CountState => ({ step: "counting", n: state.n + 1 }),
            ),
          },
        },
      }),
    );

    const { result } = renderHook(() => useMachine(capped));
    expect(result.current.can("increment")).toBe(true);

    act(() => result.current.send({ type: "increment" }));
    act(() => result.current.send({ type: "increment" }));
    expect(result.current.state).toEqual({ step: "counting", n: 2 });
    expect(result.current.can("increment")).toBe(false);
    expect(result.current.allowed()).toEqual([]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    act(() => result.current.send({ type: "increment" }));
    expect(result.current.state).toEqual({ step: "counting", n: 2 });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("dev-warns and stays put when an effect rejects instead of mapping its error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    type S = { step: "loading" } | { step: "loaded" };
    type A = { type: "finish" };
    const rejecting = defineMachine(
      createState<S, A>({
        initial: { step: "loading" },
        states: { loading: { finish: () => ({ step: "loaded" }) }, loaded: {} },
        effects: {
          loading: () => Promise.reject(new Error("boom")),
        },
      }),
    );

    const { result } = renderHook(() => useMachine(rejecting));
    await act(async () => {});

    expect(result.current.state).toEqual({ step: "loading" });
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('Effect for state "loading" rejected');
  });

  it("survives StrictMode: the doubled mount effect is aborted, one transition lands", async () => {
    type S = { step: "loading" } | { step: "loaded"; value: number };
    type A = { type: "finish"; value: number };
    const runs: AbortSignal[] = [];
    const strict = defineMachine(
      createState<S, A>({
        initial: { step: "loading" },
        states: {
          loading: {
            finish: (_state, action) => ({ step: "loaded", value: action.value }),
          },
          loaded: {},
        },
        effects: {
          loading: async (_state, _deps, signal) => {
            runs.push(signal);
            return { type: "finish", value: runs.length };
          },
        },
      }),
    );

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useMachine(strict), { wrapper: StrictMode });
    await act(async () => {});

    // StrictMode mounts twice: the first entry's effect is aborted before it
    // resolves, so only the second one's action lands (value: 2). Exactly one
    // transition, no illegal-action warning from a duplicate dispatch. (The
    // second signal also ends up aborted — leaving `loading` for `loaded`
    // aborts that entry's controller, which is the contract.)
    expect(runs).toHaveLength(2);
    expect(runs[0]?.aborted).toBe(true);
    expect(result.current.state).toEqual({ step: "loaded", value: 2 });
    expect(warn).not.toHaveBeenCalled();
  });
});
