/**
 * A document-drafting flow — the sync fixture with overlapping states:
 * `drafting` (a new document) and `revising` (an existing one) share almost
 * every transition.
 */
import { createState, defineMachine, guarded } from "../../src/index";
import type { ActionOf, StateOf } from "../../src/index";

export type View = "outline" | "preview";
export type Previous = "home" | "list";

export type FlowState =
  | { step: "home" }
  | { step: "list" }
  | { step: "detail"; docId: string; previous: Previous }
  | { step: "drafting"; view: View; title: string; tags: string[] }
  | {
      step: "revising";
      view: View;
      title: string;
      tags: string[];
      docId: string;
    };

export type FlowAction =
  | { type: "goHome" }
  | { type: "viewList" }
  | { type: "viewDoc"; docId: string; previous: Previous }
  | { type: "startDraft" }
  | { type: "resumeDraft"; title: string; tags: string[] }
  | { type: "enterRevise"; docId: string; title: string; tags: string[] }
  | { type: "showOutline" }
  | { type: "showPreview" }
  | { type: "setTitle"; title: string }
  | { type: "setTags"; tags: string[] }
  | { type: "saveSuccess"; docId: string };

/** The overlapping pair: the states that share the document-editing transitions. */
export type Editable = StateOf<FlowState, "drafting" | "revising">;

/** Ergonomic local alias for this flow's actions. */
export type Act<T extends FlowAction["type"]> = ActionOf<FlowAction, T>;

// ---------------------------------------------------------------------------
// Shared transition groups.
// A handler that ignores `state` (or types it over the full union) drops into
// any state; a handler that reads `state: Editable` drops into drafting and
// revising only. Explicit parameter types are required because the groups are
// defined outside the states map.
// ---------------------------------------------------------------------------

export const exits = {
  goHome: (): FlowState => ({ step: "home" }),
  viewList: (): FlowState => ({ step: "list" }),
  viewDoc: (_state: FlowState, action: Act<"viewDoc">): FlowState => ({
    step: "detail",
    docId: action.docId,
    previous: action.previous,
  }),
  saveSuccess: (_state: FlowState, action: Act<"saveSuccess">): FlowState => ({
    step: "detail",
    docId: action.docId,
    previous: "home",
  }),
};

export const editDoc = {
  showOutline: (state: Editable): FlowState => ({ ...state, view: "outline" }),
  // Guarded slot inside a shared group: previewing needs a title. Travels
  // into both `drafting` and `revising` like any other group member.
  showPreview: guarded(
    (state: Editable) => state.title !== "",
    (state: Editable): FlowState => ({ ...state, view: "preview" }),
  ),
  setTitle: (state: Editable, action: Act<"setTitle">): FlowState => ({
    ...state,
    title: action.title,
  }),
  setTags: (state: Editable, action: Act<"setTags">): FlowState => ({
    ...state,
    tags: action.tags,
  }),
};

const begin = {
  startDraft: (): FlowState => ({
    step: "drafting",
    view: "outline",
    title: "",
    tags: [],
  }),
  resumeDraft: (_state: FlowState, action: Act<"resumeDraft">): FlowState => ({
    step: "drafting",
    view: "outline",
    title: action.title,
    tags: action.tags,
  }),
  enterRevise: (_state: FlowState, action: Act<"enterRevise">): FlowState => ({
    step: "revising",
    view: "outline",
    docId: action.docId,
    title: action.title,
    tags: action.tags,
  }),
};

export const flowDefinition = createState<FlowState, FlowAction>({
  initial: { step: "home" },
  states: {
    home: { ...begin, viewList: exits.viewList, viewDoc: exits.viewDoc },
    list: { viewDoc: exits.viewDoc, goHome: exits.goHome },
    detail: {
      enterRevise: begin.enterRevise,
      goHome: exits.goHome,
      viewList: exits.viewList,
    },
    // The overlapping pair: one line each, shared groups spread in.
    drafting: { ...editDoc, ...exits },
    revising: { ...editDoc, ...exits },
  },
});

export const flowMachine = defineMachine(flowDefinition);
