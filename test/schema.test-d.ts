import { test } from "vitest";
import { z } from "zod";
import type { Definition } from "../src/index";

const StateSchema = z.discriminatedUnion("step", [
  z.object({ step: z.literal("off") }),
  z.object({ step: z.literal("on"), turnedOnAt: z.number() }),
]);
type SwitchState = z.infer<typeof StateSchema>;

const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("powerOn"), at: z.number() }),
  z.object({ type: z.literal("powerOff") }),
]);
type SwitchAction = z.infer<typeof ActionSchema>;

const steps: Definition<SwitchState, SwitchAction>["steps"] = {
  off: { powerOn: (_state, action) => ({ step: "on", turnedOnAt: action.at }) },
  on: { powerOff: () => ({ step: "off" }) },
};

test("a schema whose output drifts from the union is rejected at the property", () => {
  const DriftedSchema = z.object({ step: z.literal("on"), turnedOnAt: z.string() }); // turnedOnAt: string ≠ number
  const _def: Definition<SwitchState, SwitchAction> = {
    initial: { step: "off" },
    steps,
    schema: {
      // @ts-expect-error the schema's output does not match the state union
      state: DriftedSchema,
    },
  };
});

test("an action schema with a wrong payload type is rejected too", () => {
  const DriftedSchema = z.object({ type: z.literal("powerOn"), at: z.boolean() });
  const _def: Definition<SwitchState, SwitchAction> = {
    initial: { step: "off" },
    steps,
    schema: {
      // @ts-expect-error the schema's output does not match the action union
      action: DriftedSchema,
    },
  };
});

test("documented caveat: a schema covering only a subset of the union compiles", () => {
  // Covariance cannot catch a too-narrow schema — its output is still
  // assignable to the union. The recipe that removes the risk entirely is to
  // derive the union types from the schemas (as this file does), so there is
  // no second declaration to drift.
  const SubsetSchema = z.object({ step: z.literal("off") });
  const _def: Definition<SwitchState, SwitchAction> = {
    initial: { step: "off" },
    steps,
    schema: { state: SubsetSchema },
  };
});
