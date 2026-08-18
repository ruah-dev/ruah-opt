# @ruah-dev/opt

> **Where did my tokens go?**

Point it at a session you already have. The first-priority input is a Claude
Code transcript (`~/.claude/projects/<slug>/*.jsonl`) — not a canonical
`Trace` that only other ruah tools emit. Canonical Trace is the second adapter.

```bash
npm i -g @ruah-dev/opt            # also installs `ruah`
ruah opt analyze ~/.claude/projects/<slug>/ --json
ruah opt waste ~/.claude/projects/<slug>/<session>.jsonl
ruah opt report ~/.claude/projects/<slug>/<session>.jsonl --format html --out report.html
```

Requires Node.js >= 18. **Zero runtime dependencies** for the engine. Peer:
`@ruah-dev/schema`. `@ruah-dev/cli` is a *front-door* install dep so `ruah opt`
exists after `npm i -g @ruah-dev/opt`; the library does not import it.

**Phase 1: profiler only.** It shows the bill. It does not compact, route, or
cache. Cache-read / cache-write tokens are reported separately from `tokensIn`
— mixing them inflates cost and destroys credibility.

## 30-second quickstart

On this workspace (2026-08-18, one real Claude Code session):

```
Tokens: 54 in / 27,200 out (27,254 total); cache 1,184,582 read / 1,092,910 write
Cost: $0.8163
```

Most of the bill is **cache**, not new input. That is the answer to the
question. Run it on yesterday's session:

```bash
ruah opt analyze ~/.claude/projects/$(pwd | tr / -)/ --json
```

## JSON output

```bash
$ ruah opt analyze session.jsonl --json
{
  "ok": true,
  "report": {
    "generatedAt": "2026-08-18T21:41:55.623Z",
    "tracesDir": "session.jsonl",
    "summary": {
      "traces": 1,
      "spans": 41,
      "llmSpans": 27,
      "tokensIn": 54,
      "tokensOut": 27200,
      "tokensCacheRead": 1184582,
      "tokensCacheWrite": 1092910,
      "totalTokens": 27254,
      "costUsd": 0.816324,
      "durationMs": 1403077,
      "models": ["claude-fable-5"],
      "unpricedModels": []
    },
    "byModel": [
      { "key": "claude-fable-5", "spans": 27, "tokensIn": 54, "tokensOut": 27200, "costUsd": 0.816324 }
    ],
    "topSpans": [],
    "waste": { "estimatedWastedTokens": 0 },
    "warnings": []
  }
}
```

`tokensCacheRead` / `tokensCacheWrite` are **not** included in `tokensIn`.
Totals that match the transcript's own usage fields are labeled as reported;
heuristic estimates are labeled `estimated` (or `~` in tables). Unknown models
get `cost: null` and a warning — never a guess presented as fact.

Exit codes: `0` success · `1` user error · `2` internal. `--json` keeps
machines on stdout and humans on stderr.

## Waste

`ruah opt waste` ranks context-bloat. Each finding has a heuristic id and a
one-line fix.

| Id | What it flags | Typical fix |
|----|---------------|-------------|
| H1 | Oversized tool result | Bound / summarize the result before it re-enters context |
| H2 | Same file/args read ≥3× | Cache the read in the session; stop re-opening the file |
| H3 | Immediate re-read of the same target | Don't re-fetch what you just saw |
| H4 | Compaction / context-refresh churn | The summarization itself is on the bill — shrink what you keep |

Heuristics are versioned (`heuristicsVersion`) and individually testable.
They misfire; the README is honest about that. A finding is a lead, not a
verdict.

```bash
ruah opt waste session.jsonl --json
```

## HTML report

```bash
ruah opt report session.jsonl --format html --out report.html
```

One self-contained file. Inline SVG, `prefers-color-scheme`, no CDN, no
network. Transcript text is escaped. Open it from `file://`.

Weekly loop: run Sunday, screenshot the headline, post. The file is the
recurring asset.

## Second adapter: canonical Trace

If you already have [`Trace`](https://github.com/ruah-dev/ruah-schema) JSON
under `.ruah/traces/`, `ruah opt analyze` still works. First-priority input
is still the Claude Code transcript — this path is optional.

```bash
ruah opt analyze                  # .ruah/traces/ under cwd
ruah opt analyze .ruah/traces/ --json
```

Malformed files become warnings, never crashes. Torn last JSONL lines
(session killed mid-write) are skipped and counted.

## Prices

Built-in table is a **placeholder snapshot** of mid-2026 list prices (USD
per 1M tokens). Override in `.ruah/opt.json`:

```json
{
  "prices": {
    "claude-fable-5": { "inputPerMTok": 6, "outputPerMTok": 30 },
    "my-local-model": { "inputPerMTok": 0, "outputPerMTok": 0 }
  },
  "waste": { "inputTokenThreshold": 20000 }
}
```

Model ids match exactly first, then by longest prefix. Spans that carry
their own `costUsd` win over the table. Cache tokens are priced at cache
rates, not input rates.

## Commands

| Command | What it does |
|---------|--------------|
| `ruah opt analyze [dir\|session.jsonl] [--json]` | Totals, breakdowns, top spans, cache separate |
| `ruah opt waste [dir\|session.jsonl] [--json]` | Rank H1–H4 context-bloat |
| `ruah opt report [dir\|session.jsonl] --format html --out report.html` | Self-contained HTML |
| `ruah opt cost [dir] [--by model\|task\|workflow]` | Cost breakdown |
| `ruah opt count <file...>` | Heuristic token estimate for arbitrary text |
| `ruah opt prices` | Effective price table |

Standalone binary `ruah-opt` is identical.

## Composition

```bash
ruah opt analyze session.jsonl --json > spend.json
ruah watch render session.jsonl --out replay.html
```

## Library API

```ts
import { analyzeTraces, estimateTokens, profile } from "@ruah-dev/opt";

const report = await profile();            // .ruah/traces under process.cwd()
console.log(report.summary.tokensCacheRead, report.summary.costUsd);

estimateTokens("how many tokens is this?"); // heuristic, ±20%
```

Canonical types (`Trace`, `TraceSpan`, …) come from
[`@ruah-dev/schema`](https://github.com/ruah-dev/ruah-schema) — never
redefined here.

## Honest limits

- **No optimization** — measure first.
- **No exact tokenizer** — when the transcript reports usage, those numbers
  win; otherwise the estimator is chars/words (~±20%) and labeled.
- **No live capture** — reads files after the fact.
- **No authoritative prices** — built-ins are placeholders.
- **No budget enforcement.**

## Links

- Ecosystem: [https://ruah.sh](https://ruah.sh)
- Organization: [https://github.com/ruah-dev](https://github.com/ruah-dev)
- Schema layer: [@ruah-dev/schema](https://github.com/ruah-dev/ruah-schema)

## License

MIT
