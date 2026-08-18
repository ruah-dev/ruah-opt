# ruah-opt — Deep Build Plan

> Read first: `../GROK_BUILD_PLAN.md` §T3, `../ENGINEERING_STANDARDS.md`.
> Package: `@ruah-dev/opt` · CLI: `ruah opt …` · Build slot: **T3 (content engine #1)**

## 1. Where the code is today (verified 2026-08-18)

61/61 tests pass, CLI runs. Modules: `analyze.ts` (13K), `traces.ts` (canonical
Trace ingestion), `estimator.ts`, `prices.ts` (price table), `format.ts`, `cli.ts`.
Phase-1 profiler per its README. **Critical gap:** no Claude Code transcript
adapter — it only reads canonical `Trace` objects, i.e. data almost nobody has yet.
The adapter IS the product's adoption story. That's M1.

## 2. Product shape

Token X-ray. Point it at agent traces → exactly where tokens and money went
(model / session / task / span) and which tokens were waste. Profiler only; no
optimization features in this phase (measure first).

### Input adapters (one internal model, N adapters)

1. **Claude Code session transcripts** — JSONL under
   `~/.claude/projects/<slug>/*.jsonl`. THE wedge: every CC user has them today.
2. Canonical `Trace` (`@ruah-dev/schema`) — exists, keep.
3. OpenTelemetry GenAI spans — out of scope this phase; leave an adapter seam.

Adapter contract: `parse(lines) → InternalSession` (normalized turns/spans with
role, model, tokens in/out/cache-read/cache-write, tool name, result byte-size,
timestamps). All analytics run on `InternalSession` only — analytics code must
never know which adapter fed it.

**Adapter engineering notes (hard-won transcript realities — encode as tests):**
- Torn/truncated final JSONL line (session killed mid-write) → skip with a counted
  warning to stderr, never crash.
- Unknown record types and future fields → ignore, don't fail (forward compat).
- Prefer usage fields recorded in the transcript itself over estimation; fall back
  to `estimator.ts` per span and **label every estimated number as estimated**
  (`"source": "reported" | "estimated"` in JSON, `~` prefix in tables).
- Cache tokens are not regular input tokens — price and report them separately;
  conflating them inflates "cost" and destroys credibility.
- Multi-session dirs: aggregate per session, then across; sidechain/subagent
  transcripts attach to their parent where the linkage exists.

### Pricing
`prices.ts`: versioned data table (model → per-MTok in/out/cache rates) with
`--price-table <file>` override and a `pricesAsOf` date stamped into every output.
Unknown model → cost `null` + warning, never a guess presented as fact.

## 3. Work plan

### M1 — Claude Code adapter + cost tables
- `ruah opt analyze <dir|file> [--json]`: per-session table — turns, tokens by
  class (in/out/cache-r/cache-w), cost, top model; `--by model|session|tool`.
- Fixture pack: 4–6 real-shaped transcript fixtures (hand-trimmed, redacted):
  happy path, torn line, unknown-fields, subagent link, huge-tool-result, empty.
- Report contract JSON with `schemaVersion`, sorted keys, `pricesAsOf`, `source`
  labels per standards §3.

### M2 — `ruah opt waste`
Rank spans by waste heuristics; each finding: tokens, % of session, one-line fix.
- H1 oversized tool result (result bytes → est. tokens > threshold, default 10k)
- H2 repeated reads (same file/args tool call ≥3×; report cumulative cost)
- H3 dead weight (tool result immediately followed by re-request/summary of same
  target; heuristic, labeled as such)
- H4 context-refresh churn (compaction/summarization events and their token bill)
Output ranked, each with `heuristic` id — heuristics are versioned, documented in
README with honest false-positive notes, and individually testable.

### M3 — HTML report + release
- `ruah opt report --format html --out report.html`: single self-contained file,
  inline SVG charts (no chart libs — zero-dep rule), light/dark via
  `prefers-color-scheme`, screenshot-composed: headline number ("this week: $X,
  N MTok"), stacked bar per session, waste top-10 table. Escape ALL transcript
  content (standards §5); zero external resource refs (tested).
- README rewrite + CHANGELOG + tag. Weekly-personal-report usage documented — this
  file is the recurring Twitter asset.

## 4. Testing plan (beyond existing 61)

- Adapter: every fixture above; totals validated against the transcript's own
  usage fields exactly (no estimation drift on reported data).
- Waste: seeded fixture where H1's #1 offender is a 200KB tool result → asserted
  rank 1; each heuristic has a positive and a negative fixture.
- Pricing: unknown model → null + warning; override table honored; cache priced
  at cache rates (regression test with hand-computed expected cost).
- HTML: golden-file snapshot; `<script>alert(1)</script>` in a tool result renders
  escaped; grep output for `http://`/`https://` resource refs → none.
- Determinism: byte-identical `--json` across two runs.
- Performance: 10MB synthetic transcript analyzed < 2s.

## 5. Acceptance criteria

- `ruah opt analyze ~/.claude/projects/<real project>/` → correct totals (match
  transcript usage fields), cost with `pricesAsOf`, top-10 spans.
- `ruah opt waste` on the seeded fixture → the 200KB result is finding #1.
- `report.html` opens from `file://` with zero network requests.
- Works via `ruah opt …` and standalone. Zero runtime deps. Verify green.

## 6. Demo asset (required — `files/demos/opt/`)

Screenshot of report.html with a real week of usage: "my agent spent 40% of
context on git noise." Plus the terminal one-liner. This recurs weekly — M3's
README documents the loop (run Sunday, screenshot, post).

## 7. Don'ts

- No optimization/compaction/routing features (phase 2, not now).
- No LLM calls, no network, no telemetry.
- Never present an estimate as a measurement — label or drop.
