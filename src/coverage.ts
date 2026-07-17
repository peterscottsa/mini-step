import type { ActionBase, Definition, Machine, StateBase } from "./types";

/**
 * Action coverage.
 *
 * The `Definition` type forces every *state* to be present, but a forgotten
 * *action within a state* is a runtime no-op (dev-warned), not a compile
 * error. These two helpers close that gap, each from one side:
 *
 * - `assertCoverage` — the default: one line in a test, clear failure message.
 * - `createStrictState` — opt-in compile-time enforcement, at the cost of a
 *   two-step call and a more cryptic type error.
 */

/**
 * Compile-time completeness check for the `allActionTypes` argument: if the
 * list misses a member of the action union, the parameter type collapses to a
 * message tuple naming the missing types, and the call does not compile. This
 * protects the runtime check from being silently weakened by a stale list.
 */
type CompleteList<A extends ActionBase, L extends readonly A["type"][]> = [
  A["type"],
] extends [L[number]]
  ? unknown
  : ["allActionTypes is missing:", Exclude<A["type"], L[number]>];

/**
 * Assert that every action type is handled by at least one state. Call it
 * once in a test:
 *
 * ```ts
 * assertCoverage(flowMachine, ["goHome", "viewList", ...]);
 * ```
 *
 * Throws with the uncovered action types listed. The list itself is
 * compile-checked to be complete (types are erased at runtime, so the caller
 * must supply it once).
 *
 * Note the check is "handled *somewhere*" — transition targets are opaque
 * functions, so reachability analysis is out of scope by construction.
 */
export function assertCoverage<
  S extends StateBase,
  A extends ActionBase,
  D,
  const L extends readonly A["type"][],
>(machine: Machine<S, A, D>, allActionTypes: L & CompleteList<A, L>): void {
  const handled = new Set<string>();
  for (const handlers of Object.values<object>(machine.definition.states)) {
    for (const actionType of Object.keys(handlers)) {
      handled.add(actionType);
    }
  }
  const missing = [...new Set<string>(allActionTypes)].filter(
    (actionType) => !handled.has(actionType),
  );
  if (missing.length > 0) {
    throw new Error(
      `[mini-step] Uncovered action types: ${missing
        .map((actionType) => `"${actionType}"`)
        .join(", ")} — no state handles them.`,
    );
  }
}

/** The union of action types handled by at least one state of `Def`. */
type HandledActionTypes<Def extends { states: Record<string, unknown> }> = {
  [K in keyof Def["states"]]: keyof Def["states"][K];
}[keyof Def["states"]];

/**
 * Compile-time coverage check for a definition: if some member of the action
 * union is handled by no state, the parameter type collapses to a message
 * tuple naming the unhandled types, and the call does not compile.
 */
type FullyHandled<
  A extends ActionBase,
  Def extends { states: Record<string, unknown> },
> = [A["type"]] extends [HandledActionTypes<Def>]
  ? unknown
  : ["unhandled action types:", Exclude<A["type"], HandledActionTypes<Def>>];

/**
 * The strict, opt-in variant of `createState`: identical at runtime, but the
 * definition only compiles if every action type is handled by at least one
 * state.
 *
 * The call is two-step — `createStrictState<State, Action, Deps>()({ ... })` —
 * because the type parameters must be pinned explicitly while the definition
 * literal is inferred (TypeScript has no partial type-argument inference).
 * Prefer `createState` plus an `assertCoverage` test unless you want the
 * build itself to fail on an unhandled action.
 */
export function createStrictState<
  S extends StateBase,
  A extends ActionBase,
  D = void,
>() {
  // Returns the pinned `Definition<S, A, D>`, not the inferred `Def`: the
  // literal type mentions only the states it happens to name, and returning
  // it would make downstream `defineMachine` inference collapse `S` to
  // `initial`'s member instead of the full union.
  return <Def extends Definition<S, A, D>>(
    definition: Def & FullyHandled<A, Def>,
  ): Definition<S, A, D> => definition;
}
