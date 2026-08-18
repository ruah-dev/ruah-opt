/**
 * Self-contained HTML report. No CDN, no fonts, no analytics.
 * Every interpolation goes through esc().
 */

import type { OptReport } from "./analyze.js";
import type { WasteFinding } from "./waste.js";

function esc(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function bar(widthPct: number, label: string): string {
	const w = Math.max(1, Math.min(100, widthPct));
	return `<div class="bar"><span style="width:${w}%"></span><em>${esc(label)}</em></div>`;
}

/** Render one self-contained HTML document from an analyze report + waste. */
export function renderHtml(
	report: OptReport,
	findings: WasteFinding[],
): string {
	const { summary } = report;
	const maxCost = Math.max(0.0001, ...report.byModel.map((b) => b.costUsd));
	const modelBars = report.byModel
		.slice(0, 8)
		.map((b) =>
			bar((b.costUsd / maxCost) * 100, `${b.key}  $${b.costUsd.toFixed(4)}`),
		)
		.join("");

	const wasteRows = findings
		.slice(0, 10)
		.map(
			(f) =>
				`<tr><td>${esc(f.heuristic)}</td><td>${esc(f.spanName)}</td><td class="num">${f.tokens.toLocaleString("en-US")}</td><td class="num">${f.percentOfSession}%</td><td>${esc(f.fix)}</td></tr>`,
		)
		.join("");

	const models = summary.models.map(esc).join(", ") || "(none)";

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ruah-opt · ${esc(report.generatedAt)}</title>
<style>
:root { color-scheme: light dark; --bg:#f6f4ef; --ink:#1b1a17; --muted:#6b675e; --acc:#c45c26; --card:#fff; --line:#e4dfd4; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#161513; --ink:#f3efe6; --muted:#a39c90; --acc:#e0874d; --card:#221f1b; --line:#3a352e; }
}
html,body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.45 ui-sans-serif,system-ui,sans-serif; }
main { max-width:880px; margin:0 auto; padding:2.5rem 1.25rem 4rem; }
h1 { font-size:1.6rem; margin:0 0 .25rem; }
.sub { color:var(--muted); margin:0 0 1.5rem; }
.hero { display:flex; gap:1rem; flex-wrap:wrap; margin:0 0 2rem; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:1rem 1.15rem; min-width:10rem; }
.card b { display:block; font-size:1.35rem; }
.card span { color:var(--muted); font-size:.85rem; }
h2 { font-size:1.05rem; margin:1.75rem 0 .6rem; }
.bar { position:relative; height:1.4rem; background:var(--line); border-radius:4px; margin:0 0 .4rem; overflow:hidden; }
.bar span { display:block; height:100%; background:var(--acc); }
.bar em { position:absolute; left:.5rem; top:0; font-style:normal; font-size:.8rem; line-height:1.4rem; }
table { width:100%; border-collapse:collapse; font-size:.9rem; }
th,td { text-align:left; padding:.4rem .35rem; border-bottom:1px solid var(--line); vertical-align:top; }
.num { text-align:right; font-variant-numeric:tabular-nums; }
footer { margin-top:2rem; color:var(--muted); font-size:.8rem; }
</style>
</head>
<body>
<main>
<h1>ruah-opt</h1>
<p class="sub">${esc(report.generatedAt)}${report.tracesDir ? ` · ${esc(report.tracesDir)}` : ""}</p>
<div class="hero">
  <div class="card"><b>$${summary.costUsd.toFixed(4)}</b><span>estimated cost</span></div>
  <div class="card"><b>${summary.totalTokens.toLocaleString("en-US")}</b><span>tokens in+out</span></div>
  <div class="card"><b>${summary.traces}</b><span>sessions</span></div>
  <div class="card"><b>${summary.spans}</b><span>spans</span></div>
</div>
<p>Models: ${models}</p>
<h2>Cost by model</h2>
${modelBars || "<p>No priced model data.</p>"}
<h2>Waste top 10</h2>
${
	wasteRows
		? `<table><thead><tr><th>H</th><th>span</th><th class="num">tokens</th><th class="num">%</th><th>fix</th></tr></thead><tbody>${wasteRows}</tbody></table>`
		: "<p>No waste findings.</p>"
}
<footer>Offline report. Cache tokens are not folded into input. Heuristic estimates labeled in the JSON.</footer>
</main>
</body>
</html>
`;
}

/** True when HTML contains an external network resource reference. */
export function htmlHasExternalResource(html: string): boolean {
	return /(?:src|href)\s*=\s*["']https?:\/\//i.test(html);
}
