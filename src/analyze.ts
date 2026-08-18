/**
 * Trace analysis: cost/token breakdowns, top spans, wasted-token detection.
 *
 * Pure functions over canonical `Trace` objects (imported from
 * `@ruah-dev/schema` — never redefined here).
 */

import { resolve } from "node:path";
import type { Trace, TraceSpan } from "@ruah-dev/schema";
import { estimateTokens } from "./estimator.js";
import {
	costForTokens,
	DEFAULT_INPUT_TOKEN_THRESHOLD,
	findPrice,
	loadOptConfig,
	type ModelPrice,
	PRICE_TABLE,
} from "./prices.js";
import { DEFAULT_TRACES_DIR, loadTraces } from "./traces.js";

/** Aggregated cost/tokens for one grouping key (a model, task, or workflow). */
export interface CostBucket {
	/** The model id, task name, or workflow name ("(none)" when absent). */
	key: string;
	/** Number of spans attributed to this bucket. */
	spans: number;
	/** Total input tokens. */
	tokensIn: number;
	/** Total output tokens. */
	tokensOut: number;
	/** Total cost in USD (0 contribution from unpriced spans). */
	costUsd: number;
}

/** One of the N most expensive spans across all traces. */
export interface TopSpan {
	traceId: string;
	taskName: string | null;
	workflowName: string | null;
	spanName: string;
	model: string | null;
	tokensIn: number;
	tokensOut: number;
	costUsd: number;
	durationMs: number | null;
}

/** A tool output that appeared verbatim two or more times. */
export interface RepeatedOutput {
	/** Span (tool) name producing the repeated output. */
	spanName: string;
	/** How many times the identical output appeared. */
	occurrences: number;
	/** Redundant repetitions (occurrences - 1). */
	redundantCalls: number;
	/** Estimated tokens wasted by the redundant repetitions. */
	estimatedWastedTokens: number;
	/** First 80 characters of the repeated output. */
	preview: string;
}

/** A span whose input tokens exceeded the configured threshold. */
export interface OversizedInput {
	traceId: string;
	taskName: string | null;
	spanName: string;
	model: string | null;
	tokensIn: number;
}

/** Wasted-token findings. */
export interface WasteReport {
	/** Threshold used for oversized-input detection. */
	inputTokenThreshold: number;
	/** Identical tool outputs repeated >= 2 times. */
	repeatedToolOutputs: RepeatedOutput[];
	/** Spans with tokensIn above the threshold. */
	oversizedInputs: OversizedInput[];
	/** Total estimated wasted tokens (from repeated outputs). */
	estimatedWastedTokens: number;
}

/** Headline numbers for the whole analysis. */
export interface OptSummary {
	traces: number;
	spans: number;
	/** Spans that look like LLM calls (model, tokens, or cost present). */
	llmSpans: number;
	tokensIn: number;
	tokensOut: number;
	totalTokens: number;
	/** Total cost in USD (recorded span costs + price-table estimates). */
	costUsd: number;
	/** Total wall-clock duration across traces, in milliseconds. */
	durationMs: number;
	/** Distinct model ids seen, sorted. */
	models: string[];
	/** Models seen with token usage but no price entry (excluded from cost). */
	unpricedModels: string[];
}

/** Full analysis report. */
export interface OptReport {
	/** ISO-8601 timestamp the report was generated. */
	generatedAt: string;
	/** Directory the traces were loaded from, when known. */
	tracesDir: string | null;
	summary: OptSummary;
	byModel: CostBucket[];
	byTask: CostBucket[];
	byWorkflow: CostBucket[];
	topSpans: TopSpan[];
	waste: WasteReport;
	/** Non-fatal problems encountered while loading/analyzing. */
	warnings: string[];
}

/** Options for {@link analyzeTraces} and {@link profile}. */
export interface AnalyzeOptions {
	/** Price table to use (defaults to the built-in PRICE_TABLE). */
	prices?: Record<string, ModelPrice>;
	/** Oversized-input threshold in tokens (default 20000). */
	inputTokenThreshold?: number;
	/** How many top spans to include (default 10). */
	topSpans?: number;
	/** Recorded in the report for provenance. */
	tracesDir?: string | null;
	/** Warnings to carry into the report (e.g. from trace loading). */
	warnings?: string[];
}

const DEFAULT_TOP_SPANS = 10;
const MIN_REPEATED_OUTPUT_CHARS = 20;
const OUTPUT_ATTRIBUTE_KEYS = [
	"output",
	"result",
	"response",
	"stdout",
	"content",
	"text",
];

function roundUsd(value: number): number {
	return Math.round(value * 1_000_000) / 1_000_000;
}

function numberOr(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function spanDurationMs(span: TraceSpan): number | null {
	if (typeof span.durationMs === "number" && Number.isFinite(span.durationMs)) {
		return span.durationMs;
	}
	if (typeof span.startedAt === "string" && typeof span.endedAt === "string") {
		const start = Date.parse(span.startedAt);
		const end = Date.parse(span.endedAt);
		if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
			return end - start;
		}
	}
	return null;
}

