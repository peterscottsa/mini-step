/**
 * A document-drafting flow — the sync fixture with overlapping states:
 * `drafting` (a new document) and `revising` (an existing one) share almost
 * every transition. Types here; the runtime definition joins in step 3.
 */
import type { ActionOf, StateOf } from "../../src/index";

export type View = "outline" | "preview";
export type Previous = "home" | "list";

export type FlowState =
  | { kind: "home" }
  | { kind: "list" }
  | { kind: "detail"; docId: string; previous: Previous }
  | { kind: "drafting"; view: View; title: string; tags: string[] }
  | {
      kind: "revising";
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
