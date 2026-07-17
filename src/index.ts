// Core entry — framework-agnostic, zero dependencies.
// Coverage helpers land in step 5.

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
