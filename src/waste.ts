/**
 * Waste heuristics over canonical traces.
 *
 * H1 oversized tool result — estimated tokens from result/input bytes
 * H2 repeated reads — same tool + args ≥ 3×
 * H3 dead weight — tool result immediately followed by a re-read of the same target
 * H4 context-refresh — compaction / summarization events
 *
 * Heuristics are labeled; H3 is the most speculative (false-positive notes
 * in the README). Ranked by tokens descending, then heuristic id, then name.
 */

import type { Trace, TraceSpan } from "@ruah-dev/schema";
import { estimateTokens } from "./estimator.js";

export const WASTE_HEURISTICS_VERSION = "1";

export type WasteHeuristic = "H1" | "H2" | "H3" | "H4";

export interface WasteFinding {
	heuristic: WasteHeuristic;
	tokens: number;
	percentOfSession: number;
	spanName: string;
	traceId: string;
	fix: string;
	detail: string;
}

export interface FindWasteOptions {
	/** Estimated-token threshold for H1 (default 10_000). */
	oversizedTokens?: number;
	/** Repeat count that trips H2 (default 3). */
	repeatReads?: number;
}

const DEFAULT_OVERSIZED = 10_000;
const DEFAULT_REPEATS = 3;

const REFRESH_NAME = /compact|summar(y|iz)|context.?refresh|condense/i;

function sessionTokens(traces: Trace[]): number {
	let total = 0;
	for (const trace of traces) {
		if (trace.totals) {
			total += (trace.totals.tokensIn ?? 0) + (trace.totals.tokensOut ?? 0);
		} else {
			for (const span of trace.spans) {
				total += (span.tokensIn ?? 0) + (span.tokensOut ?? 0);
			}
		}
	}
	return total;
}

function attrString(span: TraceSpan, key: string): string | undefined {
	const value = span.attributes?.[key];
	return typeof value === "string" && value !== "" ? value : undefined;
}

function attrNumber(span: TraceSpan, key: string): number | undefined {
	const value = span.attributes?.[key];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function resultText(span: TraceSpan): string | undefined {
	const attrs = span.attributes ?? {};
	for (const key of [
		"output",
		"result",
		"response",
		"stdout",
		"content",
		"text",
	]) {
		const value = attrs[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

function percent(tokens: number, session: number): number {
	if (session <= 0) return 0;
	return Math.round((tokens / session) * 1000) / 10;
}

export function findWaste(
	traces: Trace[],
	options: FindWasteOptions = {},
): WasteFinding[] {
	const oversized = options.oversizedTokens ?? DEFAULT_OVERSIZED;
	const repeatAt = options.repeatReads ?? DEFAULT_REPEATS;
	const session = sessionTokens(traces);
	const findings: WasteFinding[] = [];

	for (const trace of traces) {
		const reads = new Map<
			string,
			{ count: number; tokens: number; name: string }
		>();
		let prev: TraceSpan | null = null;

		for (const span of trace.spans) {
			const path = attrString(span, "path");
			const argsKey = attrString(span, "argsKey");
			const bytes = attrNumber(span, "inputBytes");
			const text = resultText(span);
			const estFromText = text ? estimateTokens(text) : 0;
			const estFromBytes = bytes ? Math.round(bytes / 4) : 0;
			const est = Math.max(estFromText, estFromBytes, span.tokensIn ?? 0);

			if (span.type === "tool_call" && est >= oversized) {
				findings.push({
					heuristic: "H1",
					tokens: est,
					percentOfSession: percent(est, session),
					spanName: span.name,
					traceId: trace.traceId,
					fix: "Cap or paginate this tool result; don't dump the whole file into context.",
					detail: `${span.name}${path ? ` ${path}` : ""} ≈ ${est} tokens`,
				});
			}

			if (span.type === "tool_call") {
				const key = `${span.name}\0${argsKey ?? path ?? span.name}`;
				const entry = reads.get(key) ?? {
					count: 0,
					tokens: 0,
					name: span.name,
				};
				entry.count += 1;
				entry.tokens += est;
				reads.set(key, entry);
			}

			if (
				prev &&
				prev.type === "tool_call" &&
				span.type === "tool_call" &&
				attrString(prev, "path") &&
				attrString(prev, "path") === path &&
				span.name === prev.name
			) {
				findings.push({
					heuristic: "H3",
					tokens: est,
					percentOfSession: percent(est, session),
					spanName: span.name,
					traceId: trace.traceId,
					fix: "Reuse the previous result instead of re-reading the same path.",
					detail: `re-read ${path} immediately after a prior ${prev.name}`,
				});
			}

			if (REFRESH_NAME.test(span.name) || REFRESH_NAME.test(text ?? "")) {
				const tokens = (span.tokensIn ?? 0) + (span.tokensOut ?? 0) || est;
				findings.push({
					heuristic: "H4",
					tokens,
					percentOfSession: percent(tokens, session),
					spanName: span.name,
					traceId: trace.traceId,
					fix: "Shrink the working set so the session does not need a context refresh.",
					detail: "compaction / summarization event",
				});
			}

			prev = span;
		}

		for (const [key, entry] of reads) {
			if (entry.count < repeatAt) continue;
			const target = key.split("\0")[1] ?? entry.name;
			findings.push({
				heuristic: "H2",
				tokens: entry.tokens,
				percentOfSession: percent(entry.tokens, session),
				spanName: entry.name,
				traceId: trace.traceId,
				fix: "Don't repeat this exact tool call — reuse the earlier result.",
				detail: `${entry.name} ${target} × ${entry.count}`,
			});
		}
	}

	findings.sort(
		(a, b) =>
			b.tokens - a.tokens ||
			a.heuristic.localeCompare(b.heuristic) ||
			a.spanName.localeCompare(b.spanName),
	);
	return findings;
}
