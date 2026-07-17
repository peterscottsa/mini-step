/**
 * A file-publishing flow — the async fixture. Every waiting phase is a
 * visible, cancellable state with an entry effect; transitions themselves
 * never block. Effects map their own errors to a failure action, so the
 * transition table stays the only place that decides where the machine goes.
 */
import { defineSteps, defineMachine } from "../../src/index";

export type PublishState =
  | { step: "idle" }
  | { step: "checkingQuota"; size: number }
  | { step: "uploading"; size: number }
  | { step: "done"; url: string }
  | { step: "failed"; reason: string; retryable: boolean };

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

export const publishDefinition = defineSteps<
  PublishState,
  PublishAction,
  PublishDeps
>({
  initial: { step: "idle" },
  steps: {
    idle: {
      begin: (_state, action) => ({ step: "checkingQuota", size: action.size }),
    },
    checkingQuota: {
      quotaResolved: (state, action) =>
        action.sufficient
          ? { step: "uploading", size: state.size }
          : { step: "failed", reason: "Not enough space", retryable: false },
      cancel: () => ({ step: "idle" }),
    },
    uploading: {
      uploadSucceeded: (_state, action) => ({ step: "done", url: action.url }),
      uploadFailed: (_state, action) => ({
        step: "failed",
        reason: action.message,
        retryable: true,
      }),
      cancel: () => ({ step: "idle" }),
    },
    failed: {
      retry: () => ({ step: "idle" }),
      cancel: () => ({ step: "idle" }),
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
