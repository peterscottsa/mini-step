/**
 * Docs-as-tests: every fenced `ts`/`tsx` code block in the README must
 * typecheck against the real source. Each block becomes its own module
 * (`export {}` appended), so examples cannot collide with each other, and all
 * modules compile in one `tsc` run. A failing block is identified by its
 * generated filename, which carries the README line the block starts on.
 *
 * Blocks may reference a few things a README example reasonably leaves out:
 * app placeholders (`Spinner`, `ErrorBanner`, `useT`, a test runner's
 * `test`), and the publish-flow machine that examples 3, 4, and 7 share.
 * Those are injected as ambient declarations — but only when a block uses
 * them without defining them, so a block that declares its own stays honest.
 *
 * (This shells out to `tsc` rather than using the compiler API because
 * TypeScript 7's JS API exposes only a version stub.)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(__dirname, "..");
const readme = readFileSync(path.join(projectRoot, "README.md"), "utf8");
const workDir = path.join(projectRoot, "node_modules", ".cache", "minism-readme");

type Block = { lang: string; code: string; line: number };

function extractBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const fence = /```(ts|tsx)\n([\s\S]*?)```/g;
  for (let match = fence.exec(markdown); match; match = fence.exec(markdown)) {
    const line = markdown.slice(0, match.index).split("\n").length;
    blocks.push({ lang: match[1] ?? "ts", code: match[2] ?? "", line });
  }
  return blocks;
}

const BASE_PREAMBLE = `
declare function useT(): (key: string) => string;
declare const Spinner: () => import("react").ReactNode;
declare const ErrorBanner: (props: { children?: import("react").ReactNode }) => import("react").ReactNode;
declare function test(name: string, fn: () => void | Promise<void>): void;
`;

// The publish flow that examples 3, 4, and 7 share. Example 3 defines its own
// copy inline and is compiled standalone, so drift between this context and
// the README shows up as a compile error in the consuming blocks.
const PUBLISH_CONTEXT = `
import type { Machine as MinismMachine } from "minism";
type PublishState =
  | { step: "idle" }
  | { step: "checkingQuota"; size: number }
  | { step: "uploading"; size: number }
  | { step: "done"; url: string }
  | { step: "failed"; reason: "quotaExceeded" | "network"; retryable: boolean };
type PublishAction =
  | { type: "begin"; size: number }
  | { type: "quotaResolved"; sufficient: boolean }
  | { type: "uploadSucceeded"; url: string }
  | { type: "uploadFailed" }
  | { type: "retry" }
  | { type: "cancel" };
type PublishDeps = {
  hasQuota: (size: number) => Promise<boolean>;
  upload: (size: number, signal: AbortSignal) => Promise<{ url: string }>;
};
declare const publishMachine: MinismMachine<PublishState, PublishAction, PublishDeps>;
`;

function assemble(block: Block): string {
  const usesPublish = /\b(publishMachine|PublishState|PublishAction|PublishDeps)\b/.test(
    block.code,
  );
  const definesPublish = /\b(?:type PublishState|const publishMachine)\b/.test(block.code);
  const context = usesPublish && !definesPublish ? PUBLISH_CONTEXT : "";
  return `${BASE_PREAMBLE}${context}${block.code}\nexport {};\n`;
}

const tsconfig = {
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "es2022",
    module: "esnext",
    moduleResolution: "bundler",
    jsx: "react-jsx",
    lib: ["es2022", "dom"],
    types: ["node"],
    skipLibCheck: true,
    // Relative to this generated tsconfig's directory (node_modules/.cache/minism-readme).
    paths: {
      minism: ["../../../src/index.ts"],
      "minism/react": ["../../../src/react.ts"],
    },
  },
  include: ["./*.tsx"],
};

describe("README code blocks", () => {
  const blocks = extractBlocks(readme);

  it("finds the fenced ts/tsx blocks", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(7);
  });

  it("every block typechecks against the real source", () => {
    rmSync(workDir, { recursive: true, force: true });
    mkdirSync(workDir, { recursive: true });
    writeFileSync(path.join(workDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
    for (const block of blocks) {
      writeFileSync(path.join(workDir, `readme-line-${block.line}.tsx`), assemble(block));
    }

    try {
      execFileSync(path.join(projectRoot, "node_modules", ".bin", "tsc"), ["-p", workDir], {
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      const output =
        error !== null && typeof error === "object" && "stdout" in error
          ? String(error.stdout)
          : String(error);
      expect.fail(
        `README examples failed to typecheck (filenames carry the README line the block starts on):\n${output}`,
      );
    }
  });
});
