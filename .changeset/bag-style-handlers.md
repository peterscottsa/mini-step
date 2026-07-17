---
"mini-step": minor
---

Handlers and effects now receive a single bag argument instead of positional parameters: `({ state, action }) => …` for handlers, `({ state, deps, signal }) => …` for effects. Destructure only what you use — `({ action }) => …` needs no underscore placeholder, and shared-group handlers annotate only the fields they touch (the new `Given<State, Action?>` helper compresses the full case). Guard conditions are unchanged: a one-input predicate keeps its bare `(state) => boolean`. `machine.advance(state, action)` also keeps its positional reducer signature.

Breaking (0.x): rewrap handler parameters in braces — no behavior changes.
