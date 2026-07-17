/**
 * A file-publishing flow — the async fixture. Every waiting phase is a
 * visible, cancellable state with an entry effect; transitions themselves
 * never block. Effects map their own errors to a failure action, so the
 * transition table stays the only place that decides where the machine goes.
 */
import { createState, defineMachine } from "../../src/index";

export type PublishState =
  | { kind: "idle" }
  | { kind: "checkingQuota"; size: number }
  | { kind: "uploading"; size: number }
  | { kind: "done"; url: string }
  | { kind: "failed"; reason: string; retryable: boolean };

export type PublishAction =
  | { type: "begin"; size: number }
  | { type: "quotaResolved"; sufficient: boolean }
  | { type: "uploadSucceeded"; url: string }
  | { type: "uploadFailed"; message: string }
  | { type: "retry" }
  | { type: "cancel" };

export type PublishDeps = {
  hasQuota: (size: number) => Promise<boolean>;
  upload: (size: number, signal: AbortSignal) => Promise<{ url: string }>;
};

export const publishDefinition = createState<
  PublishState,
  PublishAction,
  PublishDeps
>({
  initial: { kind: "idle" },
  states: {
    idle: {
      begin: (_state, action) => ({ kind: "checkingQuota", size: action.size }),
    },
    checkingQuota: {
      quotaResolved: (state, action) =>
        action.sufficient
          ? { kind: "uploading", size: state.size }
          : { kind: "failed", reason: "Not enough space", retryable: false },
      cancel: () => ({ kind: "idle" }),
    },
    uploading: {
      uploadSucceeded: (_state, action) => ({ kind: "done", url: action.url }),
      uploadFailed: (_state, action) => ({
        kind: "failed",
        reason: action.message,
        retryable: true,
      }),
      cancel: () => ({ kind: "idle" }),
    },
    failed: {
      retry: () => ({ kind: "idle" }),
      cancel: () => ({ kind: "idle" }),
    },
    done: {},
  },
  effects: {
    checkingQuota: async (state, deps) => ({
      type: "quotaResolved",
      sufficient: await deps.hasQuota(state.size),
    }),
    uploading: async (state, deps, signal) => {
      try {
        const { url } = await deps.upload(state.size, signal);
        return { type: "uploadSucceeded", url };
      } catch (error) {
        return { type: "uploadFailed", message: String(error) };
      }
    },
  },
});

export const publishMachine = defineMachine(publishDefinition);
