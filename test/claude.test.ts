import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	loadTraceFile,
	looksLikeClaudeCode,
	parseClaudeCodeTranscript,
} from "../src/index.js";

const fixtures = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../test/fixtures",
);

describe("parseClaudeCodeTranscript", () => {
	it("sums reported usage including cache tokens", () => {
		const raw = readFileSync(join(fixtures, "session-happy.jsonl"), "utf8");
		assert.equal(looksLikeClaudeCode(raw), true);
		const { trace, skippedLines } = parseClaudeCodeTranscript(raw, "happy");
		assert.equal(skippedLines, 0);
		assert.equal(trace.executor, "claude-code");
		assert.equal(trace.totals?.tokensIn, 320);
		assert.equal(trace.totals?.tokensOut, 120);
		assert.equal(trace.totals?.tokensCacheRead, 30);
		assert.equal(trace.totals?.tokensCacheWrite, 5);
		assert.ok(
			trace.spans.some((s) => s.type === "tool_call" && s.name === "Read"),
		);
		assert.equal(trace.spans.filter((s) => s.type === "llm_call").length, 2);
	});

	it("skips a torn last line with a warning", () => {
		const raw = readFileSync(join(fixtures, "session-torn.jsonl"), "utf8");
		const { trace, warnings, skippedLines } = parseClaudeCodeTranscript(
			raw,
			"torn",
		);
		assert.equal(skippedLines, 1);
		assert.ok(warnings.some((w) => w.includes("torn")));
		assert.equal(trace.totals?.tokensIn, 10);
		assert.equal(trace.totals?.tokensOut, 4);
	});

	it("loadTraceFile detects a Claude Code transcript", () => {
		const loaded = loadTraceFile(join(fixtures, "session-happy.jsonl"));
		assert.equal(loaded.traces.length, 1);
		assert.equal(loaded.traces[0].totals?.tokensIn, 320);
	});
});
