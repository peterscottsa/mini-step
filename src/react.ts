// React adapter — published as `minism/react`. React is an optional peer
// dependency; the core entry never imports it.

import { useCallback, useEffect, useReducer, useRef } from "react";
import { inDev } from "./env";
import type { ActionBase, Machine, StateBase } from "./types";

export type UseMachineResult<S extends StateBase, A extends ActionBase> = {
  state: S;
  /** Dispatch an action. Referentially stable for the lifetime of the hook. */
  send: (action: A) => void;
  /** The action types the current state allows. Stable per state. */
  allowed: () => A["type"][];
  /** Whether the current state allows the given action type. Stable per state. */
  can: (actionType: A["type"]) => boolean;
};

/**
 * Internal, deliberately widened view of the effects map — the hook-side
 * counterpart of the engine's `Table`. TypeScript cannot correlate
 * `state.step` with the slot it indexes (the correlated-union limitation), so
 * the hook widens once, here; the `Definition` type guarantees at authoring
 * time that every stored effect matches its step. `deps` is widened to
 * `D | undefined` for the same reason: the overload signatures guarantee it
 * is only omitted when `D` is `void`.
 */
type EffectTable<S extends StateBase, A extends ActionBase, D> =
  | Record<
      string,
      | ((state: S, deps: D | undefined, signal: AbortSignal) => Promise<A>)
      | undefined
    >
  | undefined;

/**
 * Run a machine in React.
 *
 * Transitions go through `useReducer(machine.advance)`. Entry effects run per
 * state entry — an entry is a state *object* returned by a transition, so a
 * self-update that returns a new object of the same step re-enters and
 * re-runs its effect. Each entry gets its own `AbortController`: leaving the
 * state (or unmounting) aborts it, and an action resolved by an aborted
 * effect is dropped, never dispatched. `machine` is expected to be a
 * module-level constant.
 */
export function useMachine<S extends StateBase, A extends ActionBase>(
  machine: Machine<S, A, void>,
): UseMachineResult<S, A>;
/**
 * Run a machine whose effects consume deps.
 *
 * Same contract as the deps-less overload, plus: `deps` may change identity
 * freely — a running effect keeps the deps it started with, and a new deps
 * object does not restart it; the next entry reads the latest.
 */
export function useMachine<S extends StateBase, A extends ActionBase, D>(
  machine: Machine<S, A, D>,
  deps: D,
): UseMachineResult<S, A>;
export function useMachine<S extends StateBase, A extends ActionBase, D>(
  machine: Machine<S, A, D>,
  deps?: D,
): UseMachineResult<S, A> {
  const [state, dispatch] = useReducer(machine.advance, machine.initial);

  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });

  const effects = machine.definition.effects as EffectTable<S, A, D>;

  useEffect(() => {
    const effect = effects?.[state.step];
    if (!effect) return;
    const controller = new AbortController();
    const { signal } = controller;
    effect(state, depsRef.current, signal).then(
      (action) => {
        if (!signal.aborted) dispatch(action);
      },
      (error: unknown) => {
        if (!signal.aborted && inDev()) {
          console.warn(
            `[minism] Effect for state "${state.step}" rejected — effects should map their errors to a failure action.`,
            error,
          );
        }
      },
    );
    return () => controller.abort();
  }, [effects, state]);

  const allowed = useCallback(() => machine.allowed(state), [machine, state]);
  const can = useCallback(
    (actionType: A["type"]) => machine.can(state, actionType),
    [machine, state],
  );

  return { state, send: dispatch, allowed, can };
}
