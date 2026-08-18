/**
 * Hand-rolled token estimator — zero dependencies, no network, no model files.
 *
 * Heuristic: modern BPE vocabularies average ~4 characters per token on
 * English prose, and ~1.3 tokens per word. Dense text (code, minified JSON)
 * skews the per-word ratio low, whitespace-heavy prose skews the per-char
 * ratio low — so we blend the two estimates to hedge both directions.
 *
 * Expect roughly ±20% versus a real tokenizer. Good enough for spend
 * profiling; do not use for billing.
 */

/** Average characters per token (BPE English prose heuristic). */
const CHARS_PER_TOKEN = 4;

/** Average tokens per whitespace-delimited word (word-boundary correction). */
const TOKENS_PER_WORD = 1.32;

/** Detailed token estimate for a piece of text. */
export interface TokenEstimate {
	/** Estimated token count. */
	tokens: number;
	/** Character count (UTF-16 code units). */
	chars: number;
	/** Whitespace-delimited word count. */
	words: number;
	/** Line count (0 for empty text). */
	lines: number;
}

/** Estimate tokens for a text with full detail (chars, words, lines). */
export function estimateText(text: string): TokenEstimate {
	const chars = text.length;
	if (chars === 0) {
		return { tokens: 0, chars: 0, words: 0, lines: 0 };
	}
	const words = text.match(/\S+/g)?.length ?? 0;
	const lines = text.split("\n").length;

	const charEstimate = chars / CHARS_PER_TOKEN;
	const wordEstimate = words * TOKENS_PER_WORD;
	// Blend: average of both signals; fall back to chars when there are no
	// word boundaries at all (e.g. one long base64 blob).
	const blended =
		words === 0 ? charEstimate : (charEstimate + wordEstimate) / 2;
	const tokens = Math.max(1, Math.round(blended));
	return { tokens, chars, words, lines };
}

/** Estimate the token count of a text. Returns 0 for an empty string. */
export function estimateTokens(text: string): number {
	return estimateText(text).tokens;
}
