# Changelog

All notable changes to `@ruah-dev/opt` are documented here.

## Unreleased

## 0.1.1 — 2026-08-19

### Changed

- README, PLAN, and `--help` lead with “Where did my tokens go?” First-priority
  input is a Claude Code transcript; cache tokens stay out of `tokensIn`. CLI
  test locks the question. M1 proven on a real ruah-tools session
  (54 in / 27,200 out; cache 1.18M read / 1.09M write).

### Added

- Claude Code transcript adapter (`src/claude.ts`). Point `ruah-opt analyze`
  at a session `.jsonl` or a directory of them. Cache tokens are kept
  separate (`tokensCacheRead` / `tokensCacheWrite`). Torn last lines are
  skipped with a warning.
- `analyze` accepts a single file, not just a traces directory.
- Transcripts that start with `custom-title` / `mode` are recognized as Claude Code sessions (real sessions do this).
- `ruah-opt waste` — H1 oversized result, H2 repeated reads, H3 immediate re-read, H4 compaction. Each finding has a one-line fix.
- `ruah-opt report --format html --out report.html` — self-contained, no CDN, escapes untrusted text.

## 0.1.0 — 2026-06-12

Initial release — analytics/profiler mode only.

- Trace ingestion from `.ruah/traces/`: tolerates single-JSON trace files, JSON arrays of traces, and JSONL event streams (full traces per line or span events grouped by `traceId`); malformed files become warnings, never crashes
- Hand-rolled token estimator (`estimateTokens`) — chars/4 blended with a word-boundary correction, zero deps
- Built-in `PRICE_TABLE` (claude-fable-5, claude-opus-4-8, claude-sonnet-4-6, claude-haiku-4-5, gpt-5.2, gpt-5-mini, gemini-3-pro, gemini-3-flash) — placeholder mid-2026 list prices, overridable via `.ruah/opt.json` `{ "prices": { ... } }`
- Prefix model matching: `claude-sonnet-4-6-20260115` resolves to the `claude-sonnet-4-6` price entry
- Analysis: summary stats, cost/token breakdowns by model, by task, and by workflow, top-N most expensive spans, wasted-token detection (identical repeated tool outputs ≥2×, spans whose input tokens exceed a configurable threshold)
- CLI `ruah-opt` with `analyze [tracesDir]`, `cost [tracesDir] --by model|task|workflow`, `count <file...>`, and `prices` — all supporting `--json`; markdown tables for humans; exit codes 0/1/2
- Public typed API: `analyzeTraces`, `loadTraces`, `estimateTokens`, `estimateText`, `resolvePrices`, `findPrice`, `loadOptConfig` — `Trace`/`TraceSpan` types come from `@ruah-dev/schema`
