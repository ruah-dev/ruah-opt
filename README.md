# ruah-opt

> Agent cost & token analytics — profile spend before optimizing it.

[![CI](https://github.com/ruah-dev/ruah-opt/actions/workflows/ci.yml/badge.svg)](https://github.com/ruah-dev/ruah-opt/actions)
[![npm](https://img.shields.io/npm/v/@ruah-dev/opt)](https://www.npmjs.com/package/@ruah-dev/opt)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

`ruah-opt` reads agent execution traces and tells you exactly where your token budget goes: which models, which tasks, which workflows, which individual spans — and which tokens were flat-out wasted. It is the analytics layer of the [ruah](https://ruah.sh) ecosystem ([github.com/ruah-dev](https://github.com/ruah-dev)).

**Phase 1: profiler only.** You cannot reduce what you cannot see. Optimization layers (context compaction, model routing, cache/reuse) come later — first, `ruah-opt` shows you the bill.

- **Zero runtime dependencies.** Node.js built-ins only — nothing else is installed with it.
- **Standalone.** Works on any directory of trace files. [`ruah-orch`](https://github.com/ruah-dev/ruah-orch) emits the traces it reads, but is never required.
- **JSON-first.** Every command supports `--json` for pipelines; humans get markdown tables.

## Install

```bash
npm i -g @ruah-dev/opt
# pulls in @ruah-dev/cli — the command is `ruah opt`, not `ruah-opt`
ruah opt analyze
```

Requires Node.js >= 18.

## Quickstart

Run inside a repo where an orchestrator (or your own tooling) has written traces to `.ruah/traces/`:

```bash
ruah-opt analyze
```

```markdown
# ruah-opt report

- Traces: 2 (7 spans, 4 LLM spans)
- Tokens: 215,000 in / 7,600 out (222,600 total)
- Cost: $0.8500
- Duration: 30.0s

## Cost by model

| model             | spans | tokens in | tokens out | cost (USD) |
| ----------------- | ----- | --------- | ---------- | ---------- |
| claude-sonnet-4-6 | 2     | 80,000    | 6,000      | $0.7100    |
| claude-fable-5    | 1     | 10,000    | 1,000      | $0.0900    |

## Waste

- Estimated wasted tokens: 26

### Repeated tool outputs (identical, >= 2x)

| span      | occurrences | redundant | wasted tokens | preview                  |
| --------- | ----------- | --------- | ------------- | ------------------------ |
| read_file | 3           | 2         | 26            | function add(a, b) { ... |
```

Machine-readable, for pipelines:

```bash
ruah-opt analyze --json
```

```json
{
  "ok": true,
  "report": {
    "summary": {
      "traces": 2,
      "spans": 7,
      "llmSpans": 4,
      "tokensIn": 215000,
      "tokensOut": 7600,
      "totalTokens": 222600,
      "costUsd": 0.85,
      "durationMs": 30000,
      "models": ["claude-fable-5", "claude-sonnet-4-6"],
      "unpricedModels": []
    },
    "byModel": [
      { "key": "claude-sonnet-4-6", "spans": 2, "tokensIn": 80000, "tokensOut": 6000, "costUsd": 0.71 }
    ],
    "byTask": ["..."],
    "byWorkflow": ["..."],
    "topSpans": ["..."],
    "waste": {
      "inputTokenThreshold": 20000,
      "repeatedToolOutputs": [
        { "spanName": "read_file", "occurrences": 3, "redundantCalls": 2, "estimatedWastedTokens": 26 }
      ],
      "oversizedInputs": [
        { "spanName": "huge-context", "model": "claude-sonnet-4-6", "tokensIn": 120000 }
      ],
      "estimatedWastedTokens": 26
    },
    "warnings": []
  }
}
```

## Commands

| Command | What it does |
|---------|--------------|
| `ruah-opt analyze [tracesDir] [--top n] [--threshold n] [--json]` | Full report: totals, breakdowns, top spans, waste |
| `ruah-opt cost [tracesDir] [--by model\|task\|workflow] [--json]` | Cost breakdown (default: by model) |
| `ruah-opt count <file...> [--json]` | Token estimate for arbitrary text files |
| `ruah-opt prices [--json]` | Effective model price table (built-ins + overrides) |

All commands: exit `0` on success, `1` on user error, `2` on internal error. With `--json`, stdout is pure JSON and human logs go to stderr.

```bash
# Which task is burning the budget?
ruah-opt cost --by task

# How many tokens is this prompt before I send it anywhere?
ruah-opt count prompt.md context/*.md --json
```

```json
{
  "ok": true,
  "note": "heuristic estimate (~±20%), not a real tokenizer",
  "files": [{ "file": "prompt.md", "tokens": 1432, "chars": 6210, "words": 980, "lines": 74 }],
  "total": { "tokens": 1432, "chars": 6210, "words": 980, "lines": 74 }
}
```

## Trace input

`ruah-opt` reads every `.json` / `.jsonl` file under `.ruah/traces/` (or the directory you pass) and tolerates:

- a single canonical [`Trace`](https://github.com/ruah-dev/ruah-schema) object per file,
- a JSON array of traces,
- JSONL event streams — full traces per line, `{ "traceId", "span": {...} }` wrappers, or bare span events grouped by `traceId`.

Malformed files become warnings, never crashes. Spans missing token counts simply contribute zero; traces that only carry `totals` still count toward summary/task/workflow numbers. The `Trace` shape is the canonical one from [`@ruah-dev/schema`](https://github.com/ruah-dev/ruah-schema) — the same format `ruah-orch` emits and `ruah-obs` shares.

## Prices

The built-in price table is a **placeholder snapshot of mid-2026 list prices** (USD per 1M tokens) for `claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`, `gpt-5.2`, `gpt-5-mini`, `gemini-3-pro`, `gemini-3-flash`. Providers change prices without notice — override anything (or add your own models) in `.ruah/opt.json`:

```json
{
  "prices": {
    "claude-fable-5": { "inputPerMTok": 6, "outputPerMTok": 30 },
    "my-local-model": { "inputPerMTok": 0, "outputPerMTok": 0 }
  },
  "waste": { "inputTokenThreshold": 20000 }
}
```

Model ids match exactly first, then by longest prefix — `claude-sonnet-4-6-20260115` resolves to the `claude-sonnet-4-6` entry. Models with token usage but no price entry are reported in `unpricedModels` and excluded from cost (never silently guessed). Spans that carry their own `costUsd` are always preferred over table estimates.

## Library use

```ts
import { analyzeTraces, estimateTokens, profile } from "@ruah-dev/opt";

const report = await profile();            // .ruah/traces under process.cwd()
console.log(report.summary.costUsd);

estimateTokens("how many tokens is this?"); // heuristic, ±20%
```

All trace types come from [`@ruah-dev/schema`](https://github.com/ruah-dev/ruah-schema) — `ruah-opt` never redefines them.

## What v0.1 does NOT do

- **No optimization.** It measures; it does not compact context, dedupe retrievals, route models, or cache anything. That is the next layer, built on these numbers.
- **No exact token counts.** The estimator is a chars/words heuristic (~±20%). When traces carry real `tokensIn`/`tokensOut`, those are used as-is.
- **No live capture.** It reads trace files after the fact; it does not hook into agents or proxy API calls.
- **No authoritative prices.** Built-ins are clearly-marked placeholders; bring your own via `.ruah/opt.json`.
- **No budget enforcement.** Budget policies per workflow are on the roadmap, not in this release.

## Zero runtime dependencies

`@ruah-dev/opt` ships with an empty `dependencies` field — Node.js built-ins only, matching the rest of the [ruah](https://ruah.sh) ecosystem. `@ruah-dev/schema` is a (types-only at runtime) peer for the canonical vocabulary.

## Ecosystem

| Package | Role |
|---------|------|
| [`@ruah-dev/schema`](https://github.com/ruah-dev/ruah-schema) | Canonical `Trace`/`Task`/`Workflow` types this tool consumes |
| [`@ruah-dev/orch`](https://github.com/ruah-dev/ruah-orch) | Orchestrator that emits the traces (optional, never required) |
| [`@ruah-dev/cli`](https://github.com/ruah-dev/ruah-cli) | Umbrella CLI — auto-discovers `ruah-opt` as `ruah opt` |

Website: [ruah.sh](https://ruah.sh) · Org: [github.com/ruah-dev](https://github.com/ruah-dev)

## License

[MIT](LICENSE)
