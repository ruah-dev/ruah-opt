/**
 * @ruah-dev/opt — agent cost & token analytics.
 *
 * Profile what your agents spend before optimizing it. Reads canonical
 * `Trace` files (types from `@ruah-dev/schema` — never redefined here) from
 * `.ruah/traces/`, prices spend per model/task/workflow, and flags wasted
 * tokens.
 *
 * Exports:
 * - `profile(tracesDir?, options?)` — load + analyze in one async call
 * - `analyzeTraces(traces, options?)` — pure analysis over in-memory traces
 * - `loadTraces` / `loadTraceFile` — tolerant JSON/JSONL trace ingestion
 * - `estimateTokens` / `estimateText` — hand-rolled token estimator
 * - `PRICE_TABLE`, `resolvePrices`, `findPrice`, `loadOptConfig` — pricing
 * - `VERSION` for downstream version negotiation
 */

export * from "./analyze.js";
export * from "./claude.js";
export * from "./estimator.js";
export * from "./format.js";
export * from "./html.js";
export * from "./prices.js";
export * from "./traces.js";
export { VERSION } from "./version.js";
export * from "./waste.js";
