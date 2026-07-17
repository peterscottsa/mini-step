# minism

Tiny declarative state machines over discriminated unions. Zero dependencies, framework-agnostic core, optional React hook.

Most state-machine libraries model a state as a bare label plus one shared context blob. minism keeps your state a **discriminated union where each state owns only its fields** — impossible states don't compile — and makes the transition table declarative: a state's keys *are* its legal actions.

```ts
import { createState, defineMachine } from "minism";

type State =
  | { kind: "off" }
  | { kind: "on"; since: number };

type Action =
  | { type: "powerOn"; at: number }
  | { type: "powerOff" };

const machine = defineMachine(
  createState<State, Action>({
    initial: { kind: "off" },
    states: {
      off: { powerOn: (_state, action) => ({ kind: "on", since: action.at }) },
      on: { powerOff: () => ({ kind: "off" }) },
    },
  }),
);

machine.advance({ kind: "off" }, { type: "powerOn", at: 1 }); // { kind: "on", since: 1 }
machine.allowed({ kind: "off" });                             // ["powerOn"]
machine.can({ kind: "off" }, "powerOff");                     // false
```

Every handler is narrowed to its exact (state kind, action type) pair — inside `off.powerOn`, `state` is `{ kind: "off" }` and `action` is `{ type: "powerOn"; at: number }`, with no casts and no guards. An action a state doesn't list is a no-op (warned in development, silent in production).

## Install

```sh
npm install minism
```

TypeScript ≥ 5 with `strict` (specifically `strictFunctionTypes`) is expected — contravariant handler checking is what makes shared groups sound. React ≥ 18 is an optional peer dependency, only needed for `minism/react`.

## Shared transition groups

The reason minism exists: states that overlap should share code, not copy it. A handler's parameter types decide which states it can serve — a handler that ignores its state (or types it over the full union) drops into any state; one that reads a narrower union drops into exactly those states, checked by the compiler.

```ts
type FlowState =
  | { kind: "home" }
  | { kind: "list" }
  | { kind: "detail"; docId: string; previous: "home" | "list" }
  | { kind: "drafting"; view: View; title: string; tags: string[] }
  | { kind: "revising"; view: View; title: string; tags: string[]; docId: string };

// `drafting` and `revising` share almost every transition:
type Editable = StateOf<FlowState, "drafting" | "revising">;
type Act<T extends FlowAction["type"]> = ActionOf<FlowAction, T>;

const exits = {
  goHome: (): FlowState => ({ kind: "home" }),
  saveSuccess: (_state: FlowState, action: Act<"saveSuccess">): FlowState => ({
    kind: "detail",
    docId: action.docId,
    previous: "home",
  }),
};

const editDoc = {
  showPreview: (state: Editable): FlowState => ({ ...state, view: "preview" }),
  setTitle: (state: Editable, action: Act<"setTitle">): FlowState => ({
    ...state,
    title: action.title,
  }),
};

const flow = createState<FlowState, FlowAction>({
  initial: { kind: "home" },
  states: {
    home: { /* ... */ },
    list: { /* ... */ },
    detail: { /* ... */ },
    drafting: { ...editDoc, ...exits }, // the overlapping pair:
    revising: { ...editDoc, ...exits }, // one line each
  },
});
```

Spreading `editDoc` into `home` would be a compile error — `home` is not `Editable`. Adding a shared transition is one line in one group; both states get it.

## Async: effects

Async work is modelled as **states plus entry effects**, so transitions never block and every wait is a visible, cancellable state. An effect runs when its state is entered and resolves to the next action to send.

