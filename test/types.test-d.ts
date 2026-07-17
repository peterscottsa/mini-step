import { expectTypeOf, test } from "vitest";
import { guarded } from "../src/index";
import type { Definition, HandlerMap, StateOf } from "../src/index";
import { editDoc, exits } from "./fixtures/flow";
import type { Act, Editable, FlowAction, FlowState, Previous } from "./fixtures/flow";

test("StateOf and ActionOf extract exact union members", () => {
  expectTypeOf<Act<"setTitle">>().toEqualTypeOf<{ type: "setTitle"; title: string }>();
  expectTypeOf<StateOf<FlowState, "detail">>().toEqualTypeOf<{
    step: "detail";
    docId: string;
    previous: Previous;
  }>();
});

test("handler slots narrow state and action to their exact pair", () => {
  const _def: Definition<FlowState, FlowAction> = {
    initial: { step: "home" },
    states: {
      home: {
        startDraft: (state, action) => {
          expectTypeOf(state).toEqualTypeOf<StateOf<FlowState, "home">>();
          expectTypeOf(action).toEqualTypeOf<Act<"startDraft">>();
          return { step: "drafting", view: "outline", title: "", tags: [] };
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
    initial: { step: "home" },
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

test("guarded slots infer their parameters when written inline", () => {
  const _def: Definition<FlowState, FlowAction> = {
    initial: { step: "home" },
    states: {
      home: {},
      list: {},
      detail: {},
      drafting: {
        setTags: guarded(
          (state) => state.tags.length < 5,
          (state, action) => {
            expectTypeOf(state).toEqualTypeOf<StateOf<FlowState, "drafting">>();
            expectTypeOf(action).toEqualTypeOf<Act<"setTags">>();
            return { ...state, tags: action.tags };
          },
        ),
      },
      revising: {},
    },
  };
});

test("guarded slots type-check inline with annotated parameters", () => {
  const _def: Definition<FlowState, FlowAction> = {
    initial: { step: "home" },
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
    goHome: () => ({ step: "nowhere" }),
  };
});

test("every step must be present in the states map", () => {
  const missingRevising = {
    home: {},
    list: {},
    detail: {},
    drafting: {},
  };
  // @ts-expect-error states must name every step — 'revising' is missing
  const _def: Definition<FlowState, FlowAction> = { initial: { step: "home" }, states: missingRevising };
});

// ---------------------------------------------------------------------------
// Effects (async fixture-in-miniature; the full async fixture lands in step 4).
// ---------------------------------------------------------------------------

type SearchState =
  | { step: "idle" }
  | { step: "searching"; query: string }
  | { step: "failed"; reason: string };

type SearchAction =
  | { type: "search"; query: string }
  | { type: "resolved"; found: boolean }
  | { type: "cancel" };

type SearchDeps = {
  countMatches: (query: string) => Promise<number>;
};

test("effects narrow their state and receive typed deps and a signal", () => {
  const _def: Definition<SearchState, SearchAction, SearchDeps> = {
    initial: { step: "idle" },
    states: {
      idle: {
        search: (_state, action) => ({ step: "searching", query: action.query }),
      },
      searching: {
        resolved: (_state, action) =>
          action.found ? { step: "idle" } : { step: "failed", reason: "no matches" },
        cancel: () => ({ step: "idle" }),
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

test("effects only accept known steps", () => {
  const _def: Definition<SearchState, SearchAction, SearchDeps> = {
    initial: { step: "idle" },
    states: { idle: {}, searching: {}, failed: {} },
    effects: {
      // @ts-expect-error 'saving' is not a step of the machine
      saving: async () => ({ type: "cancel" }),
    },
  };
});
