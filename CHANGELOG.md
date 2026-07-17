# mini-step

## 0.2.0

### Minor Changes

- e11c63d: Handlers and effects now receive a single bag argument instead of positional parameters: `({ state, action }) => …` for handlers, `({ state, deps, signal }) => …` for effects. Destructure only what you use — `({ action }) => …` needs no underscore placeholder, and shared-group handlers annotate only the fields they touch (the new `Given<State, Action?>` helper compresses the full case). Guard conditions are unchanged: a one-input predicate keeps its bare `(state) => boolean`. `machine.advance(state, action)` also keeps its positional reducer signature.

  Breaking (0.x): rewrap handler parameters in braces — no behavior changes.

- 49c6b05: Rename the definition vocabulary so it reads as one language: the config key `states:` is now `steps:`, `createState` is now `defineSteps`, and `createStrictState` is now `defineStrictSteps`. A machine is a set of **steps**; the **state** is the current step plus its facts, and `state.step` answers "which one?".

  Breaking (0.x): update the config key and the two function names — no behavior changes. README examples also renamed the light switch's `since` field to `turnedOnAt` (docs only).