```ts
type PublishState =
  | { kind: "idle" }
  | { kind: "checkingQuota"; size: number }
  | { kind: "uploading"; size: number }
  | { kind: "done"; url: string }
  | { kind: "failed"; reason: string; retryable: boolean };

type PublishDeps = {
  hasQuota: (size: number) => Promise<boolean>;
  upload: (size: number, signal: AbortSignal) => Promise<{ url: string }>;
};

const publish = createState<PublishState, PublishAction, PublishDeps>({
  initial: { kind: "idle" },
  states: {
    idle: { begin: (_s, a) => ({ kind: "checkingQuota", size: a.size }) },
    checkingQuota: {
      quotaResolved: (s, a) =>
        a.sufficient
          ? { kind: "uploading", size: s.size }
          : { kind: "failed", reason: "Not enough space", retryable: false },
      cancel: () => ({ kind: "idle" }),
    },
    uploading: {
      uploadSucceeded: (_s, a) => ({ kind: "done", url: a.url }),
      uploadFailed: (_s, a) => ({ kind: "failed", reason: a.message, retryable: true }),
      cancel: () => ({ kind: "idle" }),
    },
    failed: { retry: () => ({ kind: "idle" }), cancel: () => ({ kind: "idle" }) },
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
```

The contract: **effects map their own errors to a failure action** — the transition table stays the only place that decides where the machine can go. A rejecting effect is a bug (warned in development, never dispatched).

## React

```tsx
import { useMachine } from "minism/react";

function PublishButton({ deps }: { deps: PublishDeps }) {
  const { state, send, can } = useMachine(publishMachine, deps);

  return (
    <>
      <button
        disabled={!can("begin")}
        onClick={() => send({ type: "begin", size: 512 })}
      >
        Publish
      </button>
      {state.kind === "uploading" && <Spinner />}
      {state.kind === "failed" && state.retryable && (
        <button onClick={() => send({ type: "retry" })}>Retry</button>
      )}
    </>
  );
}
```

Semantics worth knowing:

- **Entry = state object identity.** Every transition returns a new state object, and each one counts as an entry. A self-update that returns a new object of the same kind re-enters and re-runs that state's effect.
- **Each entry gets its own `AbortController`.** Leaving the state (or unmounting) aborts it: the signal passed into your effect fires, and an action resolved by an aborted effect is dropped, never dispatched. Late responses after a cancel can't move the machine.
- **`deps` may change identity freely.** A running effect keeps the deps it started with; the next entry reads the latest. Machines take no deps? `useMachine(machine)` — the argument is omitted.
- **StrictMode-safe.** The doubled dev mount aborts the first effect run; exactly one transition lands.
- `send` is referentially stable for the lifetime of the hook; `allowed`/`can` are stable per state.

## Coverage

The `Definition` type forces every *state* to be present, but a forgotten *action within a state* is a runtime no-op, not a compile error. Two helpers close the gap — pick one:

```ts
// Default: one line in a test. Throws naming any action type no state
// handles; the list itself is compile-checked to be complete.
assertCoverage(publishMachine, [
  "begin", "quotaResolved", "uploadSucceeded", "uploadFailed", "retry", "cancel",
]);

// Opt-in: the build fails instead. Two-step call, terser type errors.
const strict = createStrictState<PublishState, PublishAction, PublishDeps>()({
  /* every action must be handled somewhere, or this does not compile */
});
```

Coverage means "handled by at least one state". Reachability analysis is out of scope by construction: transition targets are plain functions, not statically-known nodes.

## Scope, honestly

minism is a handful of states with typed data and simple guards — flows, wizards, request lifecycles. It has no hierarchy, no parallel regions, no visualizer, and no reachability graph. If you need those, use [XState](https://xstate.js.org); if your value is a pure calculation of current data, you don't need a machine at all — just compute it where it's shown.

## API

| Export | |
| --- | --- |
| `createState<State, Action, Deps>(definition)` | Author a graph. Runtime identity; pins the type parameters so every handler slot narrows. |
| `defineMachine(definition)` | Compile to the pure engine: `{ initial, advance, allowed, can, definition }`. |
| `useMachine(machine, deps?)` — `minism/react` | Run it in React: `{ state, send, allowed, can }`, effects per entry. |
| `assertCoverage(machine, allActionTypes)` | Test-time action coverage with a compile-checked list. |
| `createStrictState<State, Action, Deps>()(definition)` | Compile-time action coverage. |
| `StateOf<S, K>` / `ActionOf<A, T>` | Extract union members; alias `ActionOf` locally as `Act<T>`. |
| `Definition` / `Machine` / `HandlerMap` / `Effect` | The underlying types. |

## License

MIT
