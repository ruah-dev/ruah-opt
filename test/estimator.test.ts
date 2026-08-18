import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateText, estimateTokens } from "../src/index.js";

describe("token estimator", () => {
	it("returns 0 for an empty string", () => {
		assert.equal(estimateTokens(""), 0);
	});

	it("returns at least 1 for any non-empty text", () => {
		assert.equal(estimateTokens("a"), 1);
		assert.ok(estimateTokens("   ") >= 1);
	});

	it("estimates English prose within sane bounds (chars/4 ± 40%)", () => {
		const text =
			"The optimizer reads trace files from the traces directory and " +
			"computes a cost breakdown per model, per task, and per workflow. " +
			"It flags repeated tool outputs and oversized inputs so teams can " +
			"see exactly where their agent budget goes before trying to cut it.";
		const tokens = estimateTokens(text);
		const charBaseline = text.length / 4;
		assert.ok(tokens >= charBaseline * 0.6, `tokens=${tokens} too low`);
		assert.ok(tokens <= charBaseline * 1.4, `tokens=${tokens} too high`);
	});

	it("stays within bounds for prose word counts (~1-2 tokens per word)", () => {
		const text = "profile spend before optimizing it across every workflow";
		const words = 8;
		const tokens = estimateTokens(text);
		assert.ok(
			tokens >= words * 0.8 && tokens <= words * 2.2,
			`tokens=${tokens}`,
		);
	});

	it("handles a long blob with no word boundaries via the char ratio", () => {
		const blob = "x".repeat(4000);
		const tokens = estimateTokens(blob);
		// One 4000-char "word": blend of 1000 (chars/4) and 1.32 (words).
		assert.ok(tokens >= 400 && tokens <= 1100, `tokens=${tokens}`);
	});

	it("is monotonic: more text never means fewer tokens", () => {
		const short = "hello world";
		const long = `${short} this is a longer sentence with more words in it`;
		assert.ok(estimateTokens(long) > estimateTokens(short));
	});

	it("estimateText reports chars, words, and lines", () => {
		const detail = estimateText("one two three\nfour five");
		assert.equal(detail.chars, 23);
		assert.equal(detail.words, 5);
		assert.equal(detail.lines, 2);
		assert.ok(detail.tokens >= 5 && detail.tokens <= 10);
	});
});
