import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { loadTraces, TracesDirNotFoundError } from "../src/index.js";

describe("trace loading", () => {
	let dir: string;

	beforeEach(() => {
		// Temp dir — never the package folder, never a real .ruah
		dir = mkdtempSync(join(tmpdir(), "ruah-opt-traces-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("throws TracesDirNotFoundError for a missing directory", () => {
		assert.throws(() => loadTraces(join(dir, "nope")), TracesDirNotFoundError);
	});

	it("loads a single-JSON trace file", () => {
		writeFileSync(
			join(dir, "one.json"),
			JSON.stringify({
				traceId: "tr-1",
				taskName: "api",
				spans: [{ name: "llm", startedAt: "2026-06-12T10:00:00Z" }],
			}),
			"utf-8",
		);
		const result = loadTraces(dir);
		assert.equal(result.filesRead, 1);
		assert.equal(result.traces.length, 1);
		assert.equal(result.traces[0]?.traceId, "tr-1");
		assert.deepEqual(result.warnings, []);
	});

	it("loads a JSON array of traces", () => {
		writeFileSync(
			join(dir, "many.json"),
			JSON.stringify([
				{ traceId: "a", spans: [] },
				{ traceId: "b", spans: [] },
			]),
			"utf-8",
		);
		const result = loadTraces(dir);
		assert.equal(result.traces.length, 2);
	});

	it("loads a JSONL stream of full traces", () => {
		const lines = [
			JSON.stringify({ traceId: "l1", spans: [] }),
			JSON.stringify({ traceId: "l2", spans: [] }),
		];
		writeFileSync(join(dir, "stream.jsonl"), `${lines.join("\n")}\n`, "utf-8");
		const result = loadTraces(dir);
		assert.deepEqual(result.traces.map((t) => t.traceId).sort(), ["l1", "l2"]);
	});

	it("groups JSONL span events by traceId into synthesized traces", () => {
		const lines = [
			JSON.stringify({
				traceId: "tr-9",
				taskName: "tests",
				name: "llm-1",
				startedAt: "2026-06-12T10:00:00Z",
				model: "claude-haiku-4-5",
				tokensIn: 100,
				tokensOut: 10,
			}),
			JSON.stringify({
				traceId: "tr-9",
				name: "llm-2",
				startedAt: "2026-06-12T10:01:00Z",
				model: "claude-haiku-4-5",
				tokensIn: 200,
				tokensOut: 20,
			}),
			JSON.stringify({
				traceId: "tr-10",
				span: { name: "wrapped", startedAt: "2026-06-12T10:02:00Z" },
			}),
		];
		writeFileSync(join(dir, "events.jsonl"), lines.join("\n"), "utf-8");
		const result = loadTraces(dir);
		assert.equal(result.traces.length, 2);
		const tr9 = result.traces.find((t) => t.traceId === "tr-9");
		assert.ok(tr9);
		assert.equal(tr9.spans.length, 2);
		assert.equal(tr9.taskName, "tests");
		const tr10 = result.traces.find((t) => t.traceId === "tr-10");
		assert.equal(tr10?.spans[0]?.name, "wrapped");
	});

	it("recurses into subdirectories and ignores non-json files", () => {
		mkdirSync(join(dir, "nested"));
		writeFileSync(
			join(dir, "nested", "deep.json"),
			JSON.stringify({ traceId: "deep", spans: [] }),
			"utf-8",
		);
		writeFileSync(join(dir, "notes.txt"), "not a trace", "utf-8");
		const result = loadTraces(dir);
		assert.equal(result.filesRead, 1);
		assert.equal(result.traces[0]?.traceId, "deep");
	});

	it("turns malformed files into warnings instead of crashing", () => {
		writeFileSync(join(dir, "broken.json"), "{ this is not json", "utf-8");
		writeFileSync(
			join(dir, "good.json"),
			JSON.stringify({ traceId: "ok", spans: [] }),
			"utf-8",
		);
		const result = loadTraces(dir);
		assert.equal(result.traces.length, 1);
		assert.equal(result.warnings.length, 1);
		assert.match(result.warnings[0] ?? "", /not valid JSON or JSONL/);
	});

	it("warns about malformed JSONL lines but keeps the good ones", () => {
		const lines = [
			JSON.stringify({ traceId: "keep", spans: [] }),
			"{{{ bad line",
		];
		writeFileSync(join(dir, "mixed.jsonl"), lines.join("\n"), "utf-8");
		const result = loadTraces(dir);
		assert.equal(result.traces.length, 1);
		assert.match(result.warnings[0] ?? "", /malformed JSONL line/);
	});

	it("synthesizes a traceId for trace objects missing one", () => {
		writeFileSync(
			join(dir, "anon.json"),
			JSON.stringify({
				spans: [{ name: "s", startedAt: "2026-06-12T10:00:00Z" }],
			}),
			"utf-8",
		);
		const result = loadTraces(dir);
		assert.equal(result.traces.length, 1);
		assert.match(result.traces[0]?.traceId ?? "", /^file:anon\.json/);
	});
});
