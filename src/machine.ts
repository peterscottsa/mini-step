import { inDev } from "./env";
import type { ActionBase, Definition, Machine, StateBase } from "./types";

/**
 * Author a machine graph. Runtime identity — it exists to pin the three type
 * parameters in one place so every handler slot in the definition literal is
 * narrowed to its exact (state kind, action type) pair.
 */
export function createState<
  S extends StateBase,
  A extends ActionBase,
  D = void,
>(definition: Definition<S, A, D>): Definition<S, A, D> {
  return definition;
}

/**
 * Internal, deliberately widened view of the states map. TypeScript cannot
 * correlate `state.kind` with the map key it came from (the correlated-union
 * limitation), so the engine goes through this cast; the `Definition` type
 * guarantees by construction that every stored handler matches its slot.
 */
type Table<S extends StateBase, A extends ActionBase> = Record<
  string,
  Record<string, ((state: S, action: A) => S) | undefined> | undefined
>;

/**
 * Compile a definition into the runnable engine. Pure and framework-free:
 * `advance` is a plain reducer, so it unit-tests without any host.
 */
export function defineMachine<
  S extends StateBase,
  A extends ActionBase,
  D = void,
>(definition: Definition<S, A, D>): Machine<S, A, D> {
  const table = definition.states as Table<S, A>;

  const advance = (state: S, action: A): S => {
    const handler = table[state.kind]?.[action.type];
    if (!handler) {
      if (inDev()) {
        console.warn(
          `[minism] Action "${action.type}" is not allowed in state "${state.kind}" — ignored.`,
        );
      }
      return state;
    }
    return handler(state, action);
  };

  // `Object.keys` is typed `string[]`; these keys are `A["type"]` by
  // construction, since `HandlerMap` admits no other property names.
  const allowed = (state: S): A["type"][] =>
    Object.keys(table[state.kind] ?? {}) as A["type"][];

  const can = (state: S, actionType: A["type"]): boolean =>
    table[state.kind]?.[actionType] !== undefined;

  return { initial: definition.initial, advance, allowed, can, definition };
}
