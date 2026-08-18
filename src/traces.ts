/**
 * Trace ingestion from `.ruah/traces/`.
 *
 * Tolerant by design: a traces directory may contain
 * - single-JSON files holding one canonical Trace,
 * - JSON files holding an array of Traces,
 * - JSONL event streams (one JSON document per line) where each line is a
 *   full Trace, a `{ traceId, span }` wrapper, or a bare span event that we
 *   group by `traceId`.
 *
 * Malformed files and lines become warnings — ingestion never throws on bad
 * content. The only thrown error is {@link TracesDirNotFoundError} when the
 * directory itself is missing.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Trace, TraceSpan } from "@ruah-dev/schema";

/** Default traces location, relative to the consumer's CWD. */
export const DEFAULT_TRACES_DIR = join(".ruah", "traces");

/** Thrown when the traces directory does not exist (a user error, not a bug). */
export class TracesDirNotFoundError extends Error {
	constructor(dir: string) {
		super(
			`traces directory not found: ${dir} — pass a directory or run inside a repo with ${DEFAULT_TRACES_DIR}/`,
		);
		this.name = "TracesDirNotFoundError";
	}
}

/** Result of loading a traces directory or file. */
export interface LoadTracesResult {
	/** Successfully parsed traces (including synthesized ones from span events). */
	traces: Trace[];
	/** Number of .json/.jsonl files read. */
	filesRead: number;
	/** Non-fatal parse problems. */
	warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTraceLike(value: unknown): value is Trace {
	return (
		isRecord(value) &&
		typeof value.traceId === "string" &&
		Array.isArray(value.spans)
	);
}

function isSpanLike(value: unknown): boolean {
	return isRecord(value) && typeof value.name === "string";
}

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

/** Accumulates span events into synthesized traces, keyed by traceId. */
class SpanGrouper {
	private readonly groups = new Map<string, Trace>();

	add(traceId: string, span: TraceSpan, event: Record<string, unknown>): void {
		let trace = this.groups.get(traceId);
		if (trace === undefined) {
			trace = { traceId, spans: [] };
			this.groups.set(traceId, trace);
		}
		trace.spans.push(span);
		// Lift trace-level context off span events when present.
		trace.taskName ??= asString(event.taskName);
		trace.workflowName ??= asString(event.workflowName);
		trace.workflowId ??= asString(event.workflowId);
		trace.executor ??= asString(event.executor);
	}

	drain(): Trace[] {
		return [...this.groups.values()];
	}
}

function toSpan(value: Record<string, unknown>): TraceSpan {
	const span = { ...value } as unknown as TraceSpan;
	if (typeof span.startedAt !== "string") {
		span.startedAt = "";
	}
	return span;
}

/**
 * Interpret one parsed JSON document (a whole file, an array element, or a
 * JSONL line). Returns true when the document was understood.
 */
function ingestDocument(
	doc: unknown,
	fileId: string,
	traces: Trace[],
	grouper: SpanGrouper,
): boolean {
	if (isTraceLike(doc)) {
		traces.push(doc);
		return true;
	}
	if (!isRecord(doc)) {
		return false;
	}
	// Trace missing its traceId — tolerate, synthesize one from the file name.
	if (Array.isArray(doc.spans)) {
		const spans = doc.spans
			.filter(isSpanLike)
			.map((s) => toSpan(s as Record<string, unknown>));
		traces.push({ ...doc, traceId: fileId, spans } as Trace);
		return true;
	}
	// `{ traceId, span: {...} }` event wrapper.
	if (isRecord(doc.span) && isSpanLike(doc.span)) {
		const traceId = asString(doc.traceId) ?? fileId;
		grouper.add(traceId, toSpan(doc.span), doc);
		return true;
	}
	// Bare span event, optionally carrying a traceId field.
	if (isSpanLike(doc)) {
		const traceId = asString(doc.traceId) ?? fileId;
		grouper.add(traceId, toSpan(doc), doc);
		return true;
	}
	return false;
}

/**
 * Parse one trace file (single JSON, JSON array, or JSONL event stream).
 * Never throws on content problems — they become warnings.
 */
export function loadTraceFile(path: string): LoadTracesResult {
	const warnings: string[] = [];
	const traces: Trace[] = [];
	const grouper = new SpanGrouper();
	const fileId = `file:${basename(path)}`;

	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		return {
			traces,
			filesRead: 0,
			warnings: [`cannot read ${path}: ${detail}`],
		};
	}

	let wholeDoc: unknown;
	let wholeParsed = false;
	try {
		wholeDoc = JSON.parse(raw);
		wholeParsed = true;
	} catch {
		// Fall through to JSONL parsing.
	}

	if (wholeParsed) {
		if (Array.isArray(wholeDoc)) {
			wholeDoc.forEach((item, index) => {
				if (!ingestDocument(item, `${fileId}#${index}`, traces, grouper)) {
					warnings.push(`${path}[${index}]: not a recognizable trace or span`);
				}
			});
		} else if (!ingestDocument(wholeDoc, fileId, traces, grouper)) {
			warnings.push(`${path}: not a recognizable trace or span document`);
		}
	} else {
		// JSONL: one JSON document per non-empty line.
		const lines = raw.split(/\r?\n/);
		let parsedLines = 0;
		let badLines = 0;
		lines.forEach((line, index) => {
			const trimmed = line.trim();
			if (trimmed === "") {
				return;
			}
			let doc: unknown;
			try {
				doc = JSON.parse(trimmed);
			} catch {
				badLines++;
				return;
			}
			parsedLines++;
			if (!ingestDocument(doc, fileId, traces, grouper)) {
				warnings.push(
					`${path}:${index + 1}: not a recognizable trace or span event`,
				);
			}
		});
		if (parsedLines === 0) {
			warnings.push(`${path}: not valid JSON or JSONL — skipped`);
		} else if (badLines > 0) {
			warnings.push(`${path}: skipped ${badLines} malformed JSONL line(s)`);
		}
	}

	traces.push(...grouper.drain());
	return { traces, filesRead: 1, warnings };
}

function collectTraceFiles(dir: string, out: string[]): void {
	const entries = readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			collectTraceFiles(path, out);
		} else if (/\.(json|jsonl)$/i.test(entry.name)) {
			out.push(path);
		}
	}
}

/**
 * Load every `.json`/`.jsonl` trace file under a directory (recursive).
 * Throws {@link TracesDirNotFoundError} when the directory does not exist;
 * all content-level problems are returned as warnings instead.
 */
export function loadTraces(dir: string): LoadTracesResult {
	let isDir = false;
	try {
		isDir = statSync(dir).isDirectory();
	} catch {
		isDir = false;
	}
	if (!isDir) {
		throw new TracesDirNotFoundError(dir);
	}

	const files: string[] = [];
	collectTraceFiles(dir, files);
	files.sort();

	const traces: Trace[] = [];
	const warnings: string[] = [];
	let filesRead = 0;
	for (const file of files) {
		const result = loadTraceFile(file);
		traces.push(...result.traces);
		warnings.push(...result.warnings);
		filesRead += result.filesRead;
	}
	return { traces, filesRead, warnings };
}
