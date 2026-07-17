import { expectTypeOf, test } from "vitest";
import { assertCoverage, createStrictState } from "../src/index";
import type { StateOf } from "../src/index";
import { flowMachine } from "./fixtures/flow";

type ToggleState = { step: "on" } | { step: "off" };
type ToggleAction = { type: "toggle" } | { type: "reset" } | { type: "disable" };

test("assertCoverage rejects an incomplete action-type list", () => {
  // @ts-expect-error the list is missing 'saveSuccess' (and more)
  assertCoverage(flowMachine, ["goHome", "viewList"]);
});

test("createStrictState accepts a definition that handles every action", () => {
  createStrictState<ToggleState, ToggleAction>()({
    initial: { step: "off" },
    states: {
      on: {
        toggle: (state) => {
          // The constraint still contextually narrows handler parameters.
          expectTypeOf(state).toEqualTypeOf<StateOf<ToggleState, "on">>();
          return { step: "off" };
        },
        disable: () => ({ step: "off" }),
      },
      off: { toggle: () => ({ step: "on" }), reset: () => ({ step: "off" }) },
    },
  });
});

test("createStrictState rejects a definition with an unhandled action", () => {
  // @ts-expect-error 'reset' and 'disable' are handled by no state
  createStrictState<ToggleState, ToggleAction>()({
    initial: { step: "off" },
    states: {
      on: { toggle: () => ({ step: "off" }) },
      off: { toggle: () => ({ step: "on" }) },
    },
  });
});
