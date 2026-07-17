# minism

A tiny library for describing what your app is allowed to do next.

You describe your feature as a set of **states** (the situations it can be in), the **actions** allowed in each state (the things that can happen there), and what each action leads to. minism then answers three questions for you, at any moment:

- What situation are we in right now?
- What is the user allowed to do right now?
- If they do it, what happens next?

It has zero dependencies, the core works anywhere JavaScript runs, and there is a small optional React hook.

## The idea in one picture

Think of your feature as rooms connected by doors.

```
                    addItem (stay in the room)
                      ┌────┐
                      ▼    │
                ┌──────────┴──┐    checkout    ┌─────────┐
                │   editing   ├───────────────►│ payment │
                └─────────────┘                └─────────┘
```

You are always in exactly **one room** (a state). Each room has a fixed set of **doors** (actions). Walking through a door takes you to the next room. A door that isn't in your current room simply can't be used — if the code tries anyway, nothing happens, and in development you get a console warning telling you so.

Some doors also have a **lock** (a guard): the door exists, but it only opens when a condition about the current room is true — "you can only go to payment if the cart has something in it."

That's the whole model. Everything below is just this picture written in TypeScript.

## Why this instead of scattered booleans?

Most UI bugs of the "that button should have been disabled" kind come from tracking one situation with several independent flags (`isLoading`, `hasError`, `isEmpty`, …) that can disagree with each other. In minism, each state carries **only the facts that exist in that situation** — an `uploading` state has a file size, a `done` state has a URL, and there is no way to be both at once. (For TypeScript readers: state and action are discriminated unions.)

```ts
type PublishState =
  | { kind: "idle" }
  | { kind: "uploading"; size: number }   // size exists only while uploading
  | { kind: "done"; url: string };        // url exists only when done
```

## Install

```sh
npm install minism
```

Works with TypeScript 5+ in `strict` mode. React (version 18 or newer) is only needed if you use the React hook.

## Quick start

A light switch — two rooms, one door each:

```ts
import { createState, defineMachine } from "minism";

type State = { kind: "off" } | { kind: "on"; since: number };
type Action = { type: "powerOn"; at: number } | { type: "powerOff" };

const definition = createState<State, Action>({
  initial: { kind: "off" },
  states: {
    off: { powerOn: (_state, action) => ({ kind: "on", since: action.at }) },
    on: { powerOff: () => ({ kind: "off" }) },
  },
});

const machine = defineMachine(definition);

machine.advance({ kind: "off" }, { type: "powerOn", at: 1 }); // → { kind: "on", since: 1 }
machine.allowed({ kind: "off" });                             // → ["powerOn"]
machine.can({ kind: "off" }, "powerOff");                     // → false
```

Reading it out loud: "Start switched off. In the `off` state, the only thing that can happen is `powerOn`, which moves us to `on` and remembers when. In the `on` state, the only thing that can happen is `powerOff`."

