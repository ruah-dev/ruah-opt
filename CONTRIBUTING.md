# Contributing to @ruah-dev/opt

Thanks for your interest in contributing! `@ruah-dev/opt` is the cost and token analytics layer of the ruah ecosystem — it reads canonical traces and tells you what your agents spend.

## Getting Started

```bash
# Clone the repo (and the schema sibling — file:../ruah-schema must resolve)
git clone https://github.com/ruah-dev/ruah-schema.git
git clone https://github.com/ruah-dev/ruah-opt.git
cd ruah-schema && npm install && npm run build && cd ../ruah-opt

# Install dev dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Typecheck
npm run typecheck

# Lint
npm run lint
```

## Project Structure

```
src/
  index.ts        Public API surface (analyze, load, estimate, prices)
  types.ts        Report/option types specific to ruah-opt (NOT canonical schema types)
  estimator.ts    Hand-rolled token estimator (chars/4 + word-boundary blend)
  prices.ts       Built-in PRICE_TABLE, .ruah/opt.json overrides, model matching
  traces.ts       Trace loading from .ruah/traces/ (JSON + JSONL, tolerant)
  analyze.ts      Cost/token breakdowns, top spans, wasted-token detection
  format.ts       Markdown table rendering for human output
  version.ts      Package version lookup
  cli.ts          CLI implementation (analyze / cost / count / prices)
bin/
  ruah-opt.js     Thin ESM wrapper importing dist/cli.js
test/
  *.test.ts       Tests (node:test built-in runner, compiled via tsconfig.test.json)
```

## Development Guidelines

### Canonical Types Come From the Schema

`Trace`, `TraceSpan`, `Workflow`, `Task`, etc. are imported (type-only) from `@ruah-dev/schema`. Never redefine them locally. Types that are genuinely opt-specific (report shapes, price entries) live in `src/types.ts`.

### Zero Runtime Dependencies

This is a hard constraint. The package ships with zero `dependencies` in package.json. If you need functionality that typically comes from a package, implement it with Node.js built-ins (see `src/estimator.ts`).

### Config Root Is `.ruah/`

All reads resolve against the consumer's current working directory: traces from `.ruah/traces/`, config from `.ruah/opt.json`. Never invent a new config root and never touch the package's own folder at runtime.

### Tolerant Ingestion

Trace ingestion must never crash on bad input. Malformed files and JSONL lines become entries in `warnings`; analysis proceeds with whatever parsed.

### Prices Are Placeholders

The built-in `PRICE_TABLE` is a clearly-marked snapshot of mid-2026 list prices. Keep it honest: update the `PRICE_TABLE_NOTE`, keep entries overridable, and never silently price an unknown model (it goes to `unpricedModels` instead).

### TypeScript Strict Mode

The codebase uses `strict: true`. All code must pass `tsc --noEmit` with no errors.

### Testing

Tests use the Node.js built-in test runner (`node:test`). No test frameworks.

```bash
# Run all tests
npm test

# Run a single test file
npx tsc -p tsconfig.test.json && node --test dist-test/test/analyze.test.js
```

Tests must use temp directories (`fs.mkdtemp`) and never write into the package folder or a real `.ruah/`.

### Linting & Formatting

We use [Biome](https://biomejs.dev/):

```bash
npm run lint     # check
npm run format   # auto-fix
```

### Commit Convention

```
type(scope): description
```

Types: `feat`, `fix`, `docs`, `refactor`, `style`, `test`, `chore`

Examples:
- `feat(waste): detect duplicated retrieval chunks`
- `fix(traces): accept spans with missing startedAt in JSONL streams`

### Branch Strategy

Trunk-based development on `main`:

1. Fork the repo
2. Create a feature branch from `main`
3. Make your changes
4. Ensure all checks pass: `npm run build && npm run typecheck && npm run lint && npm test`
5. Open a PR against `main`

## Bug Reports

Open an issue with:
- package version (`ruah-opt --version`)
- Node.js version (`node --version`)
- OS
- Steps to reproduce (a minimal trace file helps a lot)
- Expected vs actual behavior

## Running the CLI Locally

```bash
npm run build
node bin/ruah-opt.js --help
node bin/ruah-opt.js prices --json
```

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
