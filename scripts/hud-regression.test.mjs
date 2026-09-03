import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hudSource = await readFile(
  new URL("../src/components/game/HudOverlay.tsx", import.meta.url),
  "utf8",
);
const styleSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const engineSource = await readFile(new URL("../src/game/engine.ts", import.meta.url), "utf8");
const appSource = await readFile(
  new URL("../src/components/game/DawnApp.tsx", import.meta.url),
  "utf8",
);
const titleSource = await readFile(
  new URL("../src/components/game/TitleScreen.tsx", import.meta.url),
  "utf8",
);
const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const viteSource = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");

test("the command menu reflows without hiding actions horizontally", () => {
  assert.match(hudSource, /data-testid="command-grid"/);
  assert.doesNotMatch(hudSource, /data-testid="command-grid"[^>]*overflow-x-auto/);
  assert.match(styleSource, /\.game-command-grid\s*\{[^}]*display: grid;/s);
  assert.match(styleSource, /grid-template-columns: repeat\(auto-fit, minmax\(8\.25rem, 1fr\)\);/);
  assert.match(styleSource, /overflow-x: hidden;/);
  assert.match(styleSource, /overflow-y: auto;/);
});

test("gameplay guidance is confined to the bottom command panel", () => {
  assert.doesNotMatch(hudSource, /gameplay-tip|Dismiss tip|showHint/);
  assert.equal(hudSource.match(/\{hud\.hint\}/g)?.length, 1);
  assert.match(hudSource, /data-testid="command-panel"[\s\S]*\{hud\.hint\}/);
});

test("touch movement is explicit and empty-ground taps can clear selection", () => {
  assert.match(engineSource, /acts\.push\(\{ id: "move", label: "Move"/);
  assert.match(engineSource, /this\.isOrderTarget\(hit, false\)/);
  assert.match(engineSource, /else if \(!ev\.shiftKey\) this\.selected = \[\];/);
  assert.match(engineSource, /this\.commandMode = this\.commandMode === next \? null : next;/);
});

test("Play starts immediately with fallback art and asset loading cannot hang forever", () => {
  assert.doesNotMatch(titleSource, /disabled=\{!ready\}|Illuminating the map/);
  assert.match(appSource, /setGameAssets\(assets \?\? FALLBACK_ASSETS\)/);
  assert.match(appSource, /new Engine\(canvasRef\.current, gameAssets, cfg, setHud\)/);
  assert.match(engineSource, /ASSET_LOAD_TIMEOUT_MS = 8_000/);
  assert.match(engineSource, /controller\.abort\(\)/);
});

test("built and raw Pages deployments each load one cache-busted application bundle", () => {
  assert.equal(indexSource.match(/src="\/src\/main\.tsx"/g)?.length, 1);
  assert.match(indexSource, /var built = entry .*\/src\/main\.tsx.* === -1/s);
  assert.match(indexSource, /if \(dev \|\| built\) return/);
  assert.match(indexSource, /www\/game\.js\?v=" \+ version/);
  assert.match(indexSource, /version = "20260903-touch-farms"/);
  assert.match(viteSource, /entryFileNames: "www\/game-\[hash\]\.js"/);
  assert.match(viteSource, /game-\[hash\]\[extname\]/);
  assert.match(viteSource, /resolve\(compatibilityAssets, "game\.js"\)/);
});