- `advance(state, action)` — "this happened; what's the new situation?"
- `allowed(state)` — "what's possible right now?" (drives menus and button visibility)
- `can(state, actionType)` — "is this one thing possible right now?" (drives a single button's disabled prop)

## Examples

### 1. Sharing behavior between similar states

A writing app where you can draft a **new** document or revise an **existing** one. The two situations are different (revising knows which document it came from), but almost every editing action works the same in both. You write those shared actions once, as a plain object, and spread it into both states:

```ts
import { createState, defineMachine } from "minism";
import type { ActionOf, StateOf } from "minism";

type FlowState =
  | { kind: "home" }
  | { kind: "detail"; docId: string }
  | { kind: "drafting"; view: "outline" | "preview"; title: string; tags: string[] }
  | { kind: "revising"; view: "outline" | "preview"; title: string; tags: string[]; docId: string };

type FlowAction =
  | { type: "goHome" }
  | { type: "startDraft" }
  | { type: "setTitle"; title: string }
  | { type: "setTags"; tags: string[] }
  | { type: "saveSuccess"; docId: string };

// "Editable" means: either of the two editing states.
type Editable = StateOf<FlowState, "drafting" | "revising">;
type Act<T extends FlowAction["type"]> = ActionOf<FlowAction, T>;

// Actions that work identically in both editing states — written once.
const editDoc = {
  setTitle: (state: Editable, action: Act<"setTitle">): FlowState => ({
    ...state,
    title: action.title,
  }),
  setTags: (state: Editable, action: Act<"setTags">): FlowState => ({
    ...state,
    tags: action.tags,
  }),
};

// Ways out, valid from anywhere.
const exits = {
  goHome: (): FlowState => ({ kind: "home" }),
  saveSuccess: (_state: FlowState, action: Act<"saveSuccess">): FlowState => ({
    kind: "detail",
    docId: action.docId,
  }),
};

const flow = defineMachine(
  createState<FlowState, FlowAction>({
    initial: { kind: "home" },
    states: {
      home: {
        startDraft: (): FlowState => ({
          kind: "drafting", view: "outline", title: "", tags: [],
        }),
      },
      detail: { goHome: exits.goHome },
      drafting: { ...editDoc, ...exits }, // the similar pair:
      revising: { ...editDoc, ...exits }, // one line each
    },
  }),
);
```

The compiler keeps this honest: `editDoc` reads editing-only facts (like `title`), so trying to spread it into `home` — a state with no title — is a compile error, not a runtime surprise.

### 2. Locks on doors: guards

Sometimes an action should exist in a state but only be available under a condition. Wrap the action with `guarded(condition, whatHappens)`:

```ts
import { guarded } from "minism";

states: {
  editing: {
    addItem: (state, action) => ({ ...state, items: [...state.items, action.item] }),

    // The checkout door exists, but it's locked while the cart is empty.
    checkout: guarded(
      (state) => state.items.length > 0,
      (state) => ({ kind: "payment", items: state.items }),
    ),
  },
  // ...
}
```

The lock is checked everywhere automatically:

- `can(state, "checkout")` says `false` while the cart is empty — so your button disables itself.
- `allowed(state)` leaves `"checkout"` out of the list while locked.
- If something sends the action anyway, nothing happens, and in development a warning explains why.

The condition only looks at the current state, and it should be a quick, side-effect-free check — it runs every time someone asks "what's allowed?". A rule that depends on the *incoming* action (like "reject amounts above the limit") belongs inside the action's handler, which can see the payload and route to a failure state.

### 3. Waiting for slow things: effects

Talking to a server takes time. In minism, every wait is its own state, and the state declares what work starts when you enter it. When the work finishes, it reports back as an ordinary action. Publishing a file:

```ts
type PublishState =
  | { kind: "idle" }
  | { kind: "checkingQuota"; size: number }
  | { kind: "uploading"; size: number }
  | { kind: "done"; url: string }
  | { kind: "failed"; reason: "quotaExceeded" | "network"; retryable: boolean };

type PublishAction =
  | { type: "begin"; size: number }
  | { type: "quotaResolved"; sufficient: boolean }
  | { type: "uploadSucceeded"; url: string }
  | { type: "uploadFailed" }
  | { type: "retry" }
  | { type: "cancel" };

type PublishDeps = {
  hasQuota: (size: number) => Promise<boolean>;
  upload: (size: number, signal: AbortSignal) => Promise<{ url: string }>;
};

const publish = createState<PublishState, PublishAction, PublishDeps>({
  initial: { kind: "idle" },
  states: {
    idle: {
      begin: (_state, action) => ({ kind: "checkingQuota", size: action.size }),
    },
    checkingQuota: {
      quotaResolved: (state, action) =>
        action.sufficient
          ? { kind: "uploading", size: state.size }
          : { kind: "failed", reason: "quotaExceeded", retryable: false },
      cancel: () => ({ kind: "idle" }),
    },
    uploading: {
      uploadSucceeded: (_state, action) => ({ kind: "done", url: action.url }),
      uploadFailed: () => ({ kind: "failed", reason: "network", retryable: true }),
      cancel: () => ({ kind: "idle" }),
    },
    failed: { retry: () => ({ kind: "idle" }), cancel: () => ({ kind: "idle" }) },
    done: {},
  },
  effects: {
    // Entering checkingQuota starts this; its answer comes back as an action.
    checkingQuota: async (state, deps) => ({
      type: "quotaResolved",
      sufficient: await deps.hasQuota(state.size),
    }),
    uploading: async (state, deps, signal) => {
      try {
        const { url } = await deps.upload(state.size, signal);
        return { type: "uploadSucceeded", url };
      } catch {
        return { type: "uploadFailed" };
      }
    },
  },
});
```

Notice what this buys you: the spinner is not a boolean you manage — it's just "are we in `checkingQuota` or `uploading`?". Cancelling is an ordinary door back to `idle`, and a slow server reply that arrives *after* you cancelled is thrown away automatically — it can't sneak in and change anything.

One rule to remember: an effect that fails should catch its own error and return a failure **action** (like `uploadFailed` above). That way the table of states stays the only place that decides where the machine can go.

### 4. Using it in React

```tsx
import { useMachine } from "minism/react";

function PublishButton({ deps }: { deps: PublishDeps }) {
  const { state, send, can } = useMachine(publishMachine, deps);

  return (
    <>
      <button disabled={!can("begin")} onClick={() => send({ type: "begin", size: 512 })}>
        Publish
      </button>

      {(state.kind === "checkingQuota" || state.kind === "uploading") && <Spinner />}

      {state.kind === "failed" && state.retryable && (
        <button onClick={() => send({ type: "retry" })}>Try again</button>
      )}
    </>
  );
}
```

The hook keeps the current state, runs each state's effect when you arrive (and cancels it if you leave early), and gives you `send`, `allowed`, and `can`. If your machine takes no outside dependencies, call it as `useMachine(machine)`.

### 5. Error messages people can read (and translate)

Keep human-readable text **out** of your states. Store a short code instead, and turn it into words at render time — that's where your translation function lives:

```ts
// In the machine: a code, not a sentence.
| { kind: "failed"; reason: "quotaExceeded" | "network"; retryable: boolean }
```

```tsx
// In the component: words, translated at the moment of display.
const t = useT();
{state.kind === "failed" && <ErrorBanner>{t(`publish.error.${state.reason}`)}</ErrorBanner>}
```

Two practical reasons: if the user switches language while an error is on screen, the message follows along on the next render; and if you ever save state and restore it later, codes stay valid while baked-in sentences go stale.

### 6. Checking data that arrives from outside (with zod)

TypeScript can only vouch for data born inside your program. Saved state you restore on the next launch, a link someone opens, an event pushed from a server — those arrive as "could be anything" and need checking at the door. Give the machine a schema and it gains two checkers: `decodeState` and `decodeAction`.

minism has no schema library of its own and adds no dependency — it accepts schemas from any library that follows the [Standard Schema](https://standardschema.dev) convention (zod, valibot, arktype). Here it is with zod:

```ts
import { z } from "zod";
import { createState, defineMachine } from "minism";

// Describe the shapes once, with zod. The TypeScript types are derived from
// the schemas, so the checking and the types can never disagree.
const StateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("off") }),
  z.object({ kind: z.literal("on"), since: z.number() }),
]);
type SwitchState = z.infer<typeof StateSchema>;

const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("powerOn"), at: z.number() }),
  z.object({ type: z.literal("powerOff") }),
]);
type SwitchAction = z.infer<typeof ActionSchema>;

const machine = defineMachine(
  createState<SwitchState, SwitchAction>({
    initial: { kind: "off" },
    states: {
      off: { powerOn: (_state, action) => ({ kind: "on", since: action.at }) },
      on: { powerOff: () => ({ kind: "off" }) },
    },
    schema: { state: StateSchema, action: ActionSchema },
  }),
);

// Restoring saved state when the app starts:
const saved: unknown = JSON.parse(localStorage.getItem("switch") ?? "null");
const restored = machine.decodeState(saved);
const startingPoint = restored.issues ? machine.initial : restored.value;

// An action arriving from a server or a link:
const incoming = machine.decodeAction({ type: "powerOn", at: 42 });
if (!incoming.issues) {
  machine.advance(startingPoint, incoming.value);
}
```

Bad data never throws — you get back either `{ value }` (checked and typed) or `{ issues }` (a list of what's wrong), and you decide what to do, as the restore line above does by falling back to the machine's initial state. Two rules: checking must be synchronous (a schema that works asynchronously is refused), and if you declare your types by hand instead of deriving them from the schema, a schema that disagrees with the types won't compile.

### 7. Making sure nothing was forgotten

Every state must be present in the definition — TypeScript enforces that. But forgetting to handle one *action* anywhere is only a warning at runtime. One line in a test closes the gap:

```ts
import { assertCoverage } from "minism";

test("every action is handled somewhere", () => {
  assertCoverage(publishMachine, [
    "begin", "quotaResolved", "uploadSucceeded", "uploadFailed", "retry", "cancel",
  ]);
});
```

It fails with the names of any actions no state handles — and the list you pass is itself checked at compile time, so it can't silently go stale. If you'd rather the *build* fail than a test, `createStrictState<State, Action>()({...})` refuses to compile while any action is unhandled.

## Good to know

- **Development warnings, production silence.** Sending an action a state doesn't list, or one whose lock is closed, does nothing — and logs a console warning in development so you notice. minism never shows text to your users; anything they see comes from your own states.
- **`advance` is a plain function.** No framework needed to test a machine — call `advance` with a state and an action, look at what comes back.
- **Machines should be created once**, at the top level of a file, not inside a component.

## When *not* to use it

If a value can be calculated from data you already have ("is the cart total above the minimum?"), you don't need a machine — just calculate it where you show it. minism is for situations the app must *remember* — where the same event should do different things depending on what happened before. And if you need big-ticket features like nested or parallel states and visual diagrams, use [XState](https://xstate.js.org); minism is deliberately the small version.

## API reference

| Export | What it does |
| --- | --- |
| `createState<State, Action, Deps>(definition)` | Author a machine definition. Pins the types so every handler is checked precisely. |
| `defineMachine(definition)` | Turn a definition into a runnable machine: `{ initial, advance, allowed, can, definition }`. |
| `guarded(condition, handler)` | Put a lock on one action: the handler runs only while the condition holds. |
| `useMachine(machine, deps?)` — from `minism/react` | Run a machine in a component: `{ state, send, allowed, can }`. |
| `machine.decodeState(value)` / `machine.decodeAction(value)` | Check outside data against the definition's schemas; get a typed value or a list of problems. |
| `assertCoverage(machine, allActionTypes)` | Test helper: fails if any action is handled nowhere. |
| `createStrictState<State, Action, Deps>()(definition)` | Like `createState`, but unhandled actions fail the build. |
| `StateOf<S, K>` / `ActionOf<A, T>` | Pick one state / action out of the union, for typing shared groups. |
| `Definition` / `Machine` / `HandlerMap` / `Slot` / `Guarded` / `Effect` / `StandardSchemaV1` | The underlying types. |

## License

MIT
