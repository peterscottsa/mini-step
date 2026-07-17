import { afterEach, describe, expect, it, vi } from "vitest";
import { flowMachine } from "./fixtures/flow";
import type { FlowState } from "./fixtures/flow";

const drafting: FlowState = {
  kind: "drafting",
  view: "outline",
  title: "Field notes",
  tags: ["draft"],
};

const revising: FlowState = {
  kind: "revising",
  view: "outline",
  title: "Field notes",
  tags: ["draft"],
  docId: "doc-7",
};

describe("advance", () => {
  it("follows a legal transition and carries per-state data", () => {
    const next = flowMachine.advance(flowMachine.initial, { type: "startDraft" });
    expect(next).toEqual({ kind: "drafting", view: "outline", title: "", tags: [] });
  });

  it("runs a shared-group handler in both overlapping states", () => {
    const action = { type: "setTitle", title: "Renamed" } as const;
    expect(flowMachine.advance(drafting, action)).toEqual({ ...drafting, title: "Renamed" });
    expect(flowMachine.advance(revising, action)).toEqual({ ...revising, title: "Renamed" });
  });

  it("exits both overlapping states through the shared exits group", () => {
    const fromDrafting = flowMachine.advance(drafting, { type: "saveSuccess", docId: "doc-9" });
    const fromRevising = flowMachine.advance(revising, { type: "saveSuccess", docId: "doc-9" });
    const expected: FlowState = { kind: "detail", docId: "doc-9", previous: "home" };
    expect(fromDrafting).toEqual(expected);
    expect(fromRevising).toEqual(expected);
  });

  it("does not mutate the input state", () => {
    const before = structuredClone(drafting);
    flowMachine.advance(drafting, { type: "setTags", tags: ["final"] });
    expect(drafting).toEqual(before);
  });
});

describe("illegal actions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no-ops, returns the same state reference, and warns in dev", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const next = flowMachine.advance(flowMachine.initial, { type: "showPreview" });
    expect(next).toBe(flowMachine.initial);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      '[minism] Action "showPreview" is not allowed in state "home" — ignored.',
    );
  });

  it("does not warn in production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    try {
      const next = flowMachine.advance(flowMachine.initial, { type: "showPreview" });
      expect(next).toBe(flowMachine.initial);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("allowed / can", () => {
  it("reports a state's legal actions as its declared keys", () => {
    expect(flowMachine.allowed(flowMachine.initial).sort()).toEqual([
      "enterRevise",
      "resumeDraft",
      "startDraft",
      "viewDoc",
      "viewList",
    ]);
    expect(flowMachine.allowed(drafting).sort()).toEqual([
      "goHome",
      "saveSuccess",
      "setTags",
      "setTitle",
      "showOutline",
      "showPreview",
      "viewDoc",
      "viewList",
    ]);
  });

  it("answers can() per state", () => {
    expect(flowMachine.can(flowMachine.initial, "startDraft")).toBe(true);
    expect(flowMachine.can(flowMachine.initial, "showPreview")).toBe(false);
    expect(flowMachine.can(drafting, "showPreview")).toBe(true);
  });
});

describe("machine shape", () => {
  it("exposes the initial state and the original definition", () => {
    expect(flowMachine.initial).toEqual({ kind: "home" });
    expect(flowMachine.definition.initial).toBe(flowMachine.initial);
    expect(Object.keys(flowMachine.definition.states).sort()).toEqual([
      "detail",
      "drafting",
      "home",
      "list",
      "revising",
    ]);
  });
});
