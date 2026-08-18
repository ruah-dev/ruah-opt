# AGENTS.md

## Project: @ruah-dev/opt

Agent cost and token analytics for the ruah ecosystem. Reads canonical `Trace` files from `.ruah/traces/`, estimates tokens, prices spend per model/task/workflow, and flags wasted tokens. Analytics first — optimization layers come later.

## Quality Gates

All changes must pass these checks before commit:

### Lint & format
1. `npm run format` (biome check --write)
2. `npm run lint` (biome check)

### Types & tests
1. `npm run build`
2. `npm run typecheck`
3. `npm test` (compiles TS tests via tsconfig.test.json, runs node:test)

## Coding Standards

- **Zero runtime dependencies.** Node built-ins only. Dev deps are fine.
- **Canonical types come from `@ruah-dev/schema`** (`Trace`, `TraceSpan`, ...). Type-only imports. Never redefine them locally.
- TypeScript `strict: true`; code must pass `tsc --noEmit`.
- Tests use the built-in `node:test` runner — no test frameworks.
- Tests must use temp dirs (`fs.mkdtemp`) — never write into the package folder or a real `.ruah/`.
- Conventional commits (feat:, fix:, docs:, etc.).
- No hardcoded secrets — grep for sk_live, AKIA, password= before commit.

## Opt-Specific Rules

- **Read/write only under `.ruah/` in the consumer's CWD** (`process.cwd()`), never inside the package folder. Config lives at `.ruah/opt.json`; traces are read from `.ruah/traces/`.
- **Tolerant trace ingestion.** Both single-JSON trace files and JSONL event streams must parse. Malformed files/lines become warnings, never crashes.
- **Prices are placeholders.** The built-in `PRICE_TABLE` is a clearly-marked snapshot; users override via `.ruah/opt.json` `{ "prices": { ... } }`. Never present built-in prices as authoritative.
- **Works standalone.** `ruah-orch` emits the traces this tool reads, but it must never be imported or required at runtime. Degrade gracefully when `.ruah/traces/` is absent.
- The CLI must keep the contract: `--help`/`-h`/`--version` exit 0; every command supports `--json` (pure JSON on stdout, human logs on stderr); exit codes 0 success / 1 user error / 2 internal error.
