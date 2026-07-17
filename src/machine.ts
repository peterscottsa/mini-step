import { inDev } from "./env";
import type { StandardSchemaV1 } from "./standard-schema";
import type { ActionBase, Definition, Machine, StateBase } from "./types";

/**
 * Author a machine graph. Runtime identity — it exists to pin the three type
 * parameters in one place so every handler slot in the definition literal is
 * narrowed to its exact (step, action type) pair.
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
 * correlate `state.step` with the map key it came from (the correlated-union
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
 * Run a Standard Schema validation for a decoder. Data failures come back as
 * the schema's own `Result`; the two throws are misconfigurations — the
 * caller's programming error, not bad data.
 */
function decodeWith<T>(
  schema: StandardSchemaV1<unknown, T> | undefined,
  slot: "state" | "action",
  input: unknown,
): StandardSchemaV1.Result<T> {
  if (!schema) {
    throw new Error(
      `[minism] No ${slot} schema configured — set \`schema.${slot}\` in the definition to decode ${slot}s.`,
    );
  }
  const result = schema["~standard"].validate(input);
  if (result instanceof Promise) {
    throw new Error(
      "[minism] Async schemas are not supported — validation must be synchronous.",
    );
  }
  return result;
}

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
    const slot = table[state.step]?.[action.type];
    if (!slot) {
      if (inDev()) {
        console.warn(
          `[minism] Action "${action.type}" is not allowed in state "${state.step}" — ignored.`,
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
          `[minism] Action "${action.type}" declined by guard in state "${state.step}" — ignored.`,
        );
      }
      return state;
    }
    return slot.handle(state, action);
  };

  const can = (state: S, actionType: A["type"]): boolean => {
    const slot = table[state.step]?.[actionType];
    if (slot === undefined) return false;
    return typeof slot === "function" || slot.guard(state);
  };

  // `Object.keys` is typed `string[]`; these keys are `A["type"]` by
  // construction, since `HandlerMap` admits no other property names.
  const allowed = (state: S): A["type"][] =>
    (Object.keys(table[state.step] ?? {}) as A["type"][]).filter(
      (actionType) => can(state, actionType),
    );

  const decodeState = (input: unknown): StandardSchemaV1.Result<S> =>
    decodeWith(definition.schema?.state, "state", input);

  const decodeAction = (input: unknown): StandardSchemaV1.Result<A> =>
    decodeWith(definition.schema?.action, "action", input);

  return {
    initial: definition.initial,
    advance,
    allowed,
    can,
    definition,
    decodeState,
    decodeAction,
  };
}
