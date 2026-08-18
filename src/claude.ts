/**
 * Claude Code session-transcript adapter.
 *
 * // sync-with: ruah-watch/src/claude.ts
 *
 * Reads JSONL under ~/.claude/projects/<slug>/*.jsonl. Torn last lines are
 * skipped with a warning. Unknown record types and future fields are ignored.
 * Usage fields on assistant messages are preferred over estimation.
 */

import type { Trace, TraceSpan } from "@ruah-dev/schema";

const CC_TYPES = new Set([
	"user",
	"assistant",
	"system",
	"progress",
	"attachment",
	"queue-operation",
	"file-history-snapshot",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isClaudeCodeEvent(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.type === "string" &&
		CC_TYPES.has(value.type)
	);
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const item of content) {
		if (!isRecord(item)) continue;
		if (typeof item.text === "string") parts.push(item.text);
		if (typeof item.name === "string") parts.push(item.name);
	}
	return parts.join("\n");
}

export interface ClaudeParseResult {
	trace: Trace;
	warnings: string[];
	/** How many JSONL lines were skipped (torn / malformed). */
	skippedLines: number;
}

/**
 * Parse a Claude Code session JSONL into one canonical Trace.
 * Never throws on content problems.
 */
export function parseClaudeCodeTranscript(
	raw: string,
	source = "session",
): ClaudeParseResult {
	const warnings: string[] = [];
	const spans: TraceSpan[] = [];
	let skippedLines = 0;
	let model: string | undefined;
	let startedAt: string | undefined;
	let endedAt: string | undefined;
	let tokensIn = 0;
	let tokensOut = 0;
	let tokensCacheRead = 0;
	let tokensCacheWrite = 0;
	let index = 0;

	const lines = raw.split(/\r?\n/);
	for (let lineNo = 0; lineNo < lines.length; lineNo++) {
		const trimmed = lines[lineNo].trim();
		if (trimmed === "") continue;
		let doc: unknown;
		try {
			doc = JSON.parse(trimmed);
		} catch {
			skippedLines++;
			warnings.push(
				`${source}:${lineNo + 1}: torn or malformed JSONL line skipped`,
			);
			continue;
		}
		if (!isRecord(doc)) continue;
		if (!isClaudeCodeEvent(doc)) continue;

		const ts =
			typeof doc.timestamp === "string"
				? doc.timestamp
				: typeof doc.ts === "string"
					? doc.ts
					: new Date(0).toISOString();
		startedAt ??= ts;
		endedAt = ts;

		if (doc.type !== "assistant") continue;
		const message = isRecord(doc.message) ? doc.message : {};
		const usage = isRecord(message.usage)
			? message.usage
			: isRecord(doc.usage)
				? doc.usage
				: {};
		const spanModel =
			(typeof message.model === "string" && message.model) ||
			(typeof doc.model === "string" && doc.model) ||
			undefined;
		if (spanModel) model = spanModel;

		const inTok = num(usage.input_tokens) ?? 0;
		const outTok = num(usage.output_tokens) ?? 0;
		const cacheRead =
			num(usage.cache_read_input_tokens) ?? num(usage.cache_read_tokens) ?? 0;
		const cacheWrite =
			num(usage.cache_creation_input_tokens) ??
			num(usage.cache_write_tokens) ??
			0;
		tokensIn += inTok;
		tokensOut += outTok;
		tokensCacheRead += cacheRead;
		tokensCacheWrite += cacheWrite;

		index += 1;
		const name =
			textFromContent(message.content).split("\n")[0]?.slice(0, 80) ||
			"assistant";
		spans.push({
			name,
			startedAt: ts,
			spanId: `cc_${index}`,
			type: "llm_call",
			model: spanModel,
			tokensIn: inTok,
			tokensOut: outTok,
			tokensCacheRead: cacheRead,
			tokensCacheWrite: cacheWrite,
			status: "ok",
			attributes: { source: "reported" },
		});

		// Tool-use blocks become tool_call spans (no usage of their own).
		const content = message.content;
		if (Array.isArray(content)) {
			for (const block of content) {
				if (!isRecord(block) || block.type !== "tool_use") continue;
				const toolName = typeof block.name === "string" ? block.name : "tool";
				spans.push({
					name: toolName,
					startedAt: ts,
					spanId: typeof block.id === "string" ? block.id : `tool_${index}`,
					type: "tool_call",
					status: "ok",
					attributes: {
						inputBytes: JSON.stringify(block.input ?? "").length,
					},
				});
			}
		}
	}

	const trace: Trace = {
		traceId: source,
		spans,
		executor: "claude-code",
		startedAt,
		endedAt,
		schemaVersion: "0.1.0",
		totals: {
			tokensIn,
			tokensOut,
			tokensCacheRead,
			tokensCacheWrite,
		},
		metadata: {
			model,
			source: "claude-code",
		},
	};
	return { trace, warnings, skippedLines };
}

/** True when a file's parsed lines look like a Claude Code transcript. */
export function looksLikeClaudeCode(raw: string): boolean {
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		try {
			const doc = JSON.parse(trimmed) as unknown;
			return isClaudeCodeEvent(doc);
		} catch {}
	}
	return false;
}
