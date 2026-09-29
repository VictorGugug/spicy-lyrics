import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ProjectVersion } from "./config.ts";

const version = process.argv[2] || ProjectVersion || "6.3.98";
const distDir = resolve("dist");
const outputDir = resolve("dist-server");

if (!existsSync(distDir)) {
  console.error("Dist folder does not exist. Run 'bun run build' first.");
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });

// 1. Copy spicy-lyrics.js as spicy-lyrics@<version>.mjs
const builtJs = resolve(distDir, "spicy-lyrics.js");
const versionedJs = resolve(outputDir, `spicy-lyrics@${version}.mjs`);
copyFileSync(builtJs, versionedJs);
console.log(`✓ Copied: dist-server/spicy-lyrics@${version}.mjs`);

// 2. Write version file
const versionFile = resolve(outputDir, "version");
writeFileSync(versionFile, version, "utf-8");
console.log(`✓ Wrote: dist-server/version (${version})`);

// 3. Ensure spicy-lyrics-pixel.mjs loader
const loaderFile = resolve(outputDir, "spicy-lyrics-pixel.mjs");
const loaderContent =
  "import(`https://cdn.jsdelivr.net/gh/iPixelGalaxy/spicy-lyrics@dev/builds/v2.0/entrypoint.mjs?v=${Date.now()}`);\n";
writeFileSync(loaderFile, loaderContent, "utf-8");
console.log("✓ Wrote: dist-server/spicy-lyrics-pixel.mjs");

// 4. Copy nginx.conf if present
const nginxSrc = resolve("project", "nginx.conf");
const nginxDest = resolve(outputDir, "nginx.conf");
if (existsSync(nginxSrc)) {
  copyFileSync(nginxSrc, nginxDest);
  console.log("✓ Copied: dist-server/nginx.conf");
}

console.log(
  "\nChannel build ready in dist-server/! You can upload these files to your server (review.tx24.dev)."
);
