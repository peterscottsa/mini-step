import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createState, defineMachine } from "../src/index";
import type { StandardSchemaV1 } from "../src/index";

// The recommended recipe: derive the union types FROM the schemas, so the
// types and the validation can never drift apart.
const StateSchema = z.discriminatedUnion("step", [
  z.object({ step: z.literal("off") }),
  z.object({ step: z.literal("on"), since: z.number() }),
]);
type SwitchState = z.infer<typeof StateSchema>;

const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("powerOn"), at: z.number() }),
  z.object({ type: z.literal("powerOff") }),
]);
type SwitchAction = z.infer<typeof ActionSchema>;

const switchMachine = defineMachine(
  createState<SwitchState, SwitchAction>({
    initial: { step: "off" },
    states: {
      off: {
        powerOn: (_state, action) => ({ step: "on", since: action.at }),
      },
      on: { powerOff: () => ({ step: "off" }) },
    },
    schema: { state: StateSchema, action: ActionSchema },
  }),
);

describe("decodeState / decodeAction", () => {
  it("returns a typed value for data that matches the schema", () => {
    const result = switchMachine.decodeState({ step: "on", since: 5 });
    expect(result.issues).toBeUndefined();
    expect(result).toEqual({ value: { step: "on", since: 5 } });
  });

  it("returns issues, not a throw, for data that does not match", () => {
    const result = switchMachine.decodeState({ step: "on" });
    expect(result.issues).toBeDefined();
    expect(result.issues?.length).toBeGreaterThan(0);
    expect(result.issues?.[0]?.message).toBeTypeOf("string");
  });

  it("decodes an outside action and advances with it", () => {
    const raw: unknown = JSON.parse('{"type":"powerOn","at":42}');
    const result = switchMachine.decodeAction(raw);
    expect(result.issues).toBeUndefined();
    if (!result.issues) {
      const next = switchMachine.advance(switchMachine.initial, result.value);
      expect(next).toEqual({ step: "on", since: 42 });
    }
  });

  it("rejects a malformed outside action instead of advancing", () => {
    const raw: unknown = JSON.parse('{"type":"powerOn","at":"yesterday"}');
    const result = switchMachine.decodeAction(raw);
    expect(result.issues).toBeDefined();
  });

  it("throws a misconfiguration error when no schema is set", () => {
    const bare = defineMachine(
      createState<SwitchState, SwitchAction>({
        initial: { step: "off" },
        states: {
          off: { powerOn: (_state, action) => ({ step: "on", since: action.at }) },
          on: { powerOff: () => ({ step: "off" }) },
        },
      }),
    );

    expect(() => bare.decodeState({ step: "off" })).toThrowError(
      "[minism] No state schema configured — set `schema.state` in the definition to decode states.",
    );
    expect(() => bare.decodeAction({ type: "powerOff" })).toThrowError(
      "[minism] No action schema configured — set `schema.action` in the definition to decode actions.",
    );
  });

  it("throws on schemas that validate asynchronously", () => {
    const asyncSchema: StandardSchemaV1<unknown, SwitchState> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: () => Promise.resolve({ value: { step: "off" } }),
      },
    };

    const machine = defineMachine(
      createState<SwitchState, SwitchAction>({
        initial: { step: "off" },
        states: {
          off: { powerOn: (_state, action) => ({ step: "on", since: action.at }) },
          on: { powerOff: () => ({ step: "off" }) },
        },
        schema: { state: asyncSchema },
      }),
    );

    expect(() => machine.decodeState({ step: "off" })).toThrowError(
      "[minism] Async schemas are not supported — validation must be synchronous.",
    );
  });

  it("accepts any Standard Schema implementation, not just zod", () => {
    const handRolled: StandardSchemaV1<unknown, SwitchState> = {
      "~standard": {
        version: 1,
        vendor: "hand-rolled",
        validate: (value) =>
          typeof value === "object" && value !== null && "step" in value
            ? { value: value as SwitchState }
            : { issues: [{ message: "not a state" }] },
      },
    };

    const machine = defineMachine(
      createState<SwitchState, SwitchAction>({
        initial: { step: "off" },
        states: {
          off: { powerOn: (_state, action) => ({ step: "on", since: action.at }) },
          on: { powerOff: () => ({ step: "off" }) },
        },
        schema: { state: handRolled },
      }),
    );

    expect(machine.decodeState({ step: "off" })).toEqual({ value: { step: "off" } });
    expect(machine.decodeState(7).issues?.[0]?.message).toBe("not a state");
  });
});
