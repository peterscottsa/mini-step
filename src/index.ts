// Core entry — framework-agnostic, zero dependencies.

export { assertCoverage, createStrictState } from "./coverage";
export { createState, defineMachine, guarded } from "./machine";
export type {
  StateBase,
  ActionBase,
  StateOf,
  ActionOf,
  Guarded,
  Slot,
  HandlerMap,
  Effect,
  Definition,
  Machine,
} from "./types";
