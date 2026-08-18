import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI = join(__dirname, "..", "src", "cli.js");

interface CliResult {
	status: number | null;
	stdout: string;
	stderr: string;
}

function run(args: string[], cwd: string): CliResult {
	const res = spawnSync(process.execPath, [CLI, ...args], {
		cwd,
		encoding: "utf-8",
		env: { ...process.env, NO_COLOR: "1" },
	});
	return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function writeFixtureTraces(dir: string): void {
	const tracesDir = join(dir, ".ruah", "traces");
	mkdirSync(tracesDir, { recursive: true });
	writeFileSync(
		join(tracesDir, "api.json"),
		JSON.stringify({
			traceId: "tr-api",
			taskName: "backend-api",
			workflowName: "feature-x",
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
					name: "grep",
					startedAt: "2026-06-12T10:00:10Z",
					type: "tool_call",
					attributes: { output: "src/index.ts: export function main()" },
				},
				{
					name: "grep",
					startedAt: "2026-06-12T10:00:20Z",
					type: "tool_call",
					attributes: { output: "src/index.ts: export function main()" },
				},
			],
		}),
		"utf-8",
	);
	writeFileSync(
		join(tracesDir, "tests.jsonl"),
		[
			JSON.stringify({
				traceId: "tr-tests",
				taskName: "tests",
				workflowName: "feature-x",
				name: "write-tests",
				startedAt: "2026-06-12T11:00:00Z",
				model: "claude-sonnet-4-6",
				tokensIn: 40_000,
				tokensOut: 2_000,
			}),
		].join("\n"),
		"utf-8",
	);
}