function traceDurationMs(trace: Trace): number {
	const totals = trace.totals?.durationMs;
	if (typeof totals === "number" && Number.isFinite(totals)) {
		return totals;
	}
	if (
		typeof trace.startedAt === "string" &&
		typeof trace.endedAt === "string"
	) {
		const start = Date.parse(trace.startedAt);
		const end = Date.parse(trace.endedAt);
		if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
			return end - start;
		}
	}
	let sum = 0;
	for (const span of trace.spans) {
		sum += spanDurationMs(span) ?? 0;
	}
	return sum;
}

function extractOutputText(span: TraceSpan): string | null {
	const attributes = span.attributes;
	if (attributes === undefined) {
		return null;
	}
	for (const key of OUTPUT_ATTRIBUTE_KEYS) {
		const value = attributes[key];
		if (value === undefined || value === null) {
			continue;
		}
		if (typeof value === "string") {
			return value;
		}
		try {
			return JSON.stringify(value);
		} catch {
			return null;
		}
	}
	return null;
}

function bucketAdd(
	buckets: Map<string, CostBucket>,
	key: string,
	spans: number,
	tokensIn: number,
	tokensOut: number,
	costUsd: number,
): void {
	let bucket = buckets.get(key);
	if (bucket === undefined) {
		bucket = { key, spans: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
		buckets.set(key, bucket);
	}
	bucket.spans += spans;
	bucket.tokensIn += tokensIn;
	bucket.tokensOut += tokensOut;
	bucket.costUsd += costUsd;
}

function sortBuckets(buckets: Map<string, CostBucket>): CostBucket[] {
	return [...buckets.values()]
		.map((b) => ({ ...b, costUsd: roundUsd(b.costUsd) }))
		.sort(
			(a, b) =>
				b.costUsd - a.costUsd ||
				b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut) ||
				a.key.localeCompare(b.key),
		);
}

/**
 * Analyze canonical traces into a cost/token report. Pure and synchronous —
 * pass traces from {@link loadTraces} or build them in memory.
 */
