# mini-step

A tiny library for describing what your app is allowed to do next.

You describe your feature as a set of **steps** (the situations it can be in), the **actions** allowed at each step (the things that can happen there), and what each action leads to. mini-step then answers three questions for you, at any moment:

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

You are always in exactly **one room** (a step). Each room has a fixed set of **doors** (actions). Walking through a door takes you to the next room. A door that isn't in your current room simply can't be used — if the code tries anyway, nothing happens, and in development you get a console warning telling you so.

Some doors also have a **lock** (a guard): the door exists, but it only opens when a condition about the current room is true — "you can only go to payment if the cart has something in it."

That's the whole model. Everything below is just this picture written in TypeScript.

## Why this instead of scattered booleans?

Most UI bugs of the "that button should have been disabled" kind come from tracking one situation with several independent flags (`isLoading`, `hasError`, `isEmpty`, …) that can disagree with each other. In mini-step, each state answers "which step are we on?" with one field — `step` — and carries **only the facts that exist at that step**: an `uploading` state has a file size, a `done` state has a URL, and there is no way to be both at once. (For TypeScript readers: state and action are discriminated unions.)

```ts
type PublishState =
  | { step: "idle" }
  | { step: "uploading"; size: number }   // size exists only while uploading
  | { step: "done"; url: string };        // url exists only when done
```

## Install

```sh
npm install mini-step
```

Works with TypeScript 5+ in `strict` mode. React (version 18 or newer) is only needed if you use the React hook.

## Quick start

A light switch — two rooms, one door each:

```ts
import { defineSteps, defineMachine } from "mini-step";

type State = { step: "off" } | { step: "on"; turnedOnAt: number };
type Action = { type: "powerOn"; at: number } | { type: "powerOff" };

const definition = defineSteps<State, Action>({
  initial: { step: "off" },
  steps: {
    off: { powerOn: ({ action }) => ({ step: "on", turnedOnAt: action.at }) },
    on: { powerOff: () => ({ step: "off" }) },
  },
});

const machine = defineMachine(definition);

machine.advance({ step: "off" }, { type: "powerOn", at: 1 }); // → { step: "on", turnedOnAt: 1 }
machine.allowed({ step: "off" });                             // → ["powerOn"]
machine.can({ step: "off" }, "powerOff");                     // → false
```

Reading it out loud: "Start switched off. At the `off` step, the only thing that can happen is `powerOn`, which moves us to `on` and remembers when. At the `on` step, the only thing that can happen is `powerOff`."

Every handler is given one bag holding the current `state` and the `action` that just happened — take out only what you need. `powerOn` above only needs the action; a handler that needs neither just writes `() =>`.

