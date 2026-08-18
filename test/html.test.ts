import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OptReport } from "../src/index.js";
import { htmlHasExternalResource, renderHtml } from "../src/index.js";

const emptyReport: OptReport = {
	generatedAt: "2026-08-18T00:00:00.000Z",
	tracesDir: "/tmp/demo",
	summary: {
		traces: 1,
		spans: 2,
		llmSpans: 1,
		tokensIn: 100,
		tokensOut: 20,
		totalTokens: 120,
		costUsd: 0.0123,
		durationMs: 1000,
		models: ["claude-sonnet-4-6"],
		unpricedModels: [],
	},
	byModel: [
		{
			key: "claude-sonnet-4-6",
			spans: 1,
			tokensIn: 100,
			tokensOut: 20,
			costUsd: 0.0123,
		},
	],
	byTask: [],
	byWorkflow: [],
	topSpans: [],
	waste: {
		inputTokenThreshold: 20000,
		repeatedToolOutputs: [],
		oversizedInputs: [],
		estimatedWastedTokens: 0,
	},
	warnings: [],
};

describe("renderHtml", () => {
	it("escapes hostile span names and has no external resources", () => {
		const html = renderHtml(emptyReport, [
			{
				heuristic: "H1",
				tokens: 50_000,
				percentOfSession: 40,
				spanName: "<script>alert(1)</script>",
				traceId: "t",
				fix: '"><img onerror=alert(1)>',
				detail: "x",
			},
		]);
		assert.equal(html.includes("<script>alert(1)</script>"), false);
		assert.ok(html.includes("&lt;script&gt;"));
		assert.equal(htmlHasExternalResource(html), false);
		assert.ok(!/https?:\/\//.test(html.replace(/<!DOCTYPE html>/, "")));
		assert.match(html, /\$0\.0123/);
	});
});