export function analyzeTraces(
	traces: Trace[],
	options: AnalyzeOptions = {},
): OptReport {
	const prices = options.prices ?? PRICE_TABLE;
	const threshold =
		options.inputTokenThreshold ?? DEFAULT_INPUT_TOKEN_THRESHOLD;
	const topN = options.topSpans ?? DEFAULT_TOP_SPANS;

	const byModel = new Map<string, CostBucket>();
	const byTask = new Map<string, CostBucket>();
	const byWorkflow = new Map<string, CostBucket>();
	const models = new Set<string>();
	const unpricedModels = new Set<string>();
	const allSpans: TopSpan[] = [];
	const repeated = new Map<
		string,
		{ spanName: string; occurrences: number; output: string }
	>();
	const oversized: OversizedInput[] = [];

	let spanCount = 0;
	let llmSpanCount = 0;
	let totalTokensIn = 0;
	let totalTokensOut = 0;
	let totalCost = 0;
	let totalDuration = 0;

	for (const trace of traces) {
		const taskKey = trace.taskName ?? trace.taskId ?? "(none)";
		const workflowKey = trace.workflowName ?? trace.workflowId ?? "(none)";
		totalDuration += traceDurationMs(trace);

		let traceTokens = 0;
		let traceCost = 0;

		for (const span of trace.spans) {
			spanCount++;
			const tokensIn = numberOr(span.tokensIn, 0);
			const tokensOut = numberOr(span.tokensOut, 0);
			const model = typeof span.model === "string" ? span.model : null;
			const recordedCost =
				typeof span.costUsd === "number" && Number.isFinite(span.costUsd)
					? span.costUsd
					: null;
			const isLlm =
				model !== null ||
				tokensIn > 0 ||
				tokensOut > 0 ||
				recordedCost !== null;

			let costUsd = 0;
			if (recordedCost !== null) {
				costUsd = recordedCost;
			} else if (model !== null) {
				const match = findPrice(model, prices);
				if (match !== null) {
					costUsd = costForTokens(tokensIn, tokensOut, match.price);
				} else if (tokensIn > 0 || tokensOut > 0) {
					unpricedModels.add(model);
				}
			}

			if (model !== null) {
				models.add(model);
			}
			if (isLlm) {
				llmSpanCount++;
				bucketAdd(
					byModel,
					model ?? "(no model)",
					1,
					tokensIn,
					tokensOut,
					costUsd,
				);
			}
			bucketAdd(byTask, taskKey, 1, tokensIn, tokensOut, costUsd);
			bucketAdd(byWorkflow, workflowKey, 1, tokensIn, tokensOut, costUsd);

			totalTokensIn += tokensIn;
			totalTokensOut += tokensOut;
			totalCost += costUsd;
			traceTokens += tokensIn + tokensOut;
			traceCost += costUsd;

			if (tokensIn > 0 || tokensOut > 0 || costUsd > 0) {
				allSpans.push({
					traceId: trace.traceId,
					taskName: trace.taskName ?? trace.taskId ?? null,
					workflowName: trace.workflowName ?? trace.workflowId ?? null,
					spanName: span.name,
					model,
					tokensIn,
					tokensOut,
					costUsd: roundUsd(costUsd),
					durationMs: spanDurationMs(span),
				});
			}

			// Waste: identical repeated tool outputs.
			const output = extractOutputText(span);
			if (output !== null && output.length >= MIN_REPEATED_OUTPUT_CHARS) {
				const key = `${span.name} ${output}`;
				const entry = repeated.get(key);
				if (entry === undefined) {
					repeated.set(key, { spanName: span.name, occurrences: 1, output });
				} else {
					entry.occurrences++;
				}
			}

			// Waste: oversized inputs.
			if (tokensIn > threshold) {
				oversized.push({
					traceId: trace.traceId,
					taskName: trace.taskName ?? trace.taskId ?? null,
					spanName: span.name,
					model,
					tokensIn,
				});
			}
		}

		// Trace-level totals fallback: traces whose spans carried no token or
		// cost data still contribute their recorded totals to the summary and
		// the task/workflow breakdowns (model attribution is unknown).
		if (traceTokens === 0 && traceCost === 0 && trace.totals !== undefined) {
			const tIn = numberOr(trace.totals.tokensIn, 0);
			const tOut = numberOr(trace.totals.tokensOut, 0);
			const tCost = numberOr(trace.totals.costUsd, 0);
			if (tIn > 0 || tOut > 0 || tCost > 0) {
				totalTokensIn += tIn;
				totalTokensOut += tOut;
				totalCost += tCost;
				bucketAdd(byTask, taskKey, 0, tIn, tOut, tCost);
				bucketAdd(byWorkflow, workflowKey, 0, tIn, tOut, tCost);
			}
		}
	}

	const repeatedToolOutputs: RepeatedOutput[] = [...repeated.values()]
		.filter((entry) => entry.occurrences >= 2)
		.map((entry) => ({
			spanName: entry.spanName,
			occurrences: entry.occurrences,
			redundantCalls: entry.occurrences - 1,
			estimatedWastedTokens:
				estimateTokens(entry.output) * (entry.occurrences - 1),
			preview: entry.output.slice(0, 80).replace(/\s+/g, " "),
		}))
		.sort((a, b) => b.estimatedWastedTokens - a.estimatedWastedTokens);

	const estimatedWastedTokens = repeatedToolOutputs.reduce(
		(sum, entry) => sum + entry.estimatedWastedTokens,
		0,
	);

	allSpans.sort(
		(a, b) =>
			b.costUsd - a.costUsd ||
			b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut),
	);
	oversized.sort((a, b) => b.tokensIn - a.tokensIn);

	return {
		generatedAt: new Date().toISOString(),
		tracesDir: options.tracesDir ?? null,
		summary: {
			traces: traces.length,
			spans: spanCount,
			llmSpans: llmSpanCount,
			tokensIn: totalTokensIn,
			tokensOut: totalTokensOut,
			totalTokens: totalTokensIn + totalTokensOut,
			costUsd: roundUsd(totalCost),
			durationMs: totalDuration,
			models: [...models].sort(),
			unpricedModels: [...unpricedModels].sort(),
		},
		byModel: sortBuckets(byModel),
		byTask: sortBuckets(byTask),
		byWorkflow: sortBuckets(byWorkflow),
		topSpans: allSpans.slice(0, topN),
		waste: {
			inputTokenThreshold: threshold,
			repeatedToolOutputs,
			oversizedInputs: oversized,
			estimatedWastedTokens,
		},
		warnings: options.warnings ?? [],
	};
}

/**
 * Load traces from a directory and analyze them in one call.
 *
 * Resolves `tracesDir` (default `.ruah/traces`) against `cwd` (default
 * `process.cwd()`), merges `.ruah/opt.json` price overrides over the built-in
 * table, and returns the full report. Throws `TracesDirNotFoundError` when
 * the directory does not exist.
 */
export async function profile(
	tracesDir?: string,
	options: AnalyzeOptions & { cwd?: string } = {},
): Promise<OptReport> {
	const cwd = options.cwd ?? process.cwd();
	const dir = resolve(cwd, tracesDir ?? DEFAULT_TRACES_DIR);
	const loaded = loadOptConfig(cwd);
	const prices: Record<string, ModelPrice> = {
		...PRICE_TABLE,
		...loaded.config.prices,
		...options.prices,
	};
	const threshold =
		options.inputTokenThreshold ??
		loaded.config.waste?.inputTokenThreshold ??
		DEFAULT_INPUT_TOKEN_THRESHOLD;
	const result = loadTraces(dir);
	return analyzeTraces(result.traces, {
		...options,
		prices,
		inputTokenThreshold: threshold,
		tracesDir: dir,
		warnings: [
			...loaded.warnings,
			...result.warnings,
			...(options.warnings ?? []),
		],
	});
}
