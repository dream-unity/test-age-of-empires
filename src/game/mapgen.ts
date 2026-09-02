import { TILE } from "./catalog";

export type MapKind = "duel" | "raid";

export type PlacedNode = { type: string; tx: number; ty: number };

export type GenMap = {
  w: number;
  h: number;
  tiles: Uint8Array;
  player: { tx: number; ty: number };
  enemy: { tx: number; ty: number };
  nodes: PlacedNode[];
  animals: { tx: number; ty: number }[];
};

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blob(
  tiles: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number,
  val: number,
  rng: () => number,
) {
  const rr = r * r;
  for (let y = cy - r - 1; y <= cy + r + 1; y++) {
    for (let x = cx - r - 1; x <= cx + r + 1; x++) {
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      const dx = x - cx + (rng() - 0.5) * 1.4;
      const dy = y - cy + (rng() - 0.5) * 1.4;
      if (dx * dx + dy * dy <= rr) tiles[y * w + x] = val;
    }
  }
}

function clearAround(tiles: Uint8Array, w: number, h: number, cx: number, cy: number, r: number) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      tiles[y * w + x] = 0;
    }
  }
}

function occupied(nodes: PlacedNode[], tx: number, ty: number, rad = 1) {
  return nodes.some((n) => Math.abs(n.tx - tx) <= rad && Math.abs(n.ty - ty) <= rad);
}

function scatter(
  nodes: PlacedNode[],
  tiles: Uint8Array,
  w: number,
  h: number,
  type: string,
  cx: number,
  cy: number,
  n: number,
  spread: number,
  rng: () => number,
) {
  let placed = 0;
  let tries = 0;
  while (placed < n && tries < n * 18) {
    tries++;
    const tx = Math.round(cx + (rng() - 0.5) * spread);
    const ty = Math.round(cy + (rng() - 0.5) * spread);
    if (tx < 2 || ty < 2 || tx >= w - 2 || ty >= h - 2) continue;
    if (tiles[ty * w + tx] === 2) continue;
    if (occupied(nodes, tx, ty, type === "tree" ? 1 : 2)) continue;
    nodes.push({ type, tx, ty });
    placed++;
  }
}

export function generateMap(kind: MapKind, seed: number): GenMap {
  const rng = mulberry32(seed >>> 0);
  const w = kind === "raid" ? 52 : 68;
  const h = kind === "raid" ? 52 : 68;
  const tiles = new Uint8Array(w * h);

  const dirtCount = 8 + Math.floor(rng() * 6);
  for (let i = 0; i < dirtCount; i++) {
    blob(tiles, w, h, 4 + Math.floor(rng() * (w - 8)), 4 + Math.floor(rng() * (h - 8)), 3 + Math.floor(rng() * 4), 1, rng);
  }
  const lakes = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < lakes; i++) {
    blob(
      tiles,
      w,
      h,
      8 + Math.floor(rng() * (w - 16)),
      8 + Math.floor(rng() * (h - 16)),
      3 + Math.floor(rng() * 4),
      2,
      rng,
    );
  }

  const player = kind === "raid" ? { tx: 8, ty: (h / 2) | 0 } : { tx: 8, ty: h - 10 };
  const enemy = kind === "raid" ? { tx: w - 10, ty: (h / 2) | 0 } : { tx: w - 10, ty: 8 };
  clearAround(tiles, w, h, player.tx, player.ty, 7);
  clearAround(tiles, w, h, enemy.tx, enemy.ty, 7);

  const nodes: PlacedNode[] = [];
  for (const s of [player, enemy]) {
    scatter(nodes, tiles, w, h, "berry", s.tx + 4, s.ty + 1, 6, 6, rng);
    scatter(nodes, tiles, w, h, "gold", s.tx + 1, s.ty - 5, 3, 4, rng);
    scatter(nodes, tiles, w, h, "stone", s.tx - 2, s.ty + 5, 3, 4, rng);
    scatter(nodes, tiles, w, h, "tree", s.tx + 6, s.ty - 2, 14, 10, rng);
  }
  scatter(nodes, tiles, w, h, "gold", (w / 2) | 0, (h / 2) | 0, 4, 10, rng);
  scatter(nodes, tiles, w, h, "stone", (w / 2) | 0, ((h / 2) | 0) + 6, 3, 8, rng);

  const forests = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < forests; i++) {
    const fx = 6 + Math.floor(rng() * (w - 12));
    const fy = 6 + Math.floor(rng() * (h - 12));
    if (Math.hypot(fx - player.tx, fy - player.ty) < 10) continue;
    if (Math.hypot(fx - enemy.tx, fy - enemy.ty) < 10) continue;
    scatter(nodes, tiles, w, h, "tree", fx, fy, 10 + Math.floor(rng() * 10), 8, rng);
  }

  const animals: { tx: number; ty: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const tx = 4 + Math.floor(rng() * (w - 8));
    const ty = 4 + Math.floor(rng() * (h - 8));
    if (tiles[ty * w + tx] === 2) continue;
    if (Math.hypot(tx - player.tx, ty - player.ty) < 5) continue;
    animals.push({ tx, ty });
  }

  return { w, h, tiles, player, enemy, nodes, animals };
}

export function tileCenter(tx: number, ty: number) {
  return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
}
