// Core entry — framework-agnostic, zero dependencies.

export { assertCoverage, defineStrictSteps } from "./coverage";
export { defineSteps, defineMachine, guarded } from "./machine";
export type { StandardSchemaV1 } from "./standard-schema";
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
