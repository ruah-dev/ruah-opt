#!/usr/bin/env node

/**
 * ruah-opt CLI.
 *
 * Exit codes: 0 success, 1 user error, 2 internal error.
 * With --json, stdout carries pure machine-readable JSON and human logs go
 * to stderr.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type OptReport, profile } from "./analyze.js";
import { estimateText } from "./estimator.js";
import {
	formatInt,
	markdownTable,
	renderBuckets,
	renderReport,
} from "./format.js";
import { renderHtml } from "./html.js";
import { loadOptConfig, PRICE_TABLE_NOTE, resolvePrices } from "./prices.js";
import { loadTraces, TracesDirNotFoundError } from "./traces.js";
import { VERSION } from "./version.js";
import { findWaste, WASTE_HEURISTICS_VERSION } from "./waste.js";

export interface ParsedArgs {
	_: string[];
	flags: Record<string, string | boolean>;
}

const COST_GROUPINGS = ["model", "task", "workflow"] as const;
type CostGrouping = (typeof COST_GROUPINGS)[number];

function buildHelp(): string {
	return `
ruah-opt — Where did my tokens go?

Point it at a Claude Code session (or a traces dir). Cache tokens are
reported separately from tokensIn. Profiler only — it does not optimize.

Usage:
  ruah-opt analyze [tracesDir|session.jsonl] [--top <n>] [--threshold <tokens>] [--json]
                                          Full report: totals, breakdowns, top spans, waste
                                          First-priority input: a Claude Code session JSONL
  ruah-opt cost [tracesDir] [--by model|task|workflow] [--json]
                                          Cost breakdown (default: by model)
  ruah-opt waste [tracesDir|session.jsonl] [--json]
                                          Rank context-bloat offenders (H1–H4)
  ruah-opt report [tracesDir|session.jsonl] --format html [--out report.html]
                                          Self-contained HTML (offline, no CDN)
  ruah-opt count <file...> [--json]       Estimate tokens for arbitrary text files
  ruah-opt prices [--json]                Show the effective model price table

Options:
  --json           Machine-readable JSON on stdout (human logs go to stderr)
  --by <key>       Cost grouping: ${COST_GROUPINGS.join(" | ")}
  --top <n>        Top spans to include in the analyze report (default 10)
  --threshold <n>  Oversized-input threshold in tokens (default 20000)
  --help, -h       Show this help
  --version, -v    Show version

Config:
  Traces are read from .ruah/traces/ (or [tracesDir]) under the current
  working directory. Optional config at .ruah/opt.json:
    {
      "prices": { "<model>": { "inputPerMTok": 6, "outputPerMTok": 30 } },
      "waste": { "inputTokenThreshold": 20000 }
    }
  Built-in prices are placeholders — always overridable.

Exit codes:
  0  success
  1  user error (bad arguments, missing traces, unreadable file)
  2  internal error

Examples:
  ruah-opt analyze --json
  ruah-opt analyze ~/.claude/projects/<slug>/ --json
  ruah-opt waste session.jsonl --json
  ruah-opt report session.jsonl --format html --out report.html
`;
}

export function parseArgs(argv: string[]): ParsedArgs {
	const args: ParsedArgs = { _: [], flags: {} };
	let i = 0;
	while (i < argv.length) {
		const arg = argv[i];
		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			const next = argv[i + 1];
			if (!next || next.startsWith("-")) {
				args.flags[key] = true;
			} else {
				args.flags[key] = next;
				i++;
			}
		} else if (arg.startsWith("-") && arg.length === 2) {
			args.flags[arg.slice(1)] = true;
		} else {
			args._.push(arg);
		}
		i++;
	}
	return args;
}

function emitJson(data: unknown): void {
	console.log(JSON.stringify(data, null, 2));
}

function userError(message: string, json: boolean): void {
	if (json) {
		emitJson({ ok: false, error: message });
	}
	console.error(`Error: ${message}`);
	process.exitCode = 1;
}

function positiveIntFlag(
	args: ParsedArgs,
	name: string,
): number | null | "invalid" {
	const value = args.flags[name];
	if (value === undefined) {
		return null;
	}
	if (typeof value !== "string") {
		return "invalid";
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		return "invalid";
	}
	return parsed;
}

/** Run profile() with CLI flags applied; emits a user error and returns null on failure. */
async function loadReport(
	args: ParsedArgs,
	json: boolean,
): Promise<OptReport | null> {
	const top = positiveIntFlag(args, "top");
	if (top === "invalid") {
		userError("--top must be a positive integer", json);
		return null;
	}
	const threshold = positiveIntFlag(args, "threshold");
	if (threshold === "invalid") {
		userError("--threshold must be a positive integer", json);
		return null;
	}

	let report: OptReport;
	try {
		report = await profile(args._[1], {
			topSpans: top ?? undefined,
			inputTokenThreshold: threshold ?? undefined,
		});
	} catch (err) {
		if (err instanceof TracesDirNotFoundError) {
			userError(err.message, json);
			return null;
		}
		throw err;
	}

	for (const warning of report.warnings) {
		console.error(`Warning: ${warning}`);
	}
	if (report.summary.traces === 0) {
		userError(
			`no traces found in ${report.tracesDir} — expected .json or .jsonl trace files`,
			json,
		);
		return null;
	}
	return report;
}

