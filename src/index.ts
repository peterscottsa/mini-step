// Core entry — framework-agnostic, zero dependencies.

export { assertCoverage, createStrictState } from "./coverage";
export { createState, defineMachine } from "./machine";
export type {
  StateBase,
  ActionBase,
  StateOf,
  ActionOf,
  HandlerMap,
  Effect,
  Definition,
  Machine,
} from "./types";
