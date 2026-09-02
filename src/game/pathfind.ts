const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NY = [0, 0, 1, -1, 1, -1, 1, -1];
const NC = [1, 1, 1, 1, 1.4142, 1.4142, 1.4142, 1.4142];

function octile(dx: number, dy: number) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return Math.max(ax, ay) + 0.4142 * Math.min(ax, ay);
}

export type Grid = { w: number; h: number; blocked: Uint8Array };

export function idx(g: Grid, x: number, y: number) {
  return y * g.w + x;
}

export function inb(g: Grid, x: number, y: number) {
  return x >= 0 && y >= 0 && x < g.w && y < g.h;
}

export function isBlocked(g: Grid, x: number, y: number) {
  return !inb(g, x, y) || g.blocked[idx(g, x, y)] !== 0;
}

export function nearestWalkable(g: Grid, x: number, y: number): { x: number; y: number } | null {
  x = Math.max(0, Math.min(g.w - 1, x | 0));
  y = Math.max(0, Math.min(g.h - 1, y | 0));
  if (!isBlocked(g, x, y)) return { x, y };
  for (let r = 1; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!isBlocked(g, nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

export function astar(
  g: Grid,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
): { x: number; y: number }[] | null {
  sx = sx | 0;
  sy = sy | 0;
  gx = gx | 0;
  gy = gy | 0;
  if (!inb(g, sx, sy) || !inb(g, gx, gy)) return null;
  const start = nearestWalkable(g, sx, sy);
  const goal = nearestWalkable(g, gx, gy);
  if (!start || !goal) return null;
  sx = start.x;
  sy = start.y;
  gx = goal.x;
  gy = goal.y;
  if (sx === gx && sy === gy) return [{ x: gx, y: gy }];

  const n = g.w * g.h;
  const came = new Int32Array(n).fill(-1);
  const gScore = new Float32Array(n).fill(1e15);
  const closed = new Uint8Array(n);
  const heapN: number[] = [];
  const heapF: number[] = [];

  const si = idx(g, sx, sy);
  gScore[si] = 0;
  heapN.push(si);
  heapF.push(octile(gx - sx, gy - sy));

  const push = (node: number, f: number) => {
    heapN.push(node);
    heapF.push(f);
    let i = heapN.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= heapF[i]) break;
      const tn = heapN[p];
      const tf = heapF[p];
      heapN[p] = heapN[i];
      heapF[p] = heapF[i];
      heapN[i] = tn;
      heapF[i] = tf;
      i = p;
    }
  };

  const pop = (): number => {
    const out = heapN[0];
    const last = heapN.pop()!;
    const lastF = heapF.pop()!;
    if (!heapN.length) return out;
    heapN[0] = last;
    heapF[0] = lastF;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let s = i;
      if (l < heapN.length && heapF[l] < heapF[s]) s = l;
      if (r < heapN.length && heapF[r] < heapF[s]) s = r;
      if (s === i) break;
      const tn = heapN[s];
      const tf = heapF[s];
      heapN[s] = heapN[i];
      heapF[s] = heapF[i];
      heapN[i] = tn;
      heapF[i] = tf;
      i = s;
    }
    return out;
  };

  const gi = idx(g, gx, gy);
  let found = false;
  let expanded = 0;
  while (heapN.length && expanded < 4000) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    if (cur === gi) {
      found = true;
      break;
    }
    const cx = cur % g.w;
    const cy = (cur / g.w) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = cx + NX[k];
      const ny = cy + NY[k];
      if (!inb(g, nx, ny) || g.blocked[idx(g, nx, ny)]) continue;
      if (k >= 4 && (g.blocked[idx(g, cx, ny)] || g.blocked[idx(g, nx, cy)])) continue;
      const ni = idx(g, nx, ny);
      if (closed[ni]) continue;
      const ng = gScore[cur] + NC[k];
      if (ng >= gScore[ni]) continue;
      gScore[ni] = ng;
      came[ni] = cur;
      push(ni, ng + octile(gx - nx, gy - ny));
    }
  }
  if (!found) return null;
  const path: { x: number; y: number }[] = [];
  let c = gi;
  while (c !== -1) {
    path.push({ x: c % g.w, y: (c / g.w) | 0 });
    if (c === si) break;
    c = came[c];
  }
  path.reverse();
  return smooth(g, path);
}

function hasLos(g: Grid, x0: number, y0: number, x1: number, y1: number) {
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  let x = x0;
  let y = y0;
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (x !== x1 || y !== y1) {
    if (isBlocked(g, x, y) && !(x === x0 && y === y0)) return false;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return !isBlocked(g, x1, y1);
}

function smooth(g: Grid, path: { x: number; y: number }[]) {
  if (path.length < 3) return path;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let best = i + 1;
    for (let j = path.length - 1; j > i + 1; j--) {
      if (hasLos(g, path[i].x, path[i].y, path[j].x, path[j].y)) {
        best = j;
        break;
      }
    }
    out.push(path[best]);
    i = best;
  }
  return out;
}
