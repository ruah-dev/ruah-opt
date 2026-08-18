/**
 * Model price table and `.ruah/opt.json` config loading.
 *
 * The built-in PRICE_TABLE is a PLACEHOLDER snapshot of mid-2026 list prices.
 * Providers change prices without notice — override any entry (or add your
 * own models) via `.ruah/opt.json` in the consumer's repo.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Price of one model, in USD per 1M tokens. */
export interface ModelPrice {
	/** USD per 1M input (prompt) tokens. */
	inputPerMTok: number;
	/** USD per 1M output (completion) tokens. */
	outputPerMTok: number;
}

/** Where a resolved price entry came from. */
export type PriceSource = "builtin" | "override";

/** A price entry annotated with its source. */
export interface ResolvedPrice extends ModelPrice {
	source: PriceSource;
}

/**
 * Built-in price table — PLACEHOLDER mid-2026 list prices, USD per 1M tokens.
 * Override via `.ruah/opt.json`:
 *
 * ```json
 * { "prices": { "claude-fable-5": { "inputPerMTok": 6, "outputPerMTok": 30 } } }
 * ```
 */
export const PRICE_TABLE: Readonly<Record<string, ModelPrice>> = {
	"claude-fable-5": { inputPerMTok: 6, outputPerMTok: 30 },
	"claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
	"claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
	"claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
	"gpt-5.2": { inputPerMTok: 2.5, outputPerMTok: 10 },
	"gpt-5-mini": { inputPerMTok: 0.25, outputPerMTok: 2 },
	"gemini-3-pro": { inputPerMTok: 2, outputPerMTok: 12 },
	"gemini-3-flash": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
};

/** Human-readable disclaimer attached to every price output. */
export const PRICE_TABLE_NOTE =
	'Built-in prices are mid-2026 placeholders (USD per 1M tokens) — override via .ruah/opt.json { "prices": { ... } }';

/** Default waste threshold: spans with more input tokens than this are flagged. */
export const DEFAULT_INPUT_TOKEN_THRESHOLD = 20_000;

/** Shape of `.ruah/opt.json`. */
export interface OptConfig {
	/** Per-model price overrides (merged over the built-in table). */
	prices?: Record<string, ModelPrice>;
	/** Wasted-token detection settings. */
	waste?: {
		/** Spans with `tokensIn` above this are flagged as oversized. */
		inputTokenThreshold?: number;
	};
}

/** Result of loading `.ruah/opt.json`. */
export interface LoadedOptConfig {
	/** The normalized config (empty object when no file / invalid file). */
	config: OptConfig;
	/** Path that was checked. */
	path: string;
	/** Whether the file existed. */
	found: boolean;
	/** Non-fatal problems found while reading the config. */
	warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function normalizeConfig(parsed: unknown, warnings: string[]): OptConfig {
	if (!isRecord(parsed)) {
		warnings.push("opt.json: expected a JSON object — ignoring config");
		return {};
	}
	const config: OptConfig = {};

	if (parsed.prices !== undefined) {
		if (!isRecord(parsed.prices)) {
			warnings.push('opt.json: "prices" must be an object — ignoring it');
		} else {
			const prices: Record<string, ModelPrice> = {};
			for (const [model, entry] of Object.entries(parsed.prices)) {
				if (
					isRecord(entry) &&
					isFiniteNumber(entry.inputPerMTok) &&
					isFiniteNumber(entry.outputPerMTok) &&
					entry.inputPerMTok >= 0 &&
					entry.outputPerMTok >= 0
				) {
					prices[model] = {
						inputPerMTok: entry.inputPerMTok,
						outputPerMTok: entry.outputPerMTok,
					};
				} else {
					warnings.push(
						`opt.json: prices["${model}"] needs numeric inputPerMTok/outputPerMTok — ignoring it`,
					);
				}
			}
			config.prices = prices;
		}
	}

	if (parsed.waste !== undefined) {
		if (!isRecord(parsed.waste)) {
			warnings.push('opt.json: "waste" must be an object — ignoring it');
		} else {
			const threshold = parsed.waste.inputTokenThreshold;
			if (threshold !== undefined) {
				if (isFiniteNumber(threshold) && threshold > 0) {
					config.waste = { inputTokenThreshold: threshold };
				} else {
					warnings.push(
						"opt.json: waste.inputTokenThreshold must be a positive number — ignoring it",
					);
				}
			}
		}
	}

	return config;
}

/**
 * Load `.ruah/opt.json` from the consumer's working directory.
 * Missing file is normal (returns an empty config); invalid JSON degrades to
 * an empty config with a warning — it never throws.
 */
export function loadOptConfig(cwd: string = process.cwd()): LoadedOptConfig {
	const path = join(cwd, ".ruah", "opt.json");
	const warnings: string[] = [];
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch {
		return { config: {}, path, found: false, warnings };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		warnings.push(`ignoring ${path}: invalid JSON (${detail})`);
		return { config: {}, path, found: true, warnings };
	}
	return {
		config: normalizeConfig(parsed, warnings),
		path,
		found: true,
		warnings,
	};
}

/**
 * Merge override prices over the built-in table, annotating each entry with
 * its source ("builtin" or "override").
 */
export function resolvePrices(
	overrides?: Record<string, ModelPrice>,
): Record<string, ResolvedPrice> {
	const resolved: Record<string, ResolvedPrice> = {};
	for (const [model, price] of Object.entries(PRICE_TABLE)) {
		resolved[model] = { ...price, source: "builtin" };
	}
	for (const [model, price] of Object.entries(overrides ?? {})) {
		resolved[model] = { ...price, source: "override" };
	}
	return resolved;
}

/**
 * Find the price entry for a model id. Tries an exact match first, then the
 * longest table key the model id starts with — so a dated id like
 * "claude-sonnet-4-6-20260115" resolves to the "claude-sonnet-4-6" entry.
 * Returns null when the model is not in the table.
 */
export function findPrice<T extends ModelPrice>(
	model: string,
	table: Record<string, T>,
): { key: string; price: T } | null {
	const exact = table[model];
	if (exact !== undefined) {
		return { key: model, price: exact };
	}
	let bestKey: string | null = null;
	for (const key of Object.keys(table)) {
		if (
			model.startsWith(key) &&
			(bestKey === null || key.length > bestKey.length)
		) {
			bestKey = key;
		}
	}
	if (bestKey === null) {
		return null;
	}
	const price = table[bestKey];
	return price === undefined ? null : { key: bestKey, price };
}

/** Compute the USD cost of a token pair under a price entry. */
export function costForTokens(
	tokensIn: number,
	tokensOut: number,
	price: ModelPrice,
): number {
	return (
		(tokensIn * price.inputPerMTok + tokensOut * price.outputPerMTok) /
		1_000_000
	);
}
