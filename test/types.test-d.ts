import { expectTypeOf, test } from "vitest";
import { guarded } from "../src/index";
import type { Definition, Given, HandlerMap, StateOf } from "../src/index";
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

test("handler bags narrow state and action to their exact pair", () => {
  const _def: Definition<FlowState, FlowAction> = {
    initial: { step: "home" },
    steps: {
      home: {
        startDraft: ({ state, action }) => {
          expectTypeOf(state).toEqualTypeOf<StateOf<FlowState, "home">>();
          expectTypeOf(action).toEqualTypeOf<Act<"startDraft">>();
          return { step: "drafting", view: "outline", title: "", tags: [] };
        },
      },
      list: {},
      detail: {},
      drafting: {
        setTitle: ({ state, action }) => {
          expectTypeOf(state).toEqualTypeOf<StateOf<FlowState, "drafting">>();
          expectTypeOf(action).toEqualTypeOf<Act<"setTitle">>();
          return { ...state, title: action.title };
        },
      },
      revising: {},
    },
  };
});

test("handlers destructure only the bag fields they use, inline", () => {
  const _def: Definition<FlowState, FlowAction> = {
    initial: { step: "home" },
    steps: {
      home: {},
      list: {},
      detail: {},
      drafting: {
        // Action-only: state never appears.
        saveSuccess: ({ action }) => ({
          step: "detail",
          docId: action.docId,
          previous: "home",
        }),
        // State-only: action never appears.
        showOutline: ({ state }) => ({ ...state, view: "outline" }),
        // Neither: an empty parameter list.
        goHome: () => ({ step: "home" }),
      },
      revising: {},
    },
  };
});

test("shared groups spread into every state they are valid for", () => {
  const _def: Definition<FlowState, FlowAction> = {
    initial: { step: "home" },
    steps: {
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
    steps: {
      home: {},
      list: {},
      detail: {},
      drafting: {
        setTags: guarded(
          (state) => state.tags.length < 5,
          ({ state, action }) => {
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
    steps: {
      home: {},
      list: {},
      detail: {},
      drafting: {
        setTags: guarded(
          (state: Editable) => state.tags.length < 5,
          ({ state, action }: Given<Editable, Act<"setTags">>): FlowState => ({
            ...state,
            tags: action.tags,
          }),
        ),
      },
      revising: {},
    },
  };
});

test("Given expands to the state-only or state-and-action bag", () => {
  expectTypeOf<Given<Editable>>().toEqualTypeOf<{ state: Editable }>();
  expectTypeOf<Given<Editable, Act<"setTitle">>>().toEqualTypeOf<{
    state: Editable;
    action: Act<"setTitle">;
  }>();
});

test("unknown action keys are rejected", () => {
  const _map: HandlerMap<FlowState, FlowAction, "drafting"> = {
    // @ts-expect-error 'setTitel' is not an action type
    setTitel: ({ state }: Given<Editable>): FlowState => state,
  };
});

test("handlers must return the state union", () => {
  const _map: HandlerMap<FlowState, FlowAction, "drafting"> = {
    // @ts-expect-error 'nowhere' is not a state
    goHome: () => ({ step: "nowhere" }),
  };
});

test("every step must be present in the steps map", () => {
  const missingRevising = {
    home: {},
    list: {},
    detail: {},
    drafting: {},
  };
  // @ts-expect-error steps must name every step — 'revising' is missing
  const _def: Definition<FlowState, FlowAction> = { initial: { step: "home" }, steps: missingRevising };
});

// ---------------------------------------------------------------------------
// Effects (async fixture-in-miniature; the full async fixture is publish.ts).
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
    steps: {
      idle: {
        search: ({ action }) => ({ step: "searching", query: action.query }),
      },
      searching: {
        resolved: ({ action }) =>
          action.found ? { step: "idle" } : { step: "failed", reason: "no matches" },
        cancel: () => ({ step: "idle" }),
      },
      failed: {},
    },
    effects: {
      searching: async ({ state, deps, signal }) => {
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
    steps: { idle: {}, searching: {}, failed: {} },
    effects: {
      // @ts-expect-error 'saving' is not a step of the machine
      saving: async () => ({ type: "cancel" }),
    },
  };
});