describe("ruah-opt CLI", () => {
	let dir: string;

	beforeEach(() => {
		// Temp dir — never the package folder, never a real .ruah
		dir = mkdtempSync(join(tmpdir(), "ruah-opt-cli-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("--help prints usage and exits 0", () => {
		const res = run(["--help"], dir);
		assert.equal(res.status, 0);
		assert.ok(res.stdout.includes("agent cost & token analytics"));
		assert.ok(res.stdout.includes("analyze [tracesDir"));
	});

	it("-h prints usage and exits 0", () => {
		const res = run(["-h"], dir);
		assert.equal(res.status, 0);
		assert.ok(res.stdout.includes("Usage:"));
	});

	it("--version prints the package version and exits 0", () => {
		const res = run(["--version"], dir);
		assert.equal(res.status, 0);
		assert.match(res.stdout, /ruah-opt \d+\.\d+\.\d+/);
	});

	it("no arguments prints help and exits 0", () => {
		const res = run([], dir);
		assert.equal(res.status, 0);
		assert.ok(res.stdout.includes("Usage:"));
	});

	it("analyze --json emits a full machine-readable report", () => {
		writeFixtureTraces(dir);
		const res = run(["analyze", "--json"], dir);
		assert.equal(res.status, 0);
		const data = JSON.parse(res.stdout);
		assert.equal(data.ok, true);
		assert.equal(data.report.summary.traces, 2);
		assert.equal(data.report.summary.tokensIn, 50_000);
		assert.equal(data.report.summary.tokensOut, 3_000);
		// fable: 0.06+0.03; sonnet: 0.12+0.03
		assert.equal(data.report.summary.costUsd, 0.24);
		assert.equal(data.report.byModel.length, 2);
		assert.equal(data.report.waste.repeatedToolOutputs.length, 1);
		assert.equal(data.report.waste.oversizedInputs.length, 1);
	});

	it("analyze (human) renders markdown tables", () => {
		writeFixtureTraces(dir);
		const res = run(["analyze"], dir);
		assert.equal(res.status, 0);
		assert.ok(res.stdout.includes("# ruah-opt report"));
		assert.ok(res.stdout.includes("## Cost by model"));
		assert.ok(res.stdout.includes("| claude-sonnet-4-6"));
	});

	it("analyze accepts an explicit traces directory", () => {
		const custom = join(dir, "my-traces");
		mkdirSync(custom, { recursive: true });
		writeFileSync(
			join(custom, "t.json"),
			JSON.stringify({
				traceId: "t",
				spans: [
					{
						name: "s",
						startedAt: "2026-06-12T10:00:00Z",
						model: "claude-haiku-4-5",
						tokensIn: 1_000_000,
						tokensOut: 0,
					},
				],
			}),
			"utf-8",
		);
		const res = run(["analyze", "my-traces", "--json"], dir);
		assert.equal(res.status, 0);
		const data = JSON.parse(res.stdout);
		assert.equal(data.report.summary.costUsd, 1);
	});

	it("analyze exits 1 when the traces directory is missing", () => {
		const res = run(["analyze", "--json"], dir);
		assert.equal(res.status, 1);
		const data = JSON.parse(res.stdout);
		assert.equal(data.ok, false);
		assert.match(data.error, /traces directory not found/);
	});

	it("analyze exits 1 when the directory has no traces", () => {
		mkdirSync(join(dir, ".ruah", "traces"), { recursive: true });
		const res = run(["analyze", "--json"], dir);
		assert.equal(res.status, 1);
		const data = JSON.parse(res.stdout);
		assert.match(data.error, /no traces found/);
	});

	it("analyze rejects a bad --top value", () => {
		writeFixtureTraces(dir);
		const res = run(["analyze", "--top", "zero", "--json"], dir);
		assert.equal(res.status, 1);
		const data = JSON.parse(res.stdout);
		assert.match(data.error, /--top must be a positive integer/);
	});

	it("cost --by task --json groups by task", () => {
		writeFixtureTraces(dir);
		const res = run(["cost", "--by", "task", "--json"], dir);
		assert.equal(res.status, 0);
		const data = JSON.parse(res.stdout);
		assert.equal(data.ok, true);
		assert.equal(data.by, "task");
		const keys = data.buckets.map((b: { key: string }) => b.key).sort();
		assert.deepEqual(keys, ["backend-api", "tests"]);
	});

	it("cost defaults to --by model", () => {
		writeFixtureTraces(dir);
		const res = run(["cost", "--json"], dir);
		assert.equal(res.status, 0);
		const data = JSON.parse(res.stdout);
		assert.equal(data.by, "model");
		assert.equal(data.buckets.length, 2);
	});

	it("cost rejects an unknown --by grouping", () => {
		writeFixtureTraces(dir);
		const res = run(["cost", "--by", "color", "--json"], dir);
		assert.equal(res.status, 1);
		const data = JSON.parse(res.stdout);
		assert.match(data.error, /--by must be one of/);
	});

	it("count --json estimates tokens for files", () => {
		const file = join(dir, "prompt.md");
		writeFileSync(
			file,
			"Summarize the trace files and produce a cost report for the team.",
			"utf-8",
		);
		const res = run(["count", "prompt.md", "--json"], dir);
		assert.equal(res.status, 0);
		const data = JSON.parse(res.stdout);
		assert.equal(data.ok, true);
		assert.equal(data.files.length, 1);
		assert.equal(data.files[0].file, "prompt.md");
		assert.ok(data.files[0].tokens > 5 && data.files[0].tokens < 40);
		assert.equal(data.total.tokens, data.files[0].tokens);
	});

	it("count without files exits 1", () => {
		const res = run(["count", "--json"], dir);
		assert.equal(res.status, 1);
		const data = JSON.parse(res.stdout);
		assert.match(data.error, /missing <file>/);
	});

	it("count with an unreadable file exits 1", () => {
		const res = run(["count", "missing.txt", "--json"], dir);
		assert.equal(res.status, 1);
		const data = JSON.parse(res.stdout);
		assert.match(data.error, /cannot read file/);
	});

	it("prices --json lists the built-in table with a placeholder note", () => {
		const res = run(["prices", "--json"], dir);
		assert.equal(res.status, 0);
		const data = JSON.parse(res.stdout);
		assert.equal(data.ok, true);
		assert.match(data.note, /placeholder/);
		assert.equal(data.prices["claude-fable-5"].source, "builtin");
		assert.equal(data.prices["claude-fable-5"].inputPerMTok, 6);
	});

	it("prices --json reflects .ruah/opt.json overrides", () => {
		mkdirSync(join(dir, ".ruah"), { recursive: true });
		writeFileSync(
			join(dir, ".ruah", "opt.json"),
			JSON.stringify({
				prices: { "claude-fable-5": { inputPerMTok: 9, outputPerMTok: 45 } },
			}),
			"utf-8",
		);
		const res = run(["prices", "--json"], dir);
		assert.equal(res.status, 0);
		const data = JSON.parse(res.stdout);
		assert.equal(data.prices["claude-fable-5"].source, "override");
		assert.equal(data.prices["claude-fable-5"].inputPerMTok, 9);
		assert.ok(data.configPath.endsWith(join(".ruah", "opt.json")));
	});

	it("price overrides change analyze costs", () => {
		writeFixtureTraces(dir);
		mkdirSync(join(dir, ".ruah"), { recursive: true });
		writeFileSync(
			join(dir, ".ruah", "opt.json"),
			JSON.stringify({
				prices: {
					"claude-fable-5": { inputPerMTok: 0, outputPerMTok: 0 },
					"claude-sonnet-4-6": { inputPerMTok: 0, outputPerMTok: 0 },
				},
			}),
			"utf-8",
		);
		const res = run(["analyze", "--json"], dir);
		assert.equal(res.status, 0);
		const data = JSON.parse(res.stdout);
		assert.equal(data.report.summary.costUsd, 0);
	});

	it("threshold from .ruah/opt.json drives oversized-input detection", () => {
		writeFixtureTraces(dir);
		mkdirSync(join(dir, ".ruah"), { recursive: true });
		writeFileSync(
			join(dir, ".ruah", "opt.json"),
			JSON.stringify({ waste: { inputTokenThreshold: 5_000 } }),
			"utf-8",
		);
		const res = run(["analyze", "--json"], dir);
		assert.equal(res.status, 0);
		const data = JSON.parse(res.stdout);
		assert.equal(data.report.waste.inputTokenThreshold, 5_000);
		assert.equal(data.report.waste.oversizedInputs.length, 2);
	});

	it("--json output is pure JSON on stdout (warnings go to stderr)", () => {
		writeFixtureTraces(dir);
		writeFileSync(join(dir, ".ruah", "traces", "junk.json"), "%%%", "utf-8");
		const res = run(["analyze", "--json"], dir);
		assert.equal(res.status, 0);
		// stdout must parse as a single JSON document
		const data = JSON.parse(res.stdout);
		assert.equal(data.ok, true);
		assert.equal(data.report.warnings.length, 1);
		assert.ok(res.stderr.includes("Warning:"));
	});

	it("unknown command exits 1", () => {
		const res = run(["frobnicate"], dir);
		assert.equal(res.status, 1);
		assert.ok(res.stderr.includes("unknown command"));
	});

	it("waste --json returns ranked findings", () => {
		writeFixtureTraces(dir);
		const res = run(["waste", "--json"], dir);
		assert.equal(res.status, 0);
		const data = JSON.parse(res.stdout);
		assert.equal(data.ok, true);
		assert.equal(data.schemaVersion, "1");
		assert.ok(Array.isArray(data.findings));
	});

	it("report --format html writes a self-contained file", () => {
		writeFixtureTraces(dir);
		const out = join(dir, "out.html");
		const res = run(
			["report", "--format", "html", "--out", out, "--json"],
			dir,
		);
		assert.equal(res.status, 0);
		const data = JSON.parse(res.stdout);
		assert.equal(data.ok, true);
		const html = readFileSync(out, "utf-8");
		assert.match(html, /<title>/);
		assert.equal(/https?:\/\//.test(html), false);
	});
});