function tracesFromReport(
	report: OptReport,
): import("@ruah-dev/schema").Trace[] {
	if (!report.tracesDir) return [];
	return loadTraces(report.tracesDir).traces;
}

async function cmdWaste(args: ParsedArgs, json: boolean): Promise<void> {
	const report = await loadReport(args, json);
	if (report === null) return;
	const findings = findWaste(tracesFromReport(report));
	if (json) {
		emitJson({
			ok: true,
			schemaVersion: "1",
			heuristicsVersion: WASTE_HEURISTICS_VERSION,
			findings,
			sessionTokens: report.summary.totalTokens,
		});
		return;
	}
	if (findings.length === 0) {
		console.log("No waste findings.");
		return;
	}
	console.log("# ruah-opt waste");
	console.log("");
	console.log(
		markdownTable(
			["#", "H", "tokens", "%", "span", "fix"],
			findings
				.slice(0, 20)
				.map((f, i) => [
					String(i + 1),
					f.heuristic,
					formatInt(f.tokens),
					`${f.percentOfSession}`,
					f.spanName,
					f.fix,
				]),
		),
	);
}

async function cmdHtmlReport(args: ParsedArgs, json: boolean): Promise<void> {
	const format = args.flags.format;
	if (format !== undefined && format !== "html") {
		userError('--format must be "html"', json);
		return;
	}
	const report = await loadReport(args, json);
	if (report === null) return;
	const html = renderHtml(report, findWaste(tracesFromReport(report)));
	const outFlag = args.flags.out;
	const out =
		typeof outFlag === "string" && outFlag !== ""
			? resolve(process.cwd(), outFlag)
			: resolve(process.cwd(), "report.html");
	writeFileSync(out, html, "utf8");
	if (json) {
		emitJson({ ok: true, written: out, bytes: html.length });
	} else {
		console.log(`Wrote ${out} (${html.length} bytes)`);
	}
}

async function cmdAnalyze(args: ParsedArgs, json: boolean): Promise<void> {
	const report = await loadReport(args, json);
	if (report === null) {
		return;
	}
	if (json) {
		emitJson({ ok: true, report });
	} else {
		console.log(renderReport(report));
	}
}

async function cmdCost(args: ParsedArgs, json: boolean): Promise<void> {
	const byFlag = args.flags.by;
	const by: CostGrouping =
		typeof byFlag === "string" ? (byFlag as CostGrouping) : "model";
	if (!COST_GROUPINGS.includes(by) || byFlag === true) {
		userError(`--by must be one of: ${COST_GROUPINGS.join(", ")}`, json);
		return;
	}
	const report = await loadReport(args, json);
	if (report === null) {
		return;
	}
	const buckets =
		by === "model"
			? report.byModel
			: by === "task"
				? report.byTask
				: report.byWorkflow;
	if (json) {
		emitJson({
			ok: true,
			by,
			buckets,
			summary: {
				tokensIn: report.summary.tokensIn,
				tokensOut: report.summary.tokensOut,
				costUsd: report.summary.costUsd,
				unpricedModels: report.summary.unpricedModels,
			},
		});
	} else {
		console.log(`# Cost by ${by}`);
		console.log("");
		console.log(renderBuckets(by, buckets));
		console.log("");
		console.log(
			`Total: ${formatInt(report.summary.totalTokens)} tokens, $${report.summary.costUsd.toFixed(4)}`,
		);
	}
}

