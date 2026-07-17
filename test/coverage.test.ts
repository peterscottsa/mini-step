import { describe, expect, it } from "vitest";
import { assertCoverage, createStrictState, defineMachine, guarded } from "../src/index";
import { flowMachine } from "./fixtures/flow";
import { publishMachine } from "./fixtures/publish";

type ToggleState = { kind: "on" } | { kind: "off" };
type ToggleAction = { type: "toggle" } | { type: "reset" } | { type: "disable" };

describe("assertCoverage", () => {
  it("passes for the sync fixture — the one-line test in anger", () => {
    assertCoverage(flowMachine, [
      "goHome",
      "viewList",
      "viewDoc",
      "startDraft",
      "resumeDraft",
      "enterRevise",
      "showOutline",
      "showPreview",
      "setTitle",
      "setTags",
      "saveSuccess",
    ]);
  });

  it("passes for the async fixture", () => {
    assertCoverage(publishMachine, [
      "begin",
      "quotaResolved",
      "uploadSucceeded",
      "uploadFailed",
      "retry",
      "cancel",
    ]);
  });

  it("counts guarded slots as handled", () => {
    const machine = defineMachine<ToggleState, ToggleAction>({
      initial: { kind: "off" },
      states: {
        on: {
          toggle: () => ({ kind: "off" }),
          disable: guarded(
            (state: ToggleState): boolean => state.kind === "on",
            (): ToggleState => ({ kind: "off" }),
          ),
        },
        off: { toggle: () => ({ kind: "on" }), reset: () => ({ kind: "off" }) },
      },
    });

    assertCoverage(machine, ["toggle", "reset", "disable"]);
  });

  it("throws, naming every action type no state handles", () => {
    const machine = defineMachine<ToggleState, ToggleAction>({
      initial: { kind: "off" },
      states: {
        on: { toggle: () => ({ kind: "off" }) },
        off: { toggle: () => ({ kind: "on" }) },
      },
    });

    expect(() =>
      assertCoverage(machine, ["toggle", "reset", "disable"]),
    ).toThrowError(
      '[minism] Uncovered action types: "reset", "disable" — no state handles them.',
    );
  });
});

describe("createStrictState", () => {
  it("is identity at runtime and composes with defineMachine", () => {
    const definition = createStrictState<ToggleState, ToggleAction>()({
      initial: { kind: "off" },
      states: {
        on: { toggle: () => ({ kind: "off" }), disable: () => ({ kind: "off" }) },
        off: { toggle: () => ({ kind: "on" }), reset: () => ({ kind: "off" }) },
      },
    });

    const machine = defineMachine(definition);
    expect(machine.definition).toBe(definition);
    expect(machine.advance({ kind: "off" }, { type: "toggle" })).toEqual({
      kind: "on",
    });
  });
});
