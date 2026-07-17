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
 * Author a guarded transition slot: `handle` runs only while `guard(state)`
 * returns true; otherwise the action is declined — a dev-warned no-op that
 * returns the same state reference, exactly like an unlisted action.
 *
 * Guards take state only, and must be pure and cheap: `allowed()` and `can()`
 * evaluate them on every call, which is what keeps both truthful for UI
 * enable/disable. A rejection that depends on the action payload belongs in
 * the handler instead — it has the payload and can branch to a failure state.
 *
 * Like plain handlers, guarded slots travel inside shared groups: annotate
 * the parameters with the widest state union the slot is valid for.
 */
export function guarded<St, Ac, S extends StateBase>(
  guard: (state: St) => boolean,
  handle: (state: St, action: Ac) => S,
): { guard: (state: St) => boolean; handle: (state: St, action: Ac) => S } {
  return { guard, handle };
}

/**
 * Internal, deliberately widened view of the states map. TypeScript cannot
 * correlate `state.kind` with the map key it came from (the correlated-union
 * limitation), so the engine goes through this cast; the `Definition` type
 * guarantees by construction that every stored slot matches its position.
 * Slot discrimination is `typeof slot === "function"`: `Definition` admits
 * nothing but plain handlers and `{ guard, handle }` objects, so no brand is
 * needed (a brand would leak into `guarded`'s return type and complicate
 * shared-group authoring).
 */
type WidenedSlot<S extends StateBase, A extends ActionBase> =
  | ((state: S, action: A) => S)
  | { guard: (state: S) => boolean; handle: (state: S, action: A) => S };

type Table<S extends StateBase, A extends ActionBase> = Record<
  string,
  Record<string, WidenedSlot<S, A> | undefined> | undefined
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
    const slot = table[state.kind]?.[action.type];
    if (!slot) {
      if (inDev()) {
        console.warn(
          `[minism] Action "${action.type}" is not allowed in state "${state.kind}" — ignored.`,
        );
      }
      return state;
    }
    if (typeof slot === "function") {
      return slot(state, action);
    }
    if (!slot.guard(state)) {
      if (inDev()) {
        console.warn(
          `[minism] Action "${action.type}" declined by guard in state "${state.kind}" — ignored.`,
        );
      }
      return state;
    }
    return slot.handle(state, action);
  };

  const can = (state: S, actionType: A["type"]): boolean => {
    const slot = table[state.kind]?.[actionType];
    if (slot === undefined) return false;
    return typeof slot === "function" || slot.guard(state);
  };

  // `Object.keys` is typed `string[]`; these keys are `A["type"]` by
  // construction, since `HandlerMap` admits no other property names.
  const allowed = (state: S): A["type"][] =>
    (Object.keys(table[state.kind] ?? {}) as A["type"][]).filter(
      (actionType) => can(state, actionType),
    );

  return { initial: definition.initial, advance, allowed, can, definition };
}
