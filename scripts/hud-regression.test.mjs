import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hudSource = await readFile(
  new URL("../src/components/game/HudOverlay.tsx", import.meta.url),
  "utf8",
);
const styleSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const engineSource = await readFile(new URL("../src/game/engine.ts", import.meta.url), "utf8");

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
