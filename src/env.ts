/**
 * Dev detection. Warns wherever `process.env.NODE_ENV` is present and not
 * "production" (Node, Metro, Jest/Vitest), and in environments with no
 * `process` at all. Bundlers that define `NODE_ENV` statically (webpack,
 * Vite, Next) get the check eliminated from production builds.
 */
export const inDev = (): boolean =>
  typeof process === "undefined" || process.env.NODE_ENV !== "production";
