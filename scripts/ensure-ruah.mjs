// After install, make sure the `ruah` front door exists.
// sync-with: ruah-guard/scripts/ensure-ruah.mjs
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

try {
	const hook = require.resolve("@ruah-dev/cli/postinstall.mjs");
	await import(pathToFileURL(hook).href);
} catch {
	console.warn(
		"[@ruah-dev/opt] @ruah-dev/cli not found. Install it so `ruah opt` works: npm i -g @ruah-dev/cli",
	);
}
