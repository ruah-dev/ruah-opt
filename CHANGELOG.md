# Changelog

All notable changes to `@ruah-dev/opt` are documented here.

## 0.1.0 — 2026-06-12

Initial release — analytics/profiler mode only.

- Trace ingestion from `.ruah/traces/`: tolerates single-JSON trace files, JSON arrays of traces, and JSONL event streams (full traces per line or span events grouped by `traceId`); malformed files become warnings, never crashes
- Hand-rolled token estimator (`estimateTokens`) — chars/4 blended with a word-boundary correction, zero deps
- Built-in `PRICE_TABLE` (claude-fable-5, claude-opus-4-8, claude-sonnet-4-6, claude-haiku-4-5, gpt-5.2, gpt-5-mini, gemini-3-pro, gemini-3-flash) — placeholder mid-2026 list prices, overridable via `.ruah/opt.json` `{ "prices": { ... } }`
- Prefix model matching: `claude-sonnet-4-6-20260115` resolves to the `claude-sonnet-4-6` price entry
- Analysis: summary stats, cost/token breakdowns by model, by task, and by workflow, top-N most expensive spans, wasted-token detection (identical repeated tool outputs ≥2×, spans whose input tokens exceed a configurable threshold)
- CLI `ruah-opt` with `analyze [tracesDir]`, `cost [tracesDir] --by model|task|workflow`, `count <file...>`, and `prices` — all supporting `--json`; markdown tables for humans; exit codes 0/1/2
- Public typed API: `analyzeTraces`, `loadTraces`, `estimateTokens`, `estimateText`, `resolvePrices`, `findPrice`, `loadOptConfig` — `Trace`/`TraceSpan` types come from `@ruah-dev/schema`
