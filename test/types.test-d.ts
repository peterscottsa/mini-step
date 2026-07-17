import { expectTypeOf, test } from "vitest";
import { guarded } from "../src/index";
import type { Definition, HandlerMap, StateOf } from "../src/index";
import { editDoc, exits } from "./fixtures/flow";
import type { Act, Editable, FlowAction, FlowState, Previous } from "./fixtures/flow";

test("StateOf and ActionOf extract exact union members", () => {
  expectTypeOf<Act<"setTitle">>().toEqualTypeOf<{ type: "setTitle"; title: string }>();
  expectTypeOf<StateOf<FlowState, "detail">>().toEqualTypeOf<{
    kind: "detail";
    docId: string;
    previous: Previous;
  }>();
});

test("handler slots narrow state and action to their exact pair", () => {
  const _def: Definition<FlowState, FlowAction> = {
    initial: { kind: "home" },
    states: {
      home: {
        startDraft: (state, action) => {
          expectTypeOf(state).toEqualTypeOf<StateOf<FlowState, "home">>();
          expectTypeOf(action).toEqualTypeOf<Act<"startDraft">>();
          return { kind: "drafting", view: "outline", title: "", tags: [] };
        },
      },
      list: {},
      detail: {},
      drafting: {
        setTitle: (state, action) => {
          expectTypeOf(state).toEqualTypeOf<StateOf<FlowState, "drafting">>();
          expectTypeOf(action).toEqualTypeOf<Act<"setTitle">>();
          return { ...state, title: action.title };
        },
      },
      revising: {},
    },
  };
});

test("shared groups spread into every state they are valid for", () => {
  const _def: Definition<FlowState, FlowAction> = {
    initial: { kind: "home" },
    states: {
      home: { ...exits },
      list: { ...exits },
      detail: { ...exits },
      drafting: { ...editDoc, ...exits },
      revising: { ...editDoc, ...exits },
    },
  };
});

test("a state-reading handler cannot drop into a state outside its union", () => {
  const _map: HandlerMap<FlowState, FlowAction, "home"> = {
    // @ts-expect-error showOutline reads Editable; home is not an Editable
    showOutline: editDoc.showOutline,
  };
});

test("a guarded slot cannot drop into a state outside its union either", () => {
  const _map: HandlerMap<FlowState, FlowAction, "home"> = {
    // @ts-expect-error showPreview's guard reads Editable; home is not an Editable
    showPreview: editDoc.showPreview,
  };
});

test("guarded slots type-check inline with annotated parameters", () => {
  const _def: Definition<FlowState, FlowAction> = {
    initial: { kind: "home" },
    states: {
      home: {},
      list: {},
      detail: {},
      drafting: {
        setTags: guarded(
          (state: Editable) => state.tags.length < 5,
          (state: Editable, action: Act<"setTags">): FlowState => ({
            ...state,
            tags: action.tags,
          }),
        ),
      },
      revising: {},
    },
  };
});

test("unknown action keys are rejected", () => {
  const _map: HandlerMap<FlowState, FlowAction, "drafting"> = {
    // @ts-expect-error 'setTitel' is not an action type
    setTitel: (state: Editable): FlowState => state,
  };
});

test("handlers must return the state union", () => {
  const _map: HandlerMap<FlowState, FlowAction, "drafting"> = {
    // @ts-expect-error 'nowhere' is not a state
    goHome: () => ({ kind: "nowhere" }),
  };
});

test("every state kind must be present in the states map", () => {
  const missingRevising = {
    home: {},
    list: {},
    detail: {},
    drafting: {},
  };
  // @ts-expect-error states must name every kind — 'revising' is missing
  const _def: Definition<FlowState, FlowAction> = { initial: { kind: "home" }, states: missingRevising };
});

// ---------------------------------------------------------------------------
// Effects (async fixture-in-miniature; the full async fixture lands in step 4).
// ---------------------------------------------------------------------------

type SearchState =
  | { kind: "idle" }
  | { kind: "searching"; query: string }
  | { kind: "failed"; reason: string };

type SearchAction =
  | { type: "search"; query: string }
  | { type: "resolved"; found: boolean }
  | { type: "cancel" };

type SearchDeps = {
  countMatches: (query: string) => Promise<number>;
};

test("effects narrow their state and receive typed deps and a signal", () => {
  const _def: Definition<SearchState, SearchAction, SearchDeps> = {
    initial: { kind: "idle" },
    states: {
      idle: {
        search: (_state, action) => ({ kind: "searching", query: action.query }),
      },
      searching: {
        resolved: (_state, action) =>
          action.found ? { kind: "idle" } : { kind: "failed", reason: "no matches" },
        cancel: () => ({ kind: "idle" }),
      },
      failed: {},
    },
    effects: {
      searching: async (state, deps, signal) => {
        expectTypeOf(state).toEqualTypeOf<StateOf<SearchState, "searching">>();
        expectTypeOf(deps).toEqualTypeOf<SearchDeps>();
        expectTypeOf(signal).toEqualTypeOf<AbortSignal>();
        return {
          type: "resolved",
          found: (await deps.countMatches(state.query)) > 0,
        };
      },
    },
  };
});

test("effects only accept known state kinds", () => {
  const _def: Definition<SearchState, SearchAction, SearchDeps> = {
    initial: { kind: "idle" },
    states: { idle: {}, searching: {}, failed: {} },
    effects: {
      // @ts-expect-error 'saving' is not a state kind
      saving: async () => ({ type: "cancel" }),
    },
  };
});