- `advance(state, action)` — "this happened; what's the new situation?"
- `allowed(state)` — "what's possible right now?" (drives menus and button visibility)
- `can(state, actionType)` — "is this one thing possible right now?" (drives a single button's disabled prop)

## Examples

### 1. Sharing behavior between similar steps

A writing app where you can draft a **new** document or revise an **existing** one. The two situations are different (revising knows which document it came from), but almost every editing action works the same in both. You write those shared actions once, as a plain object, and spread it into both steps:

```ts
import { defineSteps, defineMachine } from "mini-step";
import type { ActionOf, Given, StateOf } from "mini-step";

type FlowState =
  | { step: "home" }
  | { step: "detail"; docId: string }
  | { step: "drafting"; view: "outline" | "preview"; title: string; tags: string[] }
  | { step: "revising"; view: "outline" | "preview"; title: string; tags: string[]; docId: string };

type FlowAction =
  | { type: "goHome" }
  | { type: "startDraft" }
  | { type: "setTitle"; title: string }
  | { type: "setTags"; tags: string[] }
  | { type: "saveSuccess"; docId: string };

// "Editable" means: either of the two editing steps.
type Editable = StateOf<FlowState, "drafting" | "revising">;
type Act<T extends FlowAction["type"]> = ActionOf<FlowAction, T>;

// Actions that work identically at both editing steps — written once.
// (Groups live outside the steps map, so they say who they're for by hand:
// `Given<Editable, …>` means "given an Editable state and this action".)
const editDoc = {
  setTitle: ({ state, action }: Given<Editable, Act<"setTitle">>): FlowState => ({
    ...state,
    title: action.title,
  }),
  setTags: ({ state, action }: Given<Editable, Act<"setTags">>): FlowState => ({
    ...state,
    tags: action.tags,
  }),
};

// Ways out, valid from anywhere. These only need the action, so that's all
// they mention — no state annotation at all.
const exits = {
  goHome: (): FlowState => ({ step: "home" }),
  saveSuccess: ({ action }: { action: Act<"saveSuccess"> }): FlowState => ({
    step: "detail",
    docId: action.docId,
  }),
};

const flow = defineMachine(
  defineSteps<FlowState, FlowAction>({
    initial: { step: "home" },
    steps: {
      home: {
        startDraft: (): FlowState => ({
          step: "drafting", view: "outline", title: "", tags: [],
        }),
      },
      detail: { goHome: exits.goHome },
      drafting: { ...editDoc, ...exits }, // the similar pair:
      revising: { ...editDoc, ...exits }, // one line each
    },
  }),
);
```

The compiler keeps this honest: `editDoc` reads editing-only facts (like `title`), so trying to spread it into `home` — a step with no title — is a compile error, not a runtime surprise.

### 2. Locks on doors: guards

Sometimes an action should exist at a step but only be available under a condition. Wrap the action with `guarded(condition, whatHappens)`:

```ts
import { defineSteps, defineMachine, guarded } from "mini-step";

type CartState =
  | { step: "editing"; items: string[] }
  | { step: "payment"; items: string[] };

type CartAction =
  | { type: "addItem"; item: string }
  | { type: "checkout" };

const cart = defineMachine(
  defineSteps<CartState, CartAction>({
    initial: { step: "editing", items: [] },
    steps: {
      editing: {
        addItem: ({ state, action }) => ({
          ...state,
          items: [...state.items, action.item],
        }),

        // The checkout door exists, but it's locked while the cart is empty.
        // The lock's condition takes the state directly; what happens when
        // the door opens takes the usual bag.
        checkout: guarded(
          (state) => state.items.length > 0,
          ({ state }) => ({ step: "payment", items: state.items }),
        ),
      },
      payment: {},
    },
  }),
);

cart.can(cart.initial, "checkout"); // → false — locked, the cart is empty
cart.allowed(cart.initial);         // → ["addItem"]

const oneItem = cart.advance(cart.initial, { type: "addItem", item: "book" });
cart.can(oneItem, "checkout");      // → true — the lock is open
```

The lock is checked everywhere automatically:

- `can(state, "checkout")` says `false` while the cart is empty — so your button disables itself.
- `allowed(state)` leaves `"checkout"` out of the list while locked.
- If something sends the action anyway, nothing happens, and in development a warning explains why.

The condition only looks at the current state, and it should be a quick, side-effect-free check — it runs every time someone asks "what's allowed?". A rule that depends on the *incoming* action (like "reject amounts above the limit") belongs inside the action's handler, which can see the payload and route to a failure state.

### 3. Waiting for slow things: effects

Talking to a server takes time. In mini-step, every wait is its own step, and the step declares what work starts when you enter it. When the work finishes, it reports back as an ordinary action. Publishing a file:

```ts
import { defineSteps, defineMachine } from "mini-step";

type PublishState =
  | { step: "idle" }
  | { step: "checkingQuota"; size: number }
  | { step: "uploading"; size: number }
  | { step: "done"; url: string }
  | { step: "failed"; reason: "quotaExceeded" | "network"; retryable: boolean };

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

const publish = defineSteps<PublishState, PublishAction, PublishDeps>({
  initial: { step: "idle" },
  steps: {
    idle: {
      begin: ({ action }) => ({ step: "checkingQuota", size: action.size }),
    },
    checkingQuota: {
      quotaResolved: ({ state, action }) =>
        action.sufficient
          ? { step: "uploading", size: state.size }
          : { step: "failed", reason: "quotaExceeded", retryable: false },
      cancel: () => ({ step: "idle" }),
    },
    uploading: {
      uploadSucceeded: ({ action }) => ({ step: "done", url: action.url }),
      uploadFailed: () => ({ step: "failed", reason: "network", retryable: true }),
      cancel: () => ({ step: "idle" }),
    },
    failed: { retry: () => ({ step: "idle" }), cancel: () => ({ step: "idle" }) },
    done: {},
  },
  effects: {
    // Entering checkingQuota starts this; its answer comes back as an action.
    checkingQuota: async ({ state, deps }) => ({
      type: "quotaResolved",
      sufficient: await deps.hasQuota(state.size),
    }),
    uploading: async ({ state, deps, signal }) => {
      try {
        const { url } = await deps.upload(state.size, signal);
        return { type: "uploadSucceeded", url };
      } catch {
        return { type: "uploadFailed" };
      }
    },
  },
});

const publishMachine = defineMachine(publish);
```

Notice what this buys you: the spinner is not a boolean you manage — it's just "are we in `checkingQuota` or `uploading`?". Cancelling is an ordinary door back to `idle`, and a slow server reply that arrives *after* you cancelled is thrown away automatically — it can't sneak in and change anything.

One rule to remember: an effect that fails should catch its own error and return a failure **action** (like `uploadFailed` above). That way the table of steps stays the only place that decides where the machine can go.

### 4. Using it in React

```tsx
import { useMachine } from "mini-step/react";

function PublishButton({ deps }: { deps: PublishDeps }) {
  const { state, send, can } = useMachine(publishMachine, deps);

  return (
    <>
      <button disabled={!can("begin")} onClick={() => send({ type: "begin", size: 512 })}>
        Publish
      </button>

      {(state.step === "checkingQuota" || state.step === "uploading") && <Spinner />}

      {state.step === "failed" && state.retryable && (
        <button onClick={() => send({ type: "retry" })}>Try again</button>
      )}
    </>
  );
}
```

The hook keeps the current state, runs each step's effect when you arrive (and cancels it if you leave early), and gives you `send`, `allowed`, and `can`. If your machine takes no outside dependencies, call it as `useMachine(machine)`.

### 5. Error messages people can read (and translate)

Keep human-readable text **out** of your state. Store a short code instead, and turn it into words at render time — that's where your translation function lives:

```ts
type PublishState =
  | { step: "uploading"; size: number }
  // In the machine: a code, not a sentence.
  | { step: "failed"; reason: "quotaExceeded" | "network"; retryable: boolean };
```

```tsx
// In the component: words, translated at the moment of display.
function PublishError({ state }: { state: PublishState }) {
  const t = useT(); // your app's translation hook
  if (state.step !== "failed") return null;
  return <ErrorBanner>{t(`publish.error.${state.reason}`)}</ErrorBanner>;
}
```

Two practical reasons: if the user switches language while an error is on screen, the message follows along on the next render; and if you ever save state and restore it later, codes stay valid while baked-in sentences go stale.

### 6. Checking data that arrives from outside (with zod)

TypeScript can only vouch for data born inside your program. Saved state you restore on the next launch, a link someone opens, an event pushed from a server — those arrive as "could be anything" and need checking at the door. Give the machine a schema and it gains two checkers: `decodeState` and `decodeAction`.

mini-step has no schema library of its own and adds no dependency — it accepts schemas from any library that follows the [Standard Schema](https://standardschema.dev) convention (zod, valibot, arktype). Here it is with zod:

```ts
import { z } from "zod";
import { defineSteps, defineMachine } from "mini-step";

// Describe the shapes once, with zod. The TypeScript types are derived from
// the schemas, so the checking and the types can never disagree.
const StateSchema = z.discriminatedUnion("step", [
  z.object({ step: z.literal("off") }),
  z.object({ step: z.literal("on"), turnedOnAt: z.number() }),
]);
type SwitchState = z.infer<typeof StateSchema>;

const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("powerOn"), at: z.number() }),
  z.object({ type: z.literal("powerOff") }),
]);
type SwitchAction = z.infer<typeof ActionSchema>;

const machine = defineMachine(
  defineSteps<SwitchState, SwitchAction>({
    initial: { step: "off" },
    steps: {
      off: { powerOn: ({ action }) => ({ step: "on", turnedOnAt: action.at }) },
      on: { powerOff: () => ({ step: "off" }) },
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

Every step must be present in the definition — TypeScript enforces that. But forgetting to handle one *action* anywhere is only a warning at runtime. One line in a test closes the gap:

```ts
import { assertCoverage } from "mini-step";

test("every action is handled somewhere", () => {
  assertCoverage(publishMachine, [
    "begin", "quotaResolved", "uploadSucceeded", "uploadFailed", "retry", "cancel",
  ]);
});
```

It fails with the names of any actions no state handles — and the list you pass is itself checked at compile time, so it can't silently go stale. If you'd rather the *build* fail than a test, `defineStrictSteps<State, Action>()({...})` refuses to compile while any action is unhandled.

## Good to know

- **Development warnings, production silence.** Sending an action a state doesn't list, or one whose lock is closed, does nothing — and logs a console warning in development so you notice. mini-step never shows text to your users; anything they see comes from your own states.
- **`advance` is a plain function.** No framework needed to test a machine — call `advance` with a state and an action, look at what comes back.
- **Machines should be created once**, at the top level of a file, not inside a component.

## When *not* to use it

If a value can be calculated from data you already have ("is the cart total above the minimum?"), you don't need a machine — just calculate it where you show it. mini-step is for situations the app must *remember* — where the same event should do different things depending on what happened before. And if you need big-ticket features like nested or parallel states and visual diagrams, use [XState](https://xstate.js.org); mini-step is deliberately the small version.

## API reference

| Export | What it does |
| --- | --- |
| `defineSteps<State, Action, Deps>(definition)` | Author a machine definition. Pins the types so every handler is checked precisely. |
| `defineMachine(definition)` | Turn a definition into a runnable machine: `{ initial, advance, allowed, can, definition }`. |
| `guarded(condition, handler)` | Put a lock on one action: the handler runs only while the condition holds. |
| `useMachine(machine, deps?)` — from `mini-step/react` | Run a machine in a component: `{ state, send, allowed, can }`. |
| `machine.decodeState(value)` / `machine.decodeAction(value)` | Check outside data against the definition's schemas; get a typed value or a list of problems. |
| `assertCoverage(machine, allActionTypes)` | Test helper: fails if any action is handled nowhere. |
| `defineStrictSteps<State, Action, Deps>()(definition)` | Like `defineSteps`, but unhandled actions fail the build. |
| `StateOf<S, K>` / `ActionOf<A, T>` | Pick one state / action out of the union, for typing shared groups. |
| `Given<St, Ac?>` | Annotation helper for shared-group handlers: the `{ state }` or `{ state, action }` bag. |
| `Definition` / `Machine` / `HandlerMap` / `HandlerArgs` / `Slot` / `Guarded` / `Effect` / `StandardSchemaV1` | The underlying types. |

## License

MIT
