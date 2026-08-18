/**
 * Markdown rendering for human-facing CLI output.
 * (JSON output never goes through here — `--json` emits structured data.)
 */

import type { CostBucket, OptReport } from "./analyze.js";

/** Format a USD amount with 4 decimal places, e.g. "$1.2345". */
export function formatUsd(value: number): string {
	return `$${value.toFixed(4)}`;
}

/** Format an integer with thousands separators, e.g. "12,345". */
export function formatInt(value: number): string {
	return Math.round(value).toLocaleString("en-US");
}

/** Format a millisecond duration, e.g. "12.3s" or "450ms". */
export function formatDuration(ms: number): string {
	if (ms >= 1000) {
		return `${(ms / 1000).toFixed(1)}s`;
	}
	return `${Math.round(ms)}ms`;
}

/** Render a markdown table with padded columns. */
export function markdownTable(headers: string[], rows: string[][]): string {
	const widths = headers.map((header, col) =>
		Math.max(header.length, ...rows.map((row) => (row[col] ?? "").length), 3),
	);
	const renderRow = (cells: string[]): string =>
		`| ${cells.map((cell, col) => (cell ?? "").padEnd(widths[col] ?? 3)).join(" | ")} |`;
	const separator = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;
	return [renderRow(headers), separator, ...rows.map(renderRow)].join("\n");
}

/** Render a cost-bucket table (used by `cost --by ...` and the full report). */
export function renderBuckets(label: string, buckets: CostBucket[]): string {
	if (buckets.length === 0) {
		return "(no data)";
	}
	return markdownTable(
		[label, "spans", "tokens in", "tokens out", "cost (USD)"],
		buckets.map((b) => [
			b.key,
			formatInt(b.spans),
			formatInt(b.tokensIn),
			formatInt(b.tokensOut),
			formatUsd(b.costUsd),
		]),
	);
}

/** Render the full analyze report as markdown. */
export function renderReport(report: OptReport): string {
	const { summary, waste } = report;
	const lines: string[] = [];

	lines.push("# ruah-opt report");
	lines.push("");
	if (report.tracesDir !== null) {
		lines.push(`- Traces dir: ${report.tracesDir}`);
	}
	lines.push(
		`- Traces: ${formatInt(summary.traces)} (${formatInt(summary.spans)} spans, ${formatInt(summary.llmSpans)} LLM spans)`,
	);
	lines.push(
		`- Tokens: ${formatInt(summary.tokensIn)} in / ${formatInt(summary.tokensOut)} out (${formatInt(summary.totalTokens)} total)`,
	);
	lines.push(`- Cost: ${formatUsd(summary.costUsd)}`);
	lines.push(`- Duration: ${formatDuration(summary.durationMs)}`);
	if (summary.unpricedModels.length > 0) {
		lines.push(
			`- Unpriced models (excluded from cost): ${summary.unpricedModels.join(", ")}`,
		);
	}
	lines.push("");

	lines.push("## Cost by model");
	lines.push("");
	lines.push(renderBuckets("model", report.byModel));
	lines.push("");

	lines.push("## Cost by task");
	lines.push("");
	lines.push(renderBuckets("task", report.byTask));
	lines.push("");

	lines.push("## Cost by workflow");
	lines.push("");
	lines.push(renderBuckets("workflow", report.byWorkflow));
	lines.push("");

	lines.push("## Top spans");
	lines.push("");
	if (report.topSpans.length === 0) {
		lines.push("(no spans with tokens or cost)");
	} else {
		lines.push(
			markdownTable(
				["span", "model", "task", "tokens in", "tokens out", "cost (USD)"],
				report.topSpans.map((s) => [
					s.spanName,
					s.model ?? "-",
					s.taskName ?? "-",
					formatInt(s.tokensIn),
					formatInt(s.tokensOut),
					formatUsd(s.costUsd),
				]),
			),
		);
	}
	lines.push("");

	lines.push("## Waste");
	lines.push("");
	lines.push(
		`- Estimated wasted tokens: ${formatInt(waste.estimatedWastedTokens)}`,
	);
	lines.push("");
	lines.push("### Repeated tool outputs (identical, >= 2x)");
	lines.push("");
	if (waste.repeatedToolOutputs.length === 0) {
		lines.push("(none detected)");
	} else {
		lines.push(
			markdownTable(
				["span", "occurrences", "redundant", "wasted tokens", "preview"],
				waste.repeatedToolOutputs.map((r) => [
					r.spanName,
					formatInt(r.occurrences),
					formatInt(r.redundantCalls),
					formatInt(r.estimatedWastedTokens),
					r.preview,
				]),
			),
		);
	}
	lines.push("");
	lines.push(
		`### Oversized inputs (tokens in > ${formatInt(waste.inputTokenThreshold)})`,
	);
	lines.push("");
	if (waste.oversizedInputs.length === 0) {
		lines.push("(none detected)");
	} else {
		lines.push(
			markdownTable(
				["span", "model", "task", "tokens in"],
				waste.oversizedInputs.map((o) => [
					o.spanName,
					o.model ?? "-",
					o.taskName ?? "-",
					formatInt(o.tokensIn),
				]),
			),
		);
	}

	if (report.warnings.length > 0) {
		lines.push("");
		lines.push("## Warnings");
		lines.push("");
		for (const warning of report.warnings) {
			lines.push(`- ${warning}`);
		}
	}

	return lines.join("\n");
}
