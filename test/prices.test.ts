import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	costForTokens,
	findPrice,
	loadOptConfig,
	PRICE_TABLE,
	resolvePrices,
} from "../src/index.js";

describe("price table", () => {
	it("ships the expected built-in models", () => {
		for (const model of [
			"claude-fable-5",
			"claude-opus-4-8",
			"claude-sonnet-4-6",
			"claude-haiku-4-5",
			"gpt-5.2",
			"gpt-5-mini",
			"gemini-3-pro",
		]) {
			const price = PRICE_TABLE[model];
			assert.ok(price, `missing ${model}`);
			assert.ok(price.inputPerMTok > 0);
			assert.ok(price.outputPerMTok > price.inputPerMTok);
		}
	});

	it("findPrice matches exact model ids", () => {
		const match = findPrice("claude-fable-5", PRICE_TABLE);
		assert.ok(match);
		assert.equal(match.key, "claude-fable-5");
	});

	it("findPrice falls back to the longest prefix (dated model ids)", () => {
		const match = findPrice("claude-sonnet-4-6-20260115", PRICE_TABLE);
		assert.ok(match);
		assert.equal(match.key, "claude-sonnet-4-6");
		assert.equal(match.price.inputPerMTok, 3);
	});

	it("findPrice returns null for unknown models", () => {
		assert.equal(findPrice("totally-unknown-model", PRICE_TABLE), null);
	});

	it("costForTokens computes USD per 1M tokens", () => {
		const cost = costForTokens(1_000_000, 0, {
			inputPerMTok: 3,
			outputPerMTok: 15,
		});
		assert.equal(cost, 3);
		assert.equal(
			costForTokens(0, 100_000, { inputPerMTok: 3, outputPerMTok: 15 }),
			1.5,
		);
	});

	it("resolvePrices marks overrides and keeps builtins", () => {
		const resolved = resolvePrices({
			"claude-fable-5": { inputPerMTok: 1, outputPerMTok: 2 },
			"my-local-model": { inputPerMTok: 0, outputPerMTok: 0 },
		});
		assert.equal(resolved["claude-fable-5"]?.source, "override");
		assert.equal(resolved["claude-fable-5"]?.inputPerMTok, 1);
		assert.equal(resolved["claude-sonnet-4-6"]?.source, "builtin");
		assert.equal(resolved["my-local-model"]?.source, "override");
	});
});

describe("loadOptConfig", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "ruah-opt-prices-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns an empty config when .ruah/opt.json is absent", () => {
		const loaded = loadOptConfig(dir);
		assert.equal(loaded.found, false);
		assert.deepEqual(loaded.config, {});
		assert.deepEqual(loaded.warnings, []);
	});

	it("reads price overrides and waste threshold", () => {
		mkdirSync(join(dir, ".ruah"), { recursive: true });
		writeFileSync(
			join(dir, ".ruah", "opt.json"),
			JSON.stringify({
				prices: { "claude-fable-5": { inputPerMTok: 9, outputPerMTok: 45 } },
				waste: { inputTokenThreshold: 5000 },
			}),
			"utf-8",
		);
		const loaded = loadOptConfig(dir);
		assert.equal(loaded.found, true);
		assert.equal(loaded.config.prices?.["claude-fable-5"]?.inputPerMTok, 9);
		assert.equal(loaded.config.waste?.inputTokenThreshold, 5000);
		assert.deepEqual(loaded.warnings, []);
	});

	it("degrades invalid JSON to a warning, never throws", () => {
		mkdirSync(join(dir, ".ruah"), { recursive: true });
		writeFileSync(join(dir, ".ruah", "opt.json"), "{ nope", "utf-8");
		const loaded = loadOptConfig(dir);
		assert.equal(loaded.found, true);
		assert.deepEqual(loaded.config, {});
		assert.equal(loaded.warnings.length, 1);
		assert.match(loaded.warnings[0] ?? "", /invalid JSON/);
	});

	it("skips malformed price entries with a warning", () => {
		mkdirSync(join(dir, ".ruah"), { recursive: true });
		writeFileSync(
			join(dir, ".ruah", "opt.json"),
			JSON.stringify({
				prices: {
					good: { inputPerMTok: 1, outputPerMTok: 2 },
					bad: { inputPerMTok: "free" },
				},
			}),
			"utf-8",
		);
		const loaded = loadOptConfig(dir);
		assert.ok(loaded.config.prices?.good);
		assert.equal(loaded.config.prices?.bad, undefined);
		assert.equal(loaded.warnings.length, 1);
	});
});
