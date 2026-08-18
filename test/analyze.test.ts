import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Trace } from "@ruah-dev/schema";
import { analyzeTraces } from "../src/index.js";

function fixtureTraces(): Trace[] {
	return [
		{
			traceId: "tr-api",
			taskName: "backend-api",
			workflowName: "feature-x",
			startedAt: "2026-06-12T10:00:00Z",
			endedAt: "2026-06-12T10:00:30Z",
			spans: [
				{
					name: "plan",
					startedAt: "2026-06-12T10:00:00Z",
					type: "llm_call",
					model: "claude-fable-5",
					tokensIn: 10_000,
					tokensOut: 1_000,
				},
				{
					name: "implement",
					startedAt: "2026-06-12T10:00:10Z",
					type: "llm_call",
					model: "claude-sonnet-4-6",
					tokensIn: 50_000,
					tokensOut: 4_000,
				},
				{
					name: "read_file",
					startedAt: "2026-06-12T10:00:20Z",
					type: "tool_call",
					attributes: {
						output: "function add(a, b) { return a + b; } // shared util",
					},
				},
				{
					name: "read_file",
					startedAt: "2026-06-12T10:00:25Z",
					type: "tool_call",
					attributes: {
						output: "function add(a, b) { return a + b; } // shared util",
					},
				},
				{
					name: "read_file",
					startedAt: "2026-06-12T10:00:27Z",
					type: "tool_call",
					attributes: {
						output: "function add(a, b) { return a + b; } // shared util",
					},
				},
			],
		},
		{
			traceId: "tr-tests",
			taskName: "tests",
			workflowName: "feature-x",
			spans: [
				{
					name: "write-tests",
					startedAt: "2026-06-12T11:00:00Z",
					type: "llm_call",
					model: "claude-sonnet-4-6",
					tokensIn: 30_000,
					tokensOut: 2_000,
					costUsd: 0.5,
				},
				{
					name: "huge-context",
					startedAt: "2026-06-12T11:01:00Z",
					type: "llm_call",
					model: "mystery-model-9",
					tokensIn: 120_000,
					tokensOut: 100,
				},
			],
		},
		{
			traceId: "tr-totals-only",
			taskName: "docs",
			workflowName: "feature-y",
			spans: [],
			totals: { tokensIn: 5_000, tokensOut: 500, costUsd: 0.05 },
		},
	];
}

describe("analyzeTraces", () => {
	it("computes summary token and span totals", () => {
		const report = analyzeTraces(fixtureTraces());
		assert.equal(report.summary.traces, 3);
		assert.equal(report.summary.spans, 7);
		assert.equal(report.summary.llmSpans, 4);
		// 10k + 50k + 30k + 120k + 5k (trace-level totals)
		assert.equal(report.summary.tokensIn, 215_000);
		assert.equal(report.summary.tokensOut, 7_600);
		assert.equal(report.summary.totalTokens, 222_600);
	});

	it("prices spans from the table and prefers recorded span costs", () => {
		const report = analyzeTraces(fixtureTraces());
		// fable: 10k*6/1M + 1k*30/1M = 0.09
		// sonnet (implement): 50k*3/1M + 4k*15/1M = 0.21
		// write-tests: recorded 0.5 (NOT the table estimate)
		// mystery-model-9: unpriced -> 0
		// trace totals: 0.05
		assert.equal(report.summary.costUsd, 0.85);
		assert.deepEqual(report.summary.unpricedModels, ["mystery-model-9"]);
	});

	it("breaks cost down by model", () => {
		const report = analyzeTraces(fixtureTraces());
		const sonnet = report.byModel.find((b) => b.key === "claude-sonnet-4-6");
		assert.ok(sonnet);
		assert.equal(sonnet.spans, 2);
		assert.equal(sonnet.tokensIn, 80_000);
		assert.equal(sonnet.costUsd, 0.71);
		const fable = report.byModel.find((b) => b.key === "claude-fable-5");
		assert.equal(fable?.costUsd, 0.09);
	});

	it("breaks cost down by task, including trace-level totals", () => {
		const report = analyzeTraces(fixtureTraces());
		const api = report.byTask.find((b) => b.key === "backend-api");
		assert.equal(api?.spans, 5);
		assert.equal(api?.tokensIn, 60_000);
		const docs = report.byTask.find((b) => b.key === "docs");
		assert.equal(docs?.tokensIn, 5_000);
		assert.equal(docs?.costUsd, 0.05);
	});

	it("breaks cost down by workflow", () => {
		const report = analyzeTraces(fixtureTraces());
		const x = report.byWorkflow.find((b) => b.key === "feature-x");
		assert.equal(x?.tokensIn, 210_000);
		const y = report.byWorkflow.find((b) => b.key === "feature-y");
		assert.equal(y?.costUsd, 0.05);
	});

	it("ranks top spans by cost", () => {
		const report = analyzeTraces(fixtureTraces(), { topSpans: 2 });
		assert.equal(report.topSpans.length, 2);
		assert.equal(report.topSpans[0]?.spanName, "write-tests");
		assert.equal(report.topSpans[0]?.costUsd, 0.5);
		assert.equal(report.topSpans[1]?.spanName, "implement");
	});

	it("detects identical repeated tool outputs (>= 2x)", () => {
		const report = analyzeTraces(fixtureTraces());
		assert.equal(report.waste.repeatedToolOutputs.length, 1);
		const repeat = report.waste.repeatedToolOutputs[0];
		assert.equal(repeat?.spanName, "read_file");
		assert.equal(repeat?.occurrences, 3);
		assert.equal(repeat?.redundantCalls, 2);
		assert.ok((repeat?.estimatedWastedTokens ?? 0) > 0);
		assert.equal(
			report.waste.estimatedWastedTokens,
			repeat?.estimatedWastedTokens,
		);
	});

	it("flags spans whose input tokens exceed the threshold", () => {
		const report = analyzeTraces(fixtureTraces());
		const flagged = report.waste.oversizedInputs.map((o) => o.spanName);
		assert.deepEqual(flagged, ["huge-context", "implement", "write-tests"]);
		assert.equal(report.waste.inputTokenThreshold, 20_000);
	});

	it("respects a custom input-token threshold", () => {
		const report = analyzeTraces(fixtureTraces(), {
			inputTokenThreshold: 100_000,
		});
		assert.deepEqual(
			report.waste.oversizedInputs.map((o) => o.spanName),
			["huge-context"],
		);
	});

	it("applies price overrides", () => {
		const report = analyzeTraces(fixtureTraces(), {
			prices: {
				"claude-fable-5": { inputPerMTok: 600, outputPerMTok: 3000 },
			},
		});
		const fable = report.byModel.find((b) => b.key === "claude-fable-5");
		assert.equal(fable?.costUsd, 9);
		// Models absent from a custom table become unpriced.
		assert.ok(report.summary.unpricedModels.includes("claude-sonnet-4-6"));
	});

	it("uses trace timestamps for duration", () => {
		const report = analyzeTraces(fixtureTraces());
		assert.equal(report.summary.durationMs, 30_000);
	});

	it("handles an empty trace list", () => {
		const report = analyzeTraces([]);
		assert.equal(report.summary.traces, 0);
		assert.equal(report.summary.costUsd, 0);
		assert.deepEqual(report.byModel, []);
		assert.deepEqual(report.waste.repeatedToolOutputs, []);
	});

	it("carries loader warnings into the report", () => {
		const report = analyzeTraces([], { warnings: ["something was skipped"] });
		assert.deepEqual(report.warnings, ["something was skipped"]);
	});
});
