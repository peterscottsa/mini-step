/**
 * Type-level core.
 *
 * A machine is declared over two discriminated unions:
 * - `State`, discriminated on `kind`, where each state owns only its fields
 * - `Action`, discriminated on `type`
 *
 * `Definition.states` must name every state kind; each state lists the subset
 * of actions it allows, and each handler slot is narrowed to its exact
 * (state kind, action type) pair. Handler slots are declared as function
 * properties — never method shorthand — so `strictFunctionTypes` checks their
 * parameters contravariantly. That contravariance is what makes shared
 * transition groups sound: a handler written over a wider state union (or one
 * that ignores its state entirely) drops into every slot it is valid for, and
 * only those.
 */

export type StateBase = { kind: string };
export type ActionBase = { type: string };

/** The member of the state union `S` whose `kind` is `K`. */
export type StateOf<S extends StateBase, K extends S["kind"]> = Extract<
  S,
  { kind: K }
>;

/**
 * The member of the action union `A` whose `type` is `T`.
 * Alias it locally for ergonomics: `type Act<T extends AppAction["type"]> = ActionOf<AppAction, T>`.
 */
export type ActionOf<A extends ActionBase, T extends A["type"]> = Extract<
  A,
  { type: T }
>;

/**
 * A guarded slot, authored with the `guarded` combinator: `handle` runs only
 * while `guard(state)` returns true; otherwise the action is declined
 * (dev-warned no-op). Guards take state only — they must be pure and cheap —
 * which is what lets `allowed()` and `can()` evaluate them and stay truthful
 * for UI enable/disable. Both members are function properties, never method
 * shorthand: `strictFunctionTypes` checks properties contravariantly, which
 * is what makes shared groups containing guarded slots sound.
 */
export type Guarded<
  S extends StateBase,
  A extends ActionBase,
  K extends S["kind"],
  T extends A["type"],
> = {
  guard: (state: StateOf<S, K>) => boolean;
  handle: (state: StateOf<S, K>, action: ActionOf<A, T>) => S;
};

/** One transition slot: a plain handler, or a guarded one. */
export type Slot<
  S extends StateBase,
  A extends ActionBase,
  K extends S["kind"],
  T extends A["type"],
> = ((state: StateOf<S, K>, action: ActionOf<A, T>) => S) | Guarded<S, A, K, T>;

/**
 * One state's transition table: an optional slot per action type. The keys a
 * state includes ARE its legal actions — `allowed()` reports them, filtered
 * through any guards. Every handler returns the full state union; the
 * transition table is the only place that decides where the machine can go.
 */
export type HandlerMap<
  S extends StateBase,
  A extends ActionBase,
  K extends S["kind"],
> = {
  [T in A["type"]]?: Slot<S, A, K, T>;
};

/**
 * An entry effect for state kind `K`: runs when the machine enters the state,
 * resolves to the next action to send. Effects map their own errors to a
 * failure action — they never throw past the hook. `signal` aborts when the
 * machine leaves the state (or the host unmounts); a resolved action from an
 * aborted effect is dropped.
 */
export type Effect<
  S extends StateBase,
  A extends ActionBase,
  D,
  K extends S["kind"],
> = (state: StateOf<S, K>, deps: D, signal: AbortSignal) => Promise<A>;

/** The declarative machine graph. Author it with `createState`. */
export type Definition<S extends StateBase, A extends ActionBase, D = void> = {
  initial: S;
  /** Every state kind must be present, even if it allows no actions (`{}`). */
  states: { [K in S["kind"]]: HandlerMap<S, A, K> };
  /** Optional entry effects, keyed by the state kinds that have one. */
  effects?: { [K in S["kind"]]?: Effect<S, A, D, K> };
};

/** The compiled, pure engine produced by `defineMachine`. */
export type Machine<S extends StateBase, A extends ActionBase, D = void> = {
  initial: S;
  /**
   * Pure transition function. An action a state does not list — or whose
   * guard declines — is a no-op (dev-warned) that returns the same state
   * reference.
   */
  advance: (state: S, action: A) => S;
  /** The action types the given state currently allows, guards evaluated. */
  allowed: (state: S) => A["type"][];
  /** Whether the given state allows the given action type, guard evaluated. */
  can: (state: S, actionType: A["type"]) => boolean;
  /** The original definition, exposed for coverage helpers and devtools. */
  definition: Definition<S, A, D>;
};