function cmdCount(args: ParsedArgs, json: boolean): void {
	const files = args._.slice(1);
	if (files.length === 0) {
		userError(
			"missing <file> argument — usage: ruah-opt count <file...>",
			json,
		);
		return;
	}
	const results: Array<{
		file: string;
		tokens: number;
		chars: number;
		words: number;
		lines: number;
	}> = [];
	for (const file of files) {
		let text: string;
		try {
			text = readFileSync(resolve(process.cwd(), file), "utf-8");
		} catch {
			userError(`cannot read file: ${file}`, json);
			return;
		}
		const estimate = estimateText(text);
		results.push({ file, ...estimate });
	}
	const total = results.reduce(
		(sum, r) => ({
			tokens: sum.tokens + r.tokens,
			chars: sum.chars + r.chars,
			words: sum.words + r.words,
			lines: sum.lines + r.lines,
		}),
		{ tokens: 0, chars: 0, words: 0, lines: 0 },
	);
	if (json) {
		emitJson({
			ok: true,
			note: "heuristic estimate (~±20%), not a real tokenizer",
			files: results,
			total,
		});
	} else {
		console.log(
			markdownTable(
				["file", "tokens (est.)", "chars", "words", "lines"],
				results.map((r) => [
					r.file,
					formatInt(r.tokens),
					formatInt(r.chars),
					formatInt(r.words),
					formatInt(r.lines),
				]),
			),
		);
		console.log("");
		console.log(
			`Total: ~${formatInt(total.tokens)} tokens (heuristic estimate, not a real tokenizer)`,
		);
	}
}

function cmdPrices(json: boolean): void {
	const loaded = loadOptConfig(process.cwd());
	for (const warning of loaded.warnings) {
		console.error(`Warning: ${warning}`);
	}
	const prices = resolvePrices(loaded.config.prices);
	const models = Object.keys(prices).sort();
	if (json) {
		emitJson({
			ok: true,
			note: PRICE_TABLE_NOTE,
			unit: "USD per 1M tokens",
			configPath: loaded.found ? loaded.path : null,
			prices,
		});
	} else {
		console.log(
			markdownTable(
				["model", "input $/MTok", "output $/MTok", "source"],
				models.map((model) => {
					const price = prices[model];
					return [
						model,
						price ? price.inputPerMTok.toFixed(2) : "-",
						price ? price.outputPerMTok.toFixed(2) : "-",
						price ? price.source : "-",
					];
				}),
			),
		);
		console.log("");
		console.log(`Note: ${PRICE_TABLE_NOTE}`);
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const json = args.flags.json === true;

	if (args.flags.help || args.flags.h) {
		console.log(buildHelp().trim());
		return;
	}

	if (args.flags.version || args.flags.v) {
		console.log(`ruah-opt ${VERSION}`);
		return;
	}

	const command = args._[0];
	if (!command) {
		console.log(buildHelp().trim());
		return;
	}

	switch (command) {
		case "analyze":
			await cmdAnalyze(args, json);
			break;
		case "waste":
			await cmdWaste(args, json);
			break;
		case "report":
			await cmdHtmlReport(args, json);
			break;
		case "cost":
			await cmdCost(args, json);
			break;
		case "count":
			cmdCount(args, json);
			break;
		case "prices":
			cmdPrices(json);
			break;
		default:
			userError(
				`unknown command "${command}" — run ruah-opt --help for usage`,
				json,
			);
	}
}

main().catch((err: unknown) => {
	const detail = err instanceof Error ? err.message : String(err);
	console.error(`Internal error: ${detail}`);
	process.exit(2);
});
