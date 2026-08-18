import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Trace } from "@ruah-dev/schema";
import { findWaste } from "../src/index.js";

function tool(
	name: string,
	path: string,
	bytes: number,
	result?: string,
): Trace["spans"][number] {
	return {
		name,
		type: "tool_call",
		startedAt: "2026-08-18T00:00:00.000Z",
		attributes: {
			path,
			argsKey: JSON.stringify({ path }),
			inputBytes: bytes,
			...(result ? { result } : {}),
		},
	};
}

describe("findWaste", () => {
	it("ranks a 200KB tool result as H1 #1", () => {
		const blob = "n".repeat(200_000);
		const traces: Trace[] = [
			{
				traceId: "sess",
				spans: [
					tool("Read", "tiny.ts", 80, "ok"),
					tool("Read", "huge.bin", blob.length, blob),
				],
				totals: { tokensIn: 1000, tokensOut: 100 },
			},
		];
		const findings = findWaste(traces);
		assert.ok(findings.length >= 1);
		assert.equal(findings[0].heuristic, "H1");
		assert.equal(findings[0].spanName, "Read");
		assert.ok(findings[0].tokens > 10_000);
		assert.match(findings[0].fix, /Cap or paginate/i);
	});

	it("flags the same file read 3+ times as H2", () => {
		const traces: Trace[] = [
			{
				traceId: "sess",
				spans: [
					tool("Read", "src/a.ts", 100),
					tool("Read", "src/a.ts", 100),
					tool("Read", "src/a.ts", 100),
				],
				totals: { tokensIn: 300, tokensOut: 10 },
			},
		];
		const h2 = findWaste(traces).filter((f) => f.heuristic === "H2");
		assert.equal(h2.length, 1);
		assert.match(h2[0].detail, /× 3/);
	});

	it("does not flag two reads as H2", () => {
		const traces: Trace[] = [
			{
				traceId: "sess",
				spans: [tool("Read", "src/a.ts", 100), tool("Read", "src/a.ts", 100)],
				totals: { tokensIn: 200, tokensOut: 10 },
			},
		];
		assert.equal(
			findWaste(traces).filter((f) => f.heuristic === "H2").length,
			0,
		);
	});

	it("flags a compaction span as H4", () => {
		const traces: Trace[] = [
			{
				traceId: "sess",
				spans: [
					{
						name: "compact conversation",
						type: "llm_call",
						startedAt: "2026-08-18T00:00:00.000Z",
						tokensIn: 8000,
						tokensOut: 400,
					},
				],
				totals: { tokensIn: 8000, tokensOut: 400 },
			},
		];
		const h4 = findWaste(traces).filter((f) => f.heuristic === "H4");
		assert.equal(h4.length, 1);
		assert.match(h4[0].fix, /working set/i);
	});
});
