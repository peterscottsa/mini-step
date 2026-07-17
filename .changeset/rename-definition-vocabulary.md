---
"mini-step": minor
---

Rename the definition vocabulary so it reads as one language: the config key `states:` is now `steps:`, `createState` is now `defineSteps`, and `createStrictState` is now `defineStrictSteps`. A machine is a set of **steps**; the **state** is the current step plus its facts, and `state.step` answers "which one?".

Breaking (0.x): update the config key and the two function names — no behavior changes. README examples also renamed the light switch's `since` field to `turnedOnAt` (docs only).
