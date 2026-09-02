import {
  AGES,
  BUILDINGS,
  BUILD_HOTKEYS,
  CARRY_MAX,
  GATHER_RATE,
  MISSIONS,
  NODE_AMOUNTS,
  NODE_RES,
  POP_CAP_MAX,
  TEAM_COLOR,
  TILE,
  UNITS,
  canAfford,
  civCostMul,
  pay,
  refund,
  scaleCost,
  unitBonuses,
  type CivId,
  type Cost,
  type Res,
} from "./catalog";
import { astar, nearestWalkable, type Grid } from "./pathfind";
import { generateMap, tileCenter, type MapKind } from "./mapgen";
import { audio } from "./audio";

export type GameConfig = {
  mode: "campaign" | "skirmish";
  mission: number;
  civ: CivId;
  enemyCiv: CivId;
  difficulty: 0 | 1 | 2;
  seed: number;
};

type Task =
  | { t: "move"; path: { x: number; y: number }[]; i: number }
  | { t: "gather"; nodeId: number; phase: "go" | "work" | "drop" }
  | { t: "build"; bldId: number }
  | { t: "attack"; targetId: number }
  | { t: "convert"; targetId: number; ch: number };

export type Ent = {
  id: number;
  kind: "unit" | "bld" | "node" | "animal" | "proj";
  type: string;
  team: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  facing: number;
  anim: number;
  task: Task | null;
  carryRes: Res | null;
  carryAmt: number;
  attackCd: number;
  tw: number;
  th: number;
  tx: number;
  ty: number;
  done: boolean;
  progress: number;
  queue: { type: string; left: number; cost: Cost }[];
  rallyX: number;
  rallyY: number;
  amount: number;
  vx: number;
  vy: number;
  ageLeft: number;
  nav: { gx: number; gy: number; path: { x: number; y: number }[]; i: number } | null;
};

export type HudAction = {
  id: string;
  label: string;
  cost?: Cost;
  disabled?: boolean;
  sprite?: string;
};

export type HudSnapshot = {
  food: number;
  wood: number;
  gold: number;
  stone: number;
  pop: number;
  popCap: number;
  age: number;
  ageName: string;
  ageLeft: number;
  selected: {
    id: number;
    kind: Ent["kind"];
    type: string;
    name: string;
    hp: number;
    maxHp: number;
    team: number;
    carryRes: Res | null;
    carryAmt: number;
    queue: Ent["queue"];
    progress: number;
    done: boolean;
  }[];
  actions: HudAction[];
  messages: { id: number; text: string }[];
  placing: string | null;
  paused: boolean;
  outcome: "playing" | "win" | "lose";
  objective: string;
  objectives: { text: string; done: boolean }[];
  idleVillagers: number;
  title: string;
  touchUi: boolean;
  hint: string;
};

export type Assets = {
  tiles: Record<string, HTMLImageElement | null>;
  sheets: Record<string, { img: HTMLImageElement; rows: number; cols: number } | null>;
  singles: Record<string, HTMLImageElement | null>;
  ui: Record<string, HTMLImageElement | null>;
};

type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string };

const STEP = 1 / 30;

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function loadAssets(): Promise<Assets> {
  const man = (await fetch("/game/manifest.json").then((r) => r.json())) as {
    tiles: Record<string, string>;
    sheets: Record<string, { src: string; rows: number; cols: number }>;
    singles: Record<string, string>;
    ui: Record<string, string>;
  };
  const tiles: Assets["tiles"] = {};
  const sheets: Assets["sheets"] = {};
  const singles: Assets["singles"] = {};
  const ui: Assets["ui"] = {};
  await Promise.all([
    ...Object.entries(man.tiles).map(async ([k, src]) => {
      tiles[k] = await loadImg(src);
    }),
    ...Object.entries(man.sheets).map(async ([k, s]) => {
      const img = await loadImg(s.src);
      sheets[k] = img ? { img, rows: s.rows, cols: s.cols } : null;
    }),
    ...Object.entries(man.singles).map(async ([k, src]) => {
      singles[k] = await loadImg(src);
    }),
    ...Object.entries(man.ui).map(async ([k, src]) => {
      ui[k] = await loadImg(src);
    }),
  ]);
  return { tiles, sheets, singles, ui };
}

function emptyStock(): Record<Res, number> {
  return { food: 200, wood: 200, gold: 0, stone: 0 };
}

export class Engine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  assets: Assets;
  cfg: GameConfig;
  onHud: (h: HudSnapshot) => void;
  running = false;
  paused = false;
  outcome: "playing" | "win" | "lose" = "playing";
  acc = 0;
  last = 0;
  raf = 0;
  idc = 1;
  w = 64;
  h = 64;
  tiles: Uint8Array = new Uint8Array(0);
  blocked: Uint8Array = new Uint8Array(0);
  explored: Uint8Array[] = [new Uint8Array(0), new Uint8Array(0)];
  visible: Uint8Array[] = [new Uint8Array(0), new Uint8Array(0)];
  ents: Ent[] = [];
  stock: [Record<Res, number>, Record<Res, number>] = [emptyStock(), emptyStock()];
  age = [0, 0];
  civ: [CivId, CivId] = ["aegean", "nile"];
  selected: number[] = [];
  placing: string | null = null;
  placeOk = false;
  mouse = { x: 200, y: 200, wx: 0, wy: 0, down: false, right: false, sx: 0, sy: 0, inside: false };
  lastClick = { id: 0, t: 0 };
  holdAt = 0;
  touchUi = false;
  orderMark: { x: number; y: number; t: number; text: string } | null = null;
  cam = { x: 0, y: 0, z: 0.85 };
  keys = new Set<string>();
  messages: { id: number; text: string; t: number }[] = [];
  mid = 1;
  particles: Particle[] = [];
  hudT = 0;
  aiT = 0;
  fogT = 0;
  winT = 0;
  atkAlert = 0;
  shake = 0;
  dpr = 1;
  viewW = 800;
  viewH = 600;
  pinch: { d: number; z: number } | null = null;
  pointers = new Map<number, { x: number; y: number }>();
  groups: Record<string, number[]> = {};
  objectives: { text: string; done: boolean }[] = [];
  objT = 0;
  gatherMul = [1, 1];
  trainedSoldiers = 0;
  destroyed = false;
  fogCanvas: HTMLCanvasElement | null = null;
  fogCtx: CanvasRenderingContext2D | null = null;
  tintBuf: HTMLCanvasElement | null = null;
  tintCtx: CanvasRenderingContext2D | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    assets: Assets,
    cfg: GameConfig,
    onHud: (h: HudSnapshot) => void,
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.assets = assets;
    this.cfg = cfg;
    this.onHud = onHud;
    this.civ = [cfg.civ, cfg.enemyCiv];
    this.gatherMul = [1, 1 + cfg.difficulty * 0.12];
    this.initWorld();
    this.bind();
    this.resize();
    this.centerOnTeam(0);
    this.revealAroundTeam(0);
    this.touchUi = this.isTouchPtr();
    this.pushMsg(this.touchUi ? "Tap a villager, then tap a tree or mine to gather." : "Villagers gather. Command the rest.");
  }

  grid(): Grid {
    return { w: this.w, h: this.h, blocked: this.blocked };
  }

  nextId() {
    return this.idc++;
  }

  initWorld() {
    const mission = MISSIONS[this.cfg.mission - 1] ?? MISSIONS[0];
    const kind: MapKind = this.cfg.mode === "campaign" ? mission.map : "duel";
    const map = generateMap(kind, this.cfg.seed);
    this.w = map.w;
    this.h = map.h;
    this.tiles = map.tiles;
    this.blocked = new Uint8Array(this.w * this.h);
    this.explored = [new Uint8Array(this.w * this.h), new Uint8Array(this.w * this.h)];
    this.visible = [new Uint8Array(this.w * this.h), new Uint8Array(this.w * this.h)];
    this.fogCanvas = document.createElement("canvas");
    this.fogCanvas.width = this.w;
    this.fogCanvas.height = this.h;
    this.fogCtx = this.fogCanvas.getContext("2d");
    this.objectives = (this.cfg.mode === "campaign" ? mission.objectives : ["Destroy the enemy Town Center"]).map(
      (text) => ({ text, done: false }),
    );

    for (const n of map.nodes) {
      this.spawnNode(n.type, n.tx, n.ty);
    }
    for (const a of map.animals) {
      const c = tileCenter(a.tx, a.ty);
      this.ents.push(this.mkEnt("animal", "gazelle", -1, c.x, c.y, 18));
    }

    const pExtra = this.cfg.difficulty === 2 && this.cfg.mode === "skirmish" ? 80 : 0;
    this.stock[0] = { food: 200, wood: 200, gold: 0, stone: 0 };
    this.stock[1] = { food: 200 + pExtra, wood: 200 + pExtra, gold: this.cfg.mission === 3 ? 80 : 0, stone: 0 };

    this.spawnTown(0, map.player.tx, map.player.ty, 3);
    if (this.cfg.mission === 3) this.age[1] = 1;
    this.spawnTown(1, map.enemy.tx, map.enemy.ty, this.cfg.mission === 1 ? 2 : 3);
    if (this.cfg.mission === 1) {
      const c = tileCenter(map.enemy.tx + 5, map.enemy.ty);
      this.spawnBld("barracks", 1, map.enemy.tx + 5, map.enemy.ty, true);
      for (let i = 0; i < 3; i++) {
        const u = this.spawnUnit("clubman", 1, c.x + 20 + i * 16, c.y + 30);
        u.task = { t: "move", path: [], i: 0 };
      }
    }
    if (this.cfg.mission === 3) {
      const c = tileCenter(map.enemy.tx, map.enemy.ty + 5);
      this.spawnBld("barracks", 1, map.enemy.tx + 5, map.enemy.ty + 1, true);
      this.spawnUnit("axeman", 1, c.x + 10, c.y);
      this.spawnUnit("axeman", 1, c.x + 30, c.y);
    }
    this.rebuildBlocked();
    this.updateFog();
    this.assignStartJobs(0);
    this.assignStartJobs(1);
    this.selected = this.ents.filter((e) => e.team === 0 && e.type === "villager").map((e) => e.id);
  }

  mkEnt(kind: Ent["kind"], type: string, team: number, x: number, y: number, hp: number): Ent {
    return {
      id: this.nextId(),
      kind,
      type,
      team,
      x,
      y,
      hp,
      maxHp: hp,
      facing: 0,
      anim: 0,
      task: null,
      carryRes: null,
      carryAmt: 0,
      attackCd: 0,
      tw: 1,
      th: 1,
      tx: Math.floor(x / TILE),
      ty: Math.floor(y / TILE),
      done: true,
      progress: 1,
      queue: [],
      rallyX: x,
      rallyY: y + TILE * 2,
      amount: 0,
      vx: 0,
      vy: 0,
      ageLeft: 0,
      nav: null,
    };
  }

  spawnNode(type: string, tx: number, ty: number) {
    const c = tileCenter(tx, ty);
    const e = this.mkEnt("node", type, -1, c.x, c.y, 1);
    e.tx = tx;
    e.ty = ty;
    e.amount = NODE_AMOUNTS[type] ?? 80;
    this.ents.push(e);
    return e;
  }

  spawnUnit(type: string, team: number, x: number, y: number) {
    const def = UNITS[type];
    const civ = this.civ[team as 0 | 1];
    const b = unitBonuses(civ, def);
    const e = this.mkEnt("unit", type, team, x, y, b.hp);
    this.ents.push(e);
    return e;
  }

  spawnBld(type: string, team: number, tx: number, ty: number, done: boolean) {
    const def = BUILDINGS[type];
    const e = this.mkEnt("bld", type, team, (tx + def.tw / 2) * TILE, (ty + def.th / 2) * TILE, def.hp);
    e.tw = def.tw;
    e.th = def.th;
    e.tx = tx;
    e.ty = ty;
    e.done = done;
    e.progress = done ? 1 : 0;
    e.hp = done ? def.hp : 8;
    e.rallyX = e.x;
    e.rallyY = e.y + def.th * TILE;
    this.ents.push(e);
    if (type === "farm" && done) {
      e.amount = NODE_AMOUNTS.farm * (this.civ[team as 0 | 1] === "nile" ? 1.4 : 1);
    }
    this.rebuildBlocked();
    return e;
  }

  spawnTown(team: number, tx: number, ty: number, villagers: number) {
    const b = this.spawnBld("town_center", team, tx, ty, true);
    const c = tileCenter(tx + 2, ty + 4);
    for (let i = 0; i < villagers; i++) {
      this.spawnUnit("villager", team, c.x - 20 + i * 18, c.y + 8);
    }
    return b;
  }

  assignStartJobs(team: number) {
    const vills = this.ents.filter((e) => e.kind === "unit" && e.team === team && e.type === "villager");
    vills.forEach((v, i) => {
      const node = this.nearestNode(v, i % 3 === 0 ? "tree" : "berry");
      if (node) v.task = { t: "gather", nodeId: node.id, phase: "go" };
    });
  }

  rebuildBlocked() {
    const g = this.blocked;
    g.fill(0);
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] === 2) g[i] = 1;
    for (const e of this.ents) {
      if (e.kind === "node" && e.type === "tree" && e.amount > 0) {
        g[e.ty * this.w + e.tx] = 1;
      } else if (e.kind === "bld" && e.hp > 0) {
        for (let y = e.ty; y < e.ty + e.th; y++) {
          for (let x = e.tx; x < e.tx + e.tw; x++) {
            if (x >= 0 && y >= 0 && x < this.w && y < this.h) g[y * this.w + x] = 1;
          }
        }
      }
    }
  }

  popCap(team: number) {
    let cap = 0;
    for (const e of this.ents) {
      if (e.kind === "bld" && e.team === team && e.done) cap += BUILDINGS[e.type]?.pop ?? 0;
    }
    return Math.min(POP_CAP_MAX, cap);
  }

  popUsed(team: number) {
    let n = 0;
    for (const e of this.ents) if (e.kind === "unit" && e.team === team) n++;
    return n;
  }

  byId(id: number) {
    return this.ents.find((e) => e.id === id);
  }

  pushMsg(text: string) {
    this.messages.unshift({ id: this.mid++, text, t: 8 });
    this.messages = this.messages.slice(0, 5);
  }

  bind() {
    const c = this.canvas;
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    this.canvas.addEventListener("pointerleave", () => {
      this.mouse.inside = false;
    });
    this.canvas.addEventListener("pointerenter", (ev) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = ev.clientX - rect.left;
      this.mouse.y = ev.clientY - rect.top;
      this.mouse.inside = true;
    });
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVis);
  }

  unbind() {
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    c.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVis);
  }

  onVis = () => {
    if (document.visibilityState === "visible") audio.resume();
  };

  resize = () => {
    const parent = this.canvas.parentElement ?? this.canvas;
    const r = parent.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.viewW = Math.max(320, r.width);
    this.viewH = Math.max(240, r.height);
    this.canvas.width = Math.floor(this.viewW * this.dpr);
    this.canvas.height = Math.floor(this.viewH * this.dpr);
    this.canvas.style.width = `${this.viewW}px`;
    this.canvas.style.height = `${this.viewH}px`;
  };

  screenToWorld(sx: number, sy: number) {
    const z = this.cam.z;
    return { x: sx / z + this.cam.x, y: sy / z + this.cam.y };
  }

  clampCam() {
    const visW = this.viewW / this.cam.z;
    const visH = this.viewH / this.cam.z;
    const worldW = this.w * TILE;
    const worldH = this.h * TILE;
    const maxX = Math.max(0, worldW - visW);
    const maxY = Math.max(0, worldH - visH);
    this.cam.x = Math.max(0, Math.min(maxX, this.cam.x));
    this.cam.y = Math.max(0, Math.min(maxY, this.cam.y));
  }

  centerOnTeam(team: number) {
    const tc = this.ents.find((e) => e.kind === "bld" && e.type === "town_center" && e.team === team);
    if (!tc) return;
    const vw = Math.max(this.viewW, 640);
    const vh = Math.max(this.viewH, 400);
    this.cam.x = tc.x - vw / 2 / this.cam.z;
    this.cam.y = tc.y - vh / 2 / this.cam.z;
    this.clampCam();
  }

  revealAroundTeam(team: number) {
    for (const e of this.ents) {
      if (e.team !== team) continue;
      const los = e.kind === "bld" ? (BUILDINGS[e.type]?.los ?? 4) : (UNITS[e.type]?.los ?? 4);
      this.paintLos(this.explored[team], e.x, e.y, los * TILE);
    }
  }

  start() {
    this.running = true;
    const focus = () => {
      this.resize();
      this.centerOnTeam(0);
    };
    focus();
    requestAnimationFrame(focus);
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (dt > 0.1) dt = 0.1;
      this.acc += dt;
      while (this.acc >= STEP) {
        if (!this.paused && this.outcome === "playing") this.step(STEP);
        this.acc -= STEP;
      }
      audio.tick(dt);
      this.render();
      this.hudT += dt;
      if (this.hudT > 0.12) {
        this.hudT = 0;
        this.onHud(this.snapshot());
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.onHud(this.snapshot());
    (window as unknown as { __doe?: Engine }).__doe = this;
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.unbind();
    this.destroyed = true;
  }

  step(dt: number) {
    this.panFromKeys(dt);
    this.edgePan(dt);
    this.atkAlert = Math.max(0, this.atkAlert - dt);
    this.shake = Math.max(0, this.shake - dt * 4);
    for (const m of this.messages) m.t -= dt;
    this.messages = this.messages.filter((m) => m.t > 0);

    for (const e of this.ents) {
      if (e.kind === "unit") this.stepUnit(e, dt);
      else if (e.kind === "bld") this.stepBld(e, dt);
      else if (e.kind === "animal") this.stepAnimal(e, dt);
      else if (e.kind === "proj") this.stepProj(e, dt);
    }
    this.separate(dt);
    this.ents = this.ents.filter((e) => e.hp > 0 && (e.kind !== "node" || e.amount > 0));

    this.aiT += dt;
    if (this.aiT >= 1.15) {
      this.aiT = 0;
      this.runAi();
    }
    this.fogT += dt;
    if (this.fogT >= 0.28) {
      this.fogT = 0;
      this.updateFog();
    }
    this.objT += dt;
    if (this.objT >= 0.6) {
      this.objT = 0;
      this.checkObjectives();
    }
    this.winT += dt;
    if (this.winT >= 1.2) {
      this.winT = 0;
      this.checkOutcome();
    }

    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.orderMark) {
      this.orderMark.t -= dt;
      if (this.orderMark.t <= 0) this.orderMark = null;
    }
  }

  panFromKeys(dt: number) {
    let dx = 0;
    let dy = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) dy -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) dy += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) dx -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) dx += 1;
    if (!dx && !dy) return;
    const sp = 460 / this.cam.z;
    this.cam.x += dx * sp * dt;
    this.cam.y += dy * sp * dt;
    this.clampCam();
  }

  edgePan(dt: number) {
    if (!this.mouse.inside || this.pointers.size) return;
    if (this.mouse.x < 1 && this.mouse.y < 1) return;
    const m = 16;
    let dx = 0;
    let dy = 0;
    if (this.mouse.x < m) dx = -1;
    if (this.mouse.x > this.viewW - m) dx = 1;
    if (this.mouse.y < m) dy = -1;
    if (this.mouse.y > this.viewH - m) dy = 1;
    if (!dx && !dy) return;
    const sp = 380 / this.cam.z;
    this.cam.x += dx * sp * dt;
    this.cam.y += dy * sp * dt;
    this.clampCam();
  }

  stepUnit(e: Ent, dt: number) {
    e.attackCd = Math.max(0, e.attackCd - dt);
    const def = UNITS[e.type];
    if (!def) return;
    if (!e.task) {
      if (def.role !== "villager") this.autoAcquire(e);
      return;
    }
    const t = e.task;
    if (t.t === "move") {
      if (!this.followPath(e, t, dt, def.speed * this.speedMul(e))) {
        e.task = null;
        e.vx = 0;
        e.vy = 0;
      }
      return;
    }
    if (t.t === "attack") {
      const tgt = this.byId(t.targetId);
      if (!tgt || tgt.hp <= 0 || tgt.team === e.team) {
        if (e.type === "villager") {
          const n = this.ents.find(
            (o) => o.kind === "node" && o.type === "gazelle" && o.amount > 0 && Math.hypot(o.x - e.x, o.y - e.y) < 90,
          );
          e.task = n ? { t: "gather", nodeId: n.id, phase: "go" } : null;
        } else e.task = null;
        return;
      }
      const range = def.range;
      if (!this.inRange(e, tgt, range)) {
        this.ensureMoveTo(e, tgt.x, tgt.y, dt, def.speed * this.speedMul(e));
      } else {
        e.vx = 0;
        e.vy = 0;
        this.faceToward(e, tgt.x, tgt.y);
        if (def.convert) {
          e.task = { t: "convert", targetId: tgt.id, ch: 0 };
          return;
        }
        this.tryStrike(e, tgt, def);
      }
      return;
    }
    if (t.t === "convert") {
      const tgt = this.byId(t.targetId);
      if (!tgt || tgt.hp <= 0 || tgt.kind !== "unit" || tgt.team === e.team) {
        e.task = null;
        return;
      }
      if (!this.inRange(e, tgt, def.range)) {
        this.ensureMoveTo(e, tgt.x, tgt.y, dt, def.speed);
        return;
      }
      e.vx = 0;
      e.vy = 0;
      t.ch += dt;
      if (t.ch >= 6.5) {
        tgt.team = e.team;
        tgt.task = null;
        this.pushMsg(e.team === 0 ? "A soul joins our cause." : "A warrior was converted!");
        audio.notify();
        e.task = null;
      }
      return;
    }
    if (t.t === "build") {
      const b = this.byId(t.bldId);
      if (!b || b.kind !== "bld" || b.done) {
        e.task = null;
        return;
      }
      if (!this.inRange(e, b, 24)) this.ensureMoveTo(e, b.x, b.y, dt, def.speed);
      else {
        e.vx = 0;
        e.vy = 0;
        b.progress += dt / (BUILDINGS[b.type].time * 0.55);
        b.hp = Math.min(b.maxHp, b.hp + (b.maxHp * dt) / (BUILDINGS[b.type].time * 0.55));
        if (b.progress >= 1) {
          b.done = true;
          b.progress = 1;
          b.hp = b.maxHp;
          if (b.type === "farm") {
            b.amount = NODE_AMOUNTS.farm * (this.civ[b.team as 0 | 1] === "nile" ? 1.4 : 1);
          }
          if (e.team === 0) this.pushMsg(`${BUILDINGS[b.type].name} completed.`);
          audio.place();
          e.task = b.type === "farm" ? { t: "gather", nodeId: b.id, phase: "work" } : null;
        }
      }
      return;
    }
    if (t.t === "gather") this.stepGather(e, t, dt, def.speed);
  }

  speedMul(e: Ent) {
    return unitBonuses(this.civ[e.team as 0 | 1], UNITS[e.type]).speed / UNITS[e.type].speed;
  }

  stepGather(e: Ent, t: Extract<Task, { t: "gather" }>, dt: number, speed: number) {
    const node = this.byId(t.nodeId);
    if (!node || (node.kind !== "node" && !(node.kind === "bld" && node.type === "farm")) || node.amount <= 0) {
      const next = this.nearestNode(e, node?.type ?? "berry");
      if (next) {
        t.nodeId = next.id;
        t.phase = "go";
      } else e.task = null;
      return;
    }
    const res = NODE_RES[node.type] ?? "food";
    if (t.phase === "drop" || e.carryAmt >= CARRY_MAX) {
      const drop = this.nearestDrop(e, res);
      if (!drop) {
        this.stock[e.team as 0 | 1][res] += e.carryAmt;
        e.carryAmt = 0;
        e.carryRes = null;
        t.phase = "go";
        return;
      }
      if (!this.inRange(e, drop, 24)) this.ensureMoveTo(e, drop.x, drop.y, dt, speed);
      else {
        this.stock[e.team as 0 | 1][res] += e.carryAmt;
        e.carryAmt = 0;
        e.carryRes = null;
        t.phase = "go";
      }
      return;
    }
    if (!this.inRange(e, node, 28)) {
      this.ensureMoveTo(e, node.x, node.y, dt, speed);
      return;
    }
    e.vx = 0;
    e.vy = 0;
    this.faceToward(e, node.x, node.y);
    const rate = (GATHER_RATE[node.type] ?? 0.7) * this.gatherMul[e.team as 0 | 1];
    const take = Math.min(node.amount, rate * dt);
    node.amount -= take;
    e.carryAmt += take;
    e.carryRes = res;
    e.anim += dt * 4;
    if (Math.random() < dt * 3) {
      if (res === "wood") audio.chop();
      else if (res === "gold" || res === "stone") audio.mine();
      this.burst(e.x, e.y - 8, res === "wood" ? "#6b4a2a" : res === "gold" ? "#d4b45a" : "#cfd3d8", 2);
    }
    if (node.amount <= 0 && node.type === "tree") this.rebuildBlocked();
    if (node.kind === "bld" && node.type === "farm" && node.amount <= 0) {
      const st = this.stock[e.team as 0 | 1];
      if (st.wood >= 60) {
        st.wood -= 60;
        node.amount = NODE_AMOUNTS.farm * (this.civ[e.team as 0 | 1] === "nile" ? 1.4 : 1);
      }
    }
    if (e.carryAmt >= CARRY_MAX) t.phase = "drop";
  }

  stepBld(e: Ent, dt: number) {
    if (!e.done) return;
    if (e.ageLeft > 0) {
      e.ageLeft -= dt;
      if (e.ageLeft <= 0) {
        this.age[e.team as 0 | 1] = Math.min(3, this.age[e.team as 0 | 1] + 1);
        e.ageLeft = 0;
        if (e.team === 0) {
          this.pushMsg(`Advanced to the ${AGES[this.age[0]].name}.`);
          audio.fanfare();
        }
      }
    }
    if (e.queue.length) {
      const q = e.queue[0];
      q.left -= dt;
      if (q.left <= 0) {
        if (this.popUsed(e.team) < this.popCap(e.team)) {
          const u = this.spawnUnit(q.type, e.team, e.rallyX, e.rallyY);
          const stand = nearestWalkable(this.grid(), Math.floor(e.rallyX / TILE), Math.floor(e.rallyY / TILE));
          if (stand) {
            const c = tileCenter(stand.x, stand.y);
            u.x = c.x;
            u.y = c.y;
          }
          if (e.team === 0 && UNITS[q.type]?.role !== "villager") this.trainedSoldiers++;
          audio.place();
        } else {
          refund(this.stock[e.team as 0 | 1], q.cost);
          if (e.team === 0) this.pushMsg("We need more houses.");
        }
        e.queue.shift();
      }
    }
    const def = BUILDINGS[e.type];
    if (def.attack && def.range) {
      e.attackCd = Math.max(0, e.attackCd - dt);
      if (e.attackCd <= 0) {
        const tgt = this.closestEnemy(e, def.range);
        if (tgt) {
          this.spawnProj(e, tgt, def.attack, def.range);
          e.attackCd = 1.15;
        }
      }
    }
  }

  stepAnimal(e: Ent, dt: number) {
    const threat = this.ents.find(
      (u) => u.kind === "unit" && u.type === "villager" && Math.hypot(u.x - e.x, u.y - e.y) < 90,
    );
    if (threat) {
      const a = Math.atan2(e.y - threat.y, e.x - threat.x);
      e.vx = Math.cos(a) * 70;
      e.vy = Math.sin(a) * 70;
    } else if (Math.random() < dt * 0.4) {
      e.vx = (Math.random() - 0.5) * 28;
      e.vy = (Math.random() - 0.5) * 28;
    }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.vx *= 0.96;
    e.vy *= 0.96;
    this.clampEnt(e);
    this.faceToward(e, e.x + e.vx, e.y + e.vy);
  }

  stepProj(e: Ent, dt: number) {
    const sp = 320;
    const d = Math.hypot(e.rallyX - e.x, e.rallyY - e.y);
    if (d < 8) {
      e.hp = 0;
      const splash = e.amount;
      for (const t of this.ents) {
        if (t.team === e.team || t.hp <= 0) continue;
        if (t.kind !== "unit" && t.kind !== "bld" && t.kind !== "animal") continue;
        if (Math.hypot(t.x - e.x, t.y - e.y) <= (splash || 18)) this.damage(t, e.progress, e.team);
      }
      this.burst(e.x, e.y, "#e8d9a0", 6);
      return;
    }
    e.x += (e.rallyX - e.x) / d * sp * dt;
    e.y += (e.rallyY - e.y) / d * sp * dt;
  }

  spawnProj(from: Ent, to: Ent, dmg: number, _range: number) {
    const p = this.mkEnt("proj", "arrow", from.team, from.x, from.y - 10, 1);
    p.rallyX = to.x;
    p.rallyY = to.y - 8;
    p.progress = dmg;
    p.amount = UNITS[from.type]?.splash ?? 0;
    this.ents.push(p);
  }

  tryStrike(e: Ent, tgt: Ent, def: (typeof UNITS)[string]) {
    if (e.attackCd > 0) return;
    e.attackCd = def.role === "siege" ? 2.2 : 1.05;
    const dmg = unitBonuses(this.civ[e.team as 0 | 1], def).attack;
    if (def.projectile) {
      this.spawnProj(e, tgt, dmg, def.range);
      return;
    }
    this.damage(tgt, dmg, e.team);
    audio.attack();
    this.burst(tgt.x, tgt.y - 12, "#c44732", 4);
  }

  damage(tgt: Ent, dmg: number, fromTeam: number) {
    tgt.hp -= dmg;
    if (tgt.team === 0 && fromTeam === 1 && this.atkAlert <= 0) {
      this.pushMsg("We are under attack!");
      audio.notify();
      this.atkAlert = 8;
      if (tgt.kind === "bld" && tgt.type === "town_center") this.shake = 0.45;
    }
    if (tgt.hp <= 0) {
      audio.die();
      if (tgt.kind === "bld") this.rebuildBlocked();
      if (tgt.kind === "animal") {
        const n = this.spawnNode("gazelle", Math.floor(tgt.x / TILE), Math.floor(tgt.y / TILE));
        n.x = tgt.x;
        n.y = tgt.y;
        n.amount = 50;
      }
      this.selected = this.selected.filter((id) => id !== tgt.id);
    }
  }

  autoAcquire(e: Ent) {
    const def = UNITS[e.type];
    const tgt = this.closestEnemy(e, def.los * TILE * 0.9);
    if (tgt) e.task = { t: "attack", targetId: tgt.id };
  }

  closestEnemy(e: Ent, range: number) {
    let best: Ent | null = null;
    let bd = range;
    for (const o of this.ents) {
      if (o.team === e.team || o.team < 0) continue;
      if (o.kind !== "unit" && o.kind !== "bld") continue;
      if (o.kind === "bld" && !o.done && o.hp <= 0) continue;
      const d = this.distToEnt(e, o);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  followPath(e: Ent, t: Extract<Task, { t: "move" }>, dt: number, speed: number) {
    if (!t.path.length) return false;
    if (t.i >= t.path.length) return false;
    const wp = t.path[t.i];
    const tx = (wp.x + 0.5) * TILE;
    const ty = (wp.y + 0.5) * TILE;
    const dx = tx - e.x;
    const dy = ty - e.y;
    const d = Math.hypot(dx, dy);
    if (d < 8) {
      t.i++;
      return t.i < t.path.length;
    }
    const sp = Math.min(speed, d / dt);
    e.vx = (dx / d) * sp;
    e.vy = (dy / d) * sp;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    this.faceToward(e, tx, ty);
    e.anim += dt * 8;
    return true;
  }

  ensureMoveTo(e: Ent, x: number, y: number, dt: number, speed: number) {
    const gx = Math.floor(x / TILE);
    const gy = Math.floor(y / TILE);
    if (!e.nav || e.nav.gx !== gx || e.nav.gy !== gy) {
      const path =
        astar(this.grid(), Math.floor(e.x / TILE), Math.floor(e.y / TILE), gx, gy) ?? [];
      e.nav = { gx, gy, path, i: 0 };
    }
    if (!e.nav.path.length) {
      const d = Math.hypot(x - e.x, y - e.y) || 1;
      e.x += ((x - e.x) / d) * speed * dt * 0.65;
      e.y += ((y - e.y) / d) * speed * dt * 0.65;
      this.faceToward(e, x, y);
      e.anim += dt * 8;
      return;
    }
    const mv: Extract<Task, { t: "move" }> = { t: "move", path: e.nav.path, i: e.nav.i };
    const cont = this.followPath(e, mv, dt, speed);
    e.nav.i = mv.i;
    if (!cont) e.nav = null;
  }

  issueMove(ids: number[], x: number, y: number) {
    ids.forEach((id, n) => {
      const e = this.byId(id);
      if (!e || e.kind !== "unit" || e.team !== 0) return;
      const ox = x + (n % 5) * 14 - 28;
      const oy = y + Math.floor(n / 5) * 14;
      const dest = nearestWalkable(this.grid(), Math.floor(ox / TILE), Math.floor(oy / TILE));
      const gx = dest?.x ?? Math.floor(ox / TILE);
      const gy = dest?.y ?? Math.floor(oy / TILE);
      const path = astar(this.grid(), Math.floor(e.x / TILE), Math.floor(e.y / TILE), gx, gy);
      e.task = { t: "move", path: path && path.length ? path : [{ x: gx, y: gy }], i: 0 };
      e.nav = null;
    });
  }

  issueCommand(x: number, y: number) {
    const hit = this.hitEnt(x, y, true, this.touchUi ? 16 : 0);
    const ids = this.selected.filter((id) => this.byId(id)?.kind === "unit" && this.byId(id)?.team === 0);
    if (!ids.length) {
      const b = this.selected.map((id) => this.byId(id)).find((e) => e?.kind === "bld" && e.team === 0);
      if (b) {
        b.rallyX = x;
        b.rallyY = y;
        this.markOrder(x, y, "Rally point set.");
      }
      return;
    }
    if (hit && hit.team === 1) {
      ids.forEach((id) => {
        const e = this.byId(id);
        if (e) e.task = { t: "attack", targetId: hit.id };
      });
      this.markOrder(hit.x, hit.y, "Attack!");
      return;
    }
    if (hit && (hit.kind === "node" || (hit.kind === "bld" && hit.type === "farm") || hit.kind === "animal")) {
      const res = hit.kind === "animal" ? "food" : (NODE_RES[hit.type] ?? "food");
      const verb =
        hit.kind === "animal" ? "Hunting." : res === "wood" ? "Chopping wood." : res === "food" ? "Gathering food." : res === "gold" ? "Mining gold." : "Mining stone.";
      ids.forEach((id) => {
        const e = this.byId(id);
        if (e?.type === "villager") {
          if (hit.kind === "animal") e.task = { t: "attack", targetId: hit.id };
          else e.task = { t: "gather", nodeId: hit.id, phase: "go" };
        } else if (e) e.task = { t: "attack", targetId: hit.id };
      });
      this.markOrder(hit.x, hit.y, verb);
      return;
    }
    if (hit && hit.kind === "bld" && !hit.done && hit.team === 0) {
      ids.forEach((id) => {
        const e = this.byId(id);
        if (e?.type === "villager") e.task = { t: "build", bldId: hit.id };
      });
      this.markOrder(hit.x, hit.y, `Building ${BUILDINGS[hit.type]?.name ?? "it"}.`);
      return;
    }
    this.issueMove(ids, x, y);
    this.markOrder(x, y, "On the move.");
  }

  markOrder(x: number, y: number, text: string) {
    this.orderMark = { x, y, t: 1.15, text };
    this.pushMsg(text);
    audio.click();
  }

  isTouchPtr(ev?: PointerEvent) {
    if (ev?.pointerType === "touch" || ev?.pointerType === "pen") {
      this.touchUi = true;
      return true;
    }
    if (typeof window !== "undefined") {
      try {
        if (window.matchMedia("(pointer: coarse)").matches) {
          this.touchUi = true;
          return true;
        }
      } catch {
        /* ignore */
      }
      if ((navigator.maxTouchPoints ?? 0) > 0 && window.matchMedia && !window.matchMedia("(hover: hover)").matches) {
        this.touchUi = true;
        return true;
      }
    }
    if (this.touchUi && ev?.pointerType === "mouse") return true;
    return false;
  }

  isOrderTarget(hit: Ent | undefined | null, emptyIsOrder: boolean) {
    const hasUnits = this.selected.some((id) => {
      const e = this.byId(id);
      return e?.kind === "unit" && e.team === 0;
    });
    if (!hasUnits) return false;
    if (!hit) return emptyIsOrder;
    if (hit.team === 1) return true;
    if (hit.kind === "node" || hit.kind === "animal") return true;
    if (hit.kind === "bld" && hit.type === "farm") return true;
    if (hit.kind === "bld" && !hit.done && hit.team === 0) return true;
    return false;
  }

  orderGather(type: string) {
    const vills = this.selected
      .map((id) => this.byId(id))
      .filter((e): e is Ent => !!e && e.type === "villager" && e.team === 0);
    const workers = vills.length ? vills : this.ents.filter((e) => e.type === "villager" && e.team === 0).slice(0, 3);
    if (!workers.length) {
      this.pushMsg("Select a villager first.");
      return;
    }
    let mark: Ent | null = null;
    for (const v of workers) {
      if (type === "gazelle") {
        let best: Ent | null = null;
        let bd = 1e9;
        for (const n of this.ents) {
          const ok =
            (n.kind === "animal" && n.hp > 0) || (n.kind === "node" && n.type === "gazelle" && n.amount > 0);
          if (!ok) continue;
          const d = Math.hypot(n.x - v.x, n.y - v.y);
          if (d < bd) {
            bd = d;
            best = n;
          }
        }
        if (best) {
          mark = best;
          v.task = best.kind === "animal" ? { t: "attack", targetId: best.id } : { t: "gather", nodeId: best.id, phase: "go" };
        }
        continue;
      }
      const node = this.nearestNode(v, type);
      if (node) {
        mark = node;
        v.task = { t: "gather", nodeId: node.id, phase: "go" };
      }
    }
    if (!mark) {
      this.pushMsg("None of that is in reach.");
      return;
    }
    const label =
      type === "tree"
        ? "Chopping wood."
        : type === "berry"
          ? "Gathering food."
          : type === "gold"
            ? "Mining gold."
            : type === "gazelle"
              ? "Hunting."
              : "Mining stone.";
    this.markOrder(mark.x, mark.y, label);
  }

  faceToward(e: Ent, x: number, y: number) {
    const dx = x - e.x;
    const dy = y - e.y;
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    if (Math.abs(dx) > Math.abs(dy)) e.facing = dx > 0 ? 2 : 1;
    else e.facing = dy > 0 ? 0 : 3;
  }

  clampEnt(e: Ent) {
    e.x = Math.max(16, Math.min(this.w * TILE - 16, e.x));
    e.y = Math.max(16, Math.min(this.h * TILE - 16, e.y));
  }

  separate(dt: number) {
    const units = this.ents.filter((e) => e.kind === "unit");
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i];
        const b = units[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = 18;
        if (d < min) {
          const p = ((min - d) / 2) * dt * 18;
          a.x -= (dx / d) * p;
          a.y -= (dy / d) * p;
          b.x += (dx / d) * p;
          b.y += (dy / d) * p;
        }
      }
    }
  }

  nearestNode(e: Ent, type: string) {
    let best: Ent | null = null;
    let bd = 1e9;
    for (const n of this.ents) {
      if (n.kind !== "node" && !(n.kind === "bld" && n.type === "farm")) continue;
      if (n.type !== type || n.amount <= 0) continue;
      const d = Math.hypot(n.x - e.x, n.y - e.y);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  nearestDrop(e: Ent, res: Res) {
    let best: Ent | null = null;
    let bd = 1e9;
    for (const b of this.ents) {
      if (b.kind !== "bld" || b.team !== e.team || !b.done) continue;
      const d = BUILDINGS[b.type]?.drop;
      if (!d) continue;
      if (d !== "all" && !d.includes(res)) continue;
      const dist = this.distToEnt(e, b);
      if (dist < bd) {
        bd = dist;
        best = b;
      }
    }
    return best;
  }

  distToEnt(a: Ent, b: Ent): number {
    if (b.kind === "bld") {
      const x0 = b.tx * TILE;
      const y0 = b.ty * TILE;
      const x1 = (b.tx + b.tw) * TILE;
      const y1 = (b.ty + b.th) * TILE;
      const cx = Math.max(x0, Math.min(x1, a.x));
      const cy = Math.max(y0, Math.min(y1, a.y));
      return Math.hypot(a.x - cx, a.y - cy);
    }
    if (a.kind === "bld") return this.distToEnt(b, a);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  inRange(a: Ent, b: Ent, range: number) {
    const slack = a.kind === "bld" || b.kind === "bld" ? 22 : 6;
    return this.distToEnt(a, b) <= range + slack;
  }

  canPlace(type: string, tx: number, ty: number, team = 0) {
    const def = BUILDINGS[type];
    if (!def) return false;
    if (this.age[team] < def.age) return false;
    for (let y = ty; y < ty + def.th; y++) {
      for (let x = tx; x < tx + def.tw; x++) {
        if (x < 1 || y < 1 || x >= this.w - 1 || y >= this.h - 1) return false;
        if (this.tiles[y * this.w + x] === 2) return false;
        if (this.blocked[y * this.w + x]) return false;
      }
    }
    return true;
  }

  tryPlace(type: string, wx: number, wy: number) {
    const def = BUILDINGS[type];
    const tx = Math.floor(wx / TILE - def.tw / 2);
    const ty = Math.floor(wy / TILE - def.th / 2);
    this.placeOk = this.canPlace(type, tx, ty);
    return { tx, ty, ok: this.placeOk, def };
  }

  confirmPlace(wx: number, wy: number) {
    if (!this.placing) return;
    const type = this.placing;
    const mul = civCostMul(this.civ[0], "build");
    const cost = scaleCost(BUILDINGS[type].cost, mul);
    if (!canAfford(this.stock[0], cost)) {
      this.pushMsg("Not enough resources.");
      return;
    }
    const { tx, ty, ok } = this.tryPlace(type, wx, wy);
    if (!ok) {
      this.pushMsg("Cannot build here.");
      return;
    }
    pay(this.stock[0], cost);
    const b = this.spawnBld(type, 0, tx, ty, false);
    const vills = this.selected.map((id) => this.byId(id)).filter((e) => e?.type === "villager" && e.team === 0);
    const workers = vills.length ? vills : [this.ents.find((e) => e.type === "villager" && e.team === 0 && !e.task)];
    workers.forEach((v) => {
      if (v) v.task = { t: "build", bldId: b.id };
    });
    audio.place();
    if (type !== "wall") this.placing = null;
  }

  paintLos(buf: Uint8Array, x: number, y: number, r: number) {
    const tr = Math.ceil(r / TILE);
    const cx = Math.floor(x / TILE);
    const cy = Math.floor(y / TILE);
    const rr = tr * tr;
    for (let iy = cy - tr; iy <= cy + tr; iy++) {
      for (let ix = cx - tr; ix <= cx + tr; ix++) {
        if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) continue;
        const dx = ix - cx;
        const dy = iy - cy;
        if (dx * dx + dy * dy <= rr) buf[iy * this.w + ix] = 1;
      }
    }
  }

  updateFog() {
    this.visible[0].fill(0);
    this.visible[1].fill(0);
    for (const e of this.ents) {
      if (e.team < 0) continue;
      const los = e.kind === "bld" ? (e.done ? BUILDINGS[e.type]?.los ?? 3 : 2) : (UNITS[e.type]?.los ?? 4);
      const r = los * TILE * (e.team === 1 && e.type === "tower" && this.civ[1] === "rivers" ? 1.15 : 1);
      const extra = e.team === 0 && e.type === "tower" && this.civ[0] === "rivers" ? 1.15 : 1;
      this.paintLos(this.visible[e.team as 0 | 1], e.x, e.y, r * extra);
      this.paintLos(this.explored[e.team as 0 | 1], e.x, e.y, r * extra);
    }
    if (this.fogCtx && this.fogCanvas) {
      const img = this.fogCtx.createImageData(this.w, this.h);
      const vis = this.visible[0];
      const exp = this.explored[0];
      for (let i = 0; i < vis.length; i++) {
        const o = i * 4;
        if (!exp[i]) {
          img.data[o + 3] = 255;
        } else if (!vis[i]) {
          img.data[o + 3] = 140;
        } else img.data[o + 3] = 0;
      }
      this.fogCtx.putImageData(img, 0, 0);
    }
  }

  seenByPlayer(e: Ent) {
    const tx = Math.max(0, Math.min(this.w - 1, Math.floor(e.x / TILE)));
    const ty = Math.max(0, Math.min(this.h - 1, Math.floor(e.y / TILE)));
    if (e.kind === "bld") return !!this.explored[0][ty * this.w + tx];
    return !!this.visible[0][ty * this.w + tx];
  }

  checkObjectives() {
    if (this.cfg.mode !== "campaign") return;
    const foodOk = this.stock[0].food >= 150;
    const hasHouse = this.ents.some((e) => e.kind === "bld" && e.team === 0 && e.type === "house" && e.done);
    const hasBar = this.ents.some((e) => e.kind === "bld" && e.team === 0 && e.type === "barracks" && e.done);
    const soldiers = this.ents.filter((e) => e.kind === "unit" && e.team === 0 && e.type !== "villager").length;
    const enemyBlds = this.ents.filter((e) => e.kind === "bld" && e.team === 1).length;
    const enemyTc = this.ents.some((e) => e.kind === "bld" && e.team === 1 && e.type === "town_center" && e.done);
    if (this.cfg.mission === 1) {
      this.objectives[0].done = foodOk;
      this.objectives[1].done = hasHouse;
      this.objectives[2].done = hasBar;
      this.objectives[3].done = soldiers >= 4;
      this.objectives[4].done = enemyBlds === 0;
    } else if (this.cfg.mission === 2) {
      this.objectives[0].done = this.age[0] >= 1;
      this.objectives[1].done = !enemyTc;
    } else {
      this.objectives[0].done = this.age[0] >= 2;
      this.objectives[1].done = !enemyTc;
    }
  }

  checkOutcome() {
    if (this.outcome !== "playing") return;
    const pTc = this.ents.some((e) => e.kind === "bld" && e.team === 0 && e.type === "town_center" && e.done);
    const eTc = this.ents.some((e) => e.kind === "bld" && e.team === 1 && e.type === "town_center" && e.done);
    const eBld = this.ents.some((e) => e.kind === "bld" && e.team === 1);
    if (!pTc) {
      this.outcome = "lose";
      audio.defeat();
      this.pushMsg("Your town has fallen.");
      return;
    }
    if (this.cfg.mode === "campaign" && this.cfg.mission === 1) {
      if (!eBld) {
        this.outcome = "win";
        audio.fanfare();
        this.pushMsg("The raiders are driven out.");
        this.saveProgress(1);
      }
      return;
    }
    if (!eTc) {
      this.outcome = "win";
      audio.fanfare();
      this.pushMsg("The rival town is ours.");
      if (this.cfg.mode === "campaign") this.saveProgress(this.cfg.mission);
    }
  }

  saveProgress(mission: number) {
    try {
      const raw = localStorage.getItem("dawn-empires-v1");
      const data = raw ? (JSON.parse(raw) as { version: number; campaign: number }) : { version: 1, campaign: 0 };
      data.version = 1;
      data.campaign = Math.max(data.campaign ?? 0, mission);
      localStorage.setItem("dawn-empires-v1", JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  runAi() {
    const team = 1;
    const stock = this.stock[1];
    const vills = this.ents.filter((e) => e.kind === "unit" && e.team === team && e.type === "villager");
    const blds = this.ents.filter((e) => e.kind === "bld" && e.team === team);
    const tc = blds.find((b) => b.type === "town_center" && b.done);
    if (!tc) return;
    const idle = vills.filter((v) => !v.task);
    const need: { type: string; n: number }[] = [];
    if (stock.food < 380) need.push({ type: "berry", n: 3 });
    if (stock.wood < 260) need.push({ type: "tree", n: 3 });
    if (this.age[1] >= 1 && stock.gold < 160) need.push({ type: "gold", n: 2 });
    if (stock.stone < 80) need.push({ type: "stone", n: 1 });
    if (!need.length) need.push({ type: "berry", n: 2 });
    let i = 0;
    for (const n of need) {
      for (let k = 0; k < n.n && i < idle.length; k++, i++) {
        const node = this.nearestNode(idle[i], n.type);
        if (node) idle[i].task = { t: "gather", nodeId: node.id, phase: "go" };
      }
    }
    const pop = this.popUsed(team);
    const cap = this.popCap(team);
    if (cap - pop <= 2 && stock.wood >= 30 && !blds.some((b) => b.type === "house" && !b.done)) {
      this.aiBuild("house", tc);
    }
    if (!blds.some((b) => b.type === "barracks") && stock.wood >= 125) this.aiBuild("barracks", tc);
    if (this.age[1] >= 1 && !blds.some((b) => b.type === "archery") && stock.wood >= 125) this.aiBuild("archery", tc);
    if (this.age[1] >= 1 && !blds.some((b) => b.type === "granary") && stock.wood >= 120) this.aiBuild("granary", tc);

    const barracks = blds.find((b) => b.type === "barracks" && b.done);
    const archery = blds.find((b) => b.type === "archery" && b.done);
    const trainType = this.age[1] >= 2 ? "swordsman" : this.age[1] >= 1 ? "axeman" : "clubman";
    if (barracks && barracks.queue.length < 2 && canAfford(stock, UNITS[trainType].cost) && pop < cap) {
      pay(stock, UNITS[trainType].cost);
      barracks.queue.push({ type: trainType, left: UNITS[trainType].time, cost: UNITS[trainType].cost });
    }
    if (archery && this.age[1] >= 1 && archery.queue.length < 1 && canAfford(stock, UNITS.bowman.cost) && pop < cap) {
      pay(stock, UNITS.bowman.cost);
      archery.queue.push({ type: "bowman", left: UNITS.bowman.time, cost: UNITS.bowman.cost });
    }
    if (tc.queue.length < 1 && vills.length < 10 && canAfford(stock, UNITS.villager.cost) && pop < cap) {
      pay(stock, UNITS.villager.cost);
      tc.queue.push({ type: "villager", left: UNITS.villager.time, cost: UNITS.villager.cost });
    }

    const ageDef = AGES[this.age[1]];
    if (ageDef.next && tc.ageLeft <= 0 && canAfford(stock, scaleCost(ageDef.next, civCostMul(this.civ[1], "age")))) {
      if (!(this.cfg.mission === 1 && this.trainedSoldiers < 2 && this.cfg.mode === "campaign")) {
        pay(stock, scaleCost(ageDef.next, civCostMul(this.civ[1], "age")));
        tc.ageLeft = ageDef.time;
      }
    }

    const army = this.ents.filter((e) => e.kind === "unit" && e.team === team && e.type !== "villager");
    const threshold = this.cfg.difficulty === 0 ? 8 : this.cfg.difficulty === 1 ? 6 : 4;
    const pTc = this.ents.find((e) => e.kind === "bld" && e.team === 0 && e.type === "town_center");
    const under = this.ents.some(
      (e) => e.team === 1 && e.kind === "bld" && this.closestEnemy(e, 160) && this.closestEnemy(e, 160)?.team === 0,
    );
    if (under) {
      army.forEach((u) => {
        const t = this.closestEnemy(u, 400);
        if (t) u.task = { t: "attack", targetId: t.id };
      });
    } else if (army.length >= threshold && pTc) {
      army.forEach((u) => {
        if (!u.task || u.task.t === "move") u.task = { t: "attack", targetId: pTc.id };
      });
    }
  }

  aiBuild(type: string, near: Ent) {
    const def = BUILDINGS[type];
    const mul = civCostMul(this.civ[1], "build");
    const cost = scaleCost(def.cost, mul);
    if (!canAfford(this.stock[1], cost)) return;
    for (let k = 0; k < 24; k++) {
      const tx = near.tx + ((k * 3) % 11) - 4;
      const ty = near.ty + 4 + ((k * 2) % 8);
      if (!this.canPlace(type, tx, ty, 1)) continue;
      pay(this.stock[1], cost);
      const b = this.spawnBld(type, 1, tx, ty, false);
      const v = this.ents.find((e) => e.team === 1 && e.type === "villager");
      if (v) v.task = { t: "build", bldId: b.id };
      return;
    }
  }

  burst(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 40,
        vy: -20 - Math.random() * 30,
        life: 0.35 + Math.random() * 0.25,
        color,
      });
    }
  }

  hitEnt(wx: number, wy: number, visCheck: boolean, pad = 0) {
    let best: Ent | null = null;
    let bd = 28 + pad;
    for (const e of this.ents) {
      if (e.kind === "proj") continue;
      if (visCheck && e.team !== 0 && !this.seenByPlayer(e)) continue;
      if (e.kind === "bld") {
        const extra = 8 + pad;
        const x0 = e.tx * TILE - extra;
        const y0 = e.ty * TILE - extra;
        const x1 = (e.tx + e.tw) * TILE + extra;
        const y1 = (e.ty + e.th) * TILE + extra;
        if (wx >= x0 && wx <= x1 && wy >= y0 && wy <= y1) {
          return e;
        }
        continue;
      }
      const hotY = e.kind === "node" && e.type === "tree" ? e.y - 24 : e.y;
      const r =
        e.kind === "node" ? (e.type === "tree" ? 38 : 32) + pad : 20 + pad;
      const d = Math.hypot(e.x - wx, hotY - wy);
      if (d < r && d < bd + 8) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  boxSelect(x0: number, y0: number, x1: number, y1: number) {
    const minx = Math.min(x0, x1);
    const maxx = Math.max(x0, x1);
    const miny = Math.min(y0, y1);
    const maxy = Math.max(y0, y1);
    const ids: number[] = [];
    for (const e of this.ents) {
      if (e.kind !== "unit" || e.team !== 0) continue;
      if (e.x >= minx && e.x <= maxx && e.y >= miny && e.y <= maxy) ids.push(e.id);
    }
    if (ids.length) this.selected = ids;
  }

  onDown = (ev: PointerEvent) => {
    audio.unlock();
    const touch = this.isTouchPtr(ev);
    if (touch) ev.preventDefault();
    this.canvas.setPointerCapture(ev.pointerId);
    const rect = this.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    this.pointers.set(ev.pointerId, { x, y });
    this.holdAt = performance.now();
    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), z: this.cam.z };
      this.holdAt = 0;
      return;
    }
    const w = this.screenToWorld(x, y);
    this.mouse.x = x;
    this.mouse.y = y;
    this.mouse.inside = true;
    this.mouse.wx = w.x;
    this.mouse.wy = w.y;
    this.mouse.sx = w.x;
    this.mouse.sy = w.y;
    this.mouse.down = ev.button === 0;
    this.mouse.right = ev.button === 2 || ev.ctrlKey;
    if (ev.button === 2) {
      ev.preventDefault();
      if (this.placing) {
        this.placing = null;
        return;
      }
      this.issueCommand(w.x, w.y);
    }
  };

  onMove = (ev: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    if (this.pointers.has(ev.pointerId)) this.pointers.set(ev.pointerId, { x, y });
    if (this.pointers.size === 2 && this.pinch) {
      const pts = [...this.pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.cam.z = Math.max(0.45, Math.min(1.7, (this.pinch.z * d) / this.pinch.d));
      this.clampCam();
      return;
    }
    const touch = this.isTouchPtr(ev);
    if (touch && this.mouse.down && this.pointers.size === 1 && !this.placing) {
      const dx = x - this.mouse.x;
      const dy = y - this.mouse.y;
      if (Math.hypot(dx, dy) > 2) {
        this.cam.x -= dx / this.cam.z;
        this.cam.y -= dy / this.cam.z;
        this.clampCam();
        this.holdAt = 0;
      }
    }
    const w = this.screenToWorld(x, y);
    this.mouse.x = x;
    this.mouse.y = y;
    this.mouse.inside = true;
    this.mouse.wx = w.x;
    this.mouse.wy = w.y;
  };

  onUp = (ev: PointerEvent) => {
    this.pointers.delete(ev.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const rect = this.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const w = this.screenToWorld(x, y);
    if (this.mouse.right) {
      this.mouse.down = false;
      this.mouse.right = false;
      return;
    }
    if (!this.mouse.down) return;
    this.mouse.down = false;
    if (this.placing) {
      this.confirmPlace(w.x, w.y);
      return;
    }
    const dx = w.x - this.mouse.sx;
    const dy = w.y - this.mouse.sy;
    const touch = this.isTouchPtr(ev);
    const moved = Math.hypot(dx, dy);
    const held = this.holdAt > 0 && performance.now() - this.holdAt > 400;
    this.holdAt = 0;
    if (moved > 18 && !touch) {
      this.boxSelect(this.mouse.sx, this.mouse.sy, w.x, w.y);
      return;
    }
    if (touch && moved > 16) return;
    const hit = this.hitEnt(w.x, w.y, true, touch ? 18 : 0);
    const now = performance.now();
    const dbl = !!(hit && hit.id === this.lastClick.id && now - this.lastClick.t < 360);
    this.lastClick = { id: hit?.id ?? 0, t: now };
    if (dbl && hit && hit.team === 0) {
      if (hit.kind === "bld" && hit.type === "town_center") {
        this.selected = this.ents.filter((e) => e.team === 0 && e.type === "villager").map((e) => e.id);
      } else if (hit.kind === "unit") {
        this.selected = this.ents.filter((e) => e.team === 0 && e.kind === "unit" && e.type === hit.type).map((e) => e.id);
      } else this.selected = [hit.id];
      audio.click();
      return;
    }
    if (this.isOrderTarget(hit, touch || held)) {
      this.issueCommand(w.x, w.y);
      return;
    }
    if (hit && (hit.team === 0 || (!this.selected.length && (hit.kind === "node" || hit.kind === "animal")))) {
      if (ev.shiftKey) {
        if (!this.selected.includes(hit.id)) this.selected.push(hit.id);
      } else this.selected = [hit.id];
      audio.click();
    } else if (!ev.shiftKey && !touch) this.selected = [];
  };

  onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const old = this.cam.z;
    this.cam.z = Math.max(0.45, Math.min(1.7, this.cam.z * (ev.deltaY > 0 ? 0.92 : 1.08)));
    const w = this.screenToWorld(this.mouse.x, this.mouse.y);
    this.cam.x = w.x - this.mouse.x / this.cam.z;
    this.cam.y = w.y - this.mouse.y / this.cam.z;
    if (this.cam.z === old) return;
    this.clampCam();
  };

  onKey = (ev: KeyboardEvent) => {
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
    if (ev.repeat && ev.code === "Space") return;
    this.keys.add(ev.code);
    audio.unlock();
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(ev.code)) ev.preventDefault();
    if (ev.code === "Space") {
      this.paused = !this.paused;
    }
    if (ev.code === "Escape") {
      if (this.placing) this.placing = null;
      else this.selected = [];
    }
    if (ev.code === "Period") this.selectIdleVillager();
    if (ev.code === "Delete" || ev.code === "Backspace") this.deleteSelected();
    if (ev.code === "Home") this.centerOnTeam(0);
    if (ev.code === "KeyC") {
      const e = this.byId(this.selected[0]);
      if (e) {
        this.cam.x = e.x - this.viewW / 2 / this.cam.z;
        this.cam.y = e.y - this.viewH / 2 / this.cam.z;
        this.clampCam();
      } else this.centerOnTeam(0);
    }
    if (ev.code.startsWith("Digit")) {
      const n = ev.code.slice(5);
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        this.groups[n] = [...this.selected];
        this.pushMsg(`Control group ${n} set.`);
      } else if (this.groups[n]?.length) {
        this.selected = this.groups[n].filter((id) => this.byId(id)?.hp);
      }
    }
    const villagerOn = this.selected.some((id) => this.byId(id)?.type === "villager");
    if (villagerOn && BUILD_HOTKEYS[ev.code] && !ev.ctrlKey && !ev.metaKey) {
      this.placing = BUILD_HOTKEYS[ev.code];
      ev.preventDefault();
    }
    if (ev.code === "KeyG" && ev.ctrlKey) {
      ev.preventDefault();
      this.selected = this.ents.filter((e) => e.kind === "unit" && e.team === 0).map((e) => e.id);
    }
  };

  onKeyUp = (ev: KeyboardEvent) => {
    this.keys.delete(ev.code);
  };

  selectIdleVillager() {
    const v = this.ents.find((e) => e.type === "villager" && e.team === 0 && !e.task);
    if (!v) {
      this.pushMsg("All villagers are working.");
      return;
    }
    this.selected = [v.id];
    this.cam.x = v.x - this.viewW / 2 / this.cam.z;
    this.cam.y = v.y - this.viewH / 2 / this.cam.z;
    this.clampCam();
  }

  deleteSelected() {
    for (const id of [...this.selected]) {
      const e = this.byId(id);
      if (e?.kind === "bld" && e.team === 0) {
        if (!e.done) refund(this.stock[0], scaleCost(BUILDINGS[e.type].cost, civCostMul(this.civ[0], "build")));
        e.hp = 0;
        this.rebuildBlocked();
      }
    }
    this.selected = this.selected.filter((id) => this.byId(id)?.hp);
  }

  doAction(id: string) {
    audio.unlock();
    audio.click();
    if (id === "stop") {
      this.selected.forEach((sid) => {
        const e = this.byId(sid);
        if (e) e.task = null;
      });
      return;
    }
    if (id === "idle") {
      this.selectIdleVillager();
      return;
    }
    if (id === "allvills") {
      this.selected = this.ents.filter((e) => e.team === 0 && e.type === "villager").map((e) => e.id);
      if (this.selected.length) this.pushMsg(`${this.selected.length} villagers.`);
      return;
    }
    if (id === "cancel") {
      this.placing = null;
      return;
    }
    if (id.startsWith("gather:")) {
      this.orderGather(id.slice(7));
      return;
    }
    if (id === "delete") {
      this.deleteSelected();
      return;
    }
    if (id.startsWith("build:")) {
      this.placing = id.slice(6);
      return;
    }
    if (id.startsWith("train:")) {
      this.queueTrain(id.slice(6));
      return;
    }
    if (id === "age") {
      this.startAge();
      return;
    }
    if (id === "trade:wood" || id === "trade:food") {
      const res: Res = id === "trade:wood" ? "wood" : "food";
      if (this.stock[0][res] >= 100) {
        this.stock[0][res] -= 100;
        this.stock[0].gold += 80;
        this.pushMsg(`Traded 100 ${res} for 80 gold.`);
      } else this.pushMsg("Need 100 to trade.");
    }
  }

  queueTrain(type: string) {
    const def = UNITS[type];
    if (!def) return;
    const b = this.selected.map((id) => this.byId(id)).find((e) => e?.kind === "bld" && e.team === 0 && e.done && e.type === def.building);
    if (!b) return;
    if (this.age[0] < def.age) {
      this.pushMsg("Advance in age first.");
      return;
    }
    let cost = { ...def.cost };
    if (type === "priest") cost = scaleCost(cost, civCostMul(this.civ[0], "priest"));
    if (!canAfford(this.stock[0], cost)) {
      this.pushMsg("Not enough resources.");
      return;
    }
    if (this.popUsed(0) + b.queue.length >= this.popCap(0)) {
      this.pushMsg("We need more houses.");
      return;
    }
    pay(this.stock[0], cost);
    b.queue.push({ type, left: def.time, cost });
  }

  startAge() {
    const tc = this.selected.map((id) => this.byId(id)).find((e) => e?.type === "town_center" && e.team === 0 && e.done);
    if (!tc) return;
    const age = AGES[this.age[0]];
    if (!age.next) {
      this.pushMsg("Already at the Iron Age.");
      return;
    }
    if (tc.ageLeft > 0) return;
    const cost = scaleCost(age.next, civCostMul(this.civ[0], "age"));
    if (!canAfford(this.stock[0], cost)) {
      this.pushMsg("Not enough resources to advance.");
      return;
    }
    pay(this.stock[0], cost);
    tc.ageLeft = age.time;
    this.pushMsg(`Researching the ${AGES[this.age[0] + 1].name}…`);
  }

  snapshot(): HudSnapshot {
    const selected = this.selected
      .map((id) => this.byId(id))
      .filter((e): e is Ent => !!e)
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        type: e.type,
        name: e.kind === "bld" ? BUILDINGS[e.type]?.name ?? e.type : UNITS[e.type]?.name ?? e.type,
        hp: Math.max(0, e.hp),
        maxHp: e.maxHp,
        team: e.team,
        carryRes: e.carryRes,
        carryAmt: Math.floor(e.carryAmt),
        queue: e.queue,
        progress: e.kind === "bld" ? (e.ageLeft > 0 ? 1 - e.ageLeft / (AGES[this.age[0]]?.time || 1) : e.progress) : 0,
        done: e.done,
      }));
    const idleVillagers = this.ents.filter((e) => e.type === "villager" && e.team === 0 && !e.task).length;
    return {
      food: Math.floor(this.stock[0].food),
      wood: Math.floor(this.stock[0].wood),
      gold: Math.floor(this.stock[0].gold),
      stone: Math.floor(this.stock[0].stone),
      pop: this.popUsed(0),
      popCap: this.popCap(0),
      age: this.age[0],
      ageName: AGES[this.age[0]].name,
      ageLeft: this.ents.find((e) => e.team === 0 && e.type === "town_center")?.ageLeft ?? 0,
      selected,
      actions: this.actionsFor(selected),
      messages: this.messages.map(({ id, text }) => ({ id, text })),
      placing: this.placing,
      paused: this.paused,
      outcome: this.outcome,
      objective: this.objectives.filter((o) => !o.done)[0]?.text ?? "Hold the field.",
      objectives: this.objectives,
      idleVillagers,
      title: this.cfg.mode === "campaign" ? (MISSIONS[this.cfg.mission - 1]?.title ?? "Campaign") : "Random Map",
      touchUi: this.touchUi,
      hint: this.commandHint(),
    };
  }

  commandHint() {
    if (this.placing) return "Tap the field to place the building. Use Cancel if you change your mind.";
    const units = this.selected.map((id) => this.byId(id)).filter((e) => e?.kind === "unit" && e.team === 0);
    const vills = units.filter((e) => e?.type === "villager");
    const blds = this.selected.map((id) => this.byId(id)).filter((e) => e?.kind === "bld" && e.team === 0);
    if (vills.length) return "Tap a tree, berry bush, gold, or stone to gather. Tap the ground to move. Or use Forage / Chop / Mine.";
    if (units.length) return "Tap an enemy to attack, or tap the ground to march.";
    if (blds.length) return "Train below, or tap the field to set a rally point.";
    return this.touchUi
      ? "Tap a villager to select, then tap a tree, berry bush, or mine."
      : "Select villagers to gather and build. Right-click or tap a resource to command.";
  }

  actionsFor(sel: HudSnapshot["selected"]): HudAction[] {
    const acts: HudAction[] = [];
    const units = sel.filter((s) => s.kind === "unit" && s.team === 0);
    const blds = sel.filter((s) => s.kind === "bld" && s.team === 0);
    const vills = units.filter((s) => s.type === "villager");
    if (this.placing) acts.push({ id: "cancel", label: "Cancel place" });
    if (vills.length) {
      acts.push(
        { id: "gather:berry", label: "Forage" },
        { id: "gather:tree", label: "Chop wood" },
        { id: "gather:gold", label: "Mine gold" },
        { id: "gather:stone", label: "Mine stone" },
        { id: "gather:gazelle", label: "Hunt" },
      );
    }
    acts.push({ id: "allvills", label: "All villagers" });
    if (vills.length) {
      const list = ["house", "barracks", "granary", "storage_pit", "farm", "archery", "stable", "tower", "temple", "market", "wall"];
      if (this.age[0] >= 1) list.splice(4, 0, "town_center");
      for (const id of list) {
        const d = BUILDINGS[id];
        if (this.age[0] < d.age && id !== "town_center") continue;
        acts.push({
          id: `build:${id}`,
          label: d.name,
          cost: scaleCost(d.cost, civCostMul(this.civ[0], "build")),
          disabled: !canAfford(this.stock[0], scaleCost(d.cost, civCostMul(this.civ[0], "build"))),
          sprite: id,
        });
      }
    }
    for (const b of blds) {
      const def = BUILDINGS[b.type];
      if (!def?.trains || !b.done) continue;
      for (const u of def.trains) {
        const ud = UNITS[u];
        if (this.age[0] < ud.age) continue;
        let cost = { ...ud.cost };
        if (u === "priest") cost = scaleCost(cost, civCostMul(this.civ[0], "priest"));
        acts.push({
          id: `train:${u}`,
          label: ud.name,
          cost,
          disabled: !canAfford(this.stock[0], cost),
          sprite: u,
        });
      }
      if (b.type === "town_center" && AGES[this.age[0]].next) {
        const cost = scaleCost(AGES[this.age[0]].next!, civCostMul(this.civ[0], "age"));
        acts.push({
          id: "age",
          label: `Advance to ${AGES[this.age[0] + 1].name}`,
          cost,
          disabled: !canAfford(this.stock[0], cost) || b.progress > 0 && (this.ents.find((e) => e.id === b.id)?.ageLeft ?? 0) > 0,
        });
      }
      if (b.type === "market") {
        acts.push({ id: "trade:wood", label: "100 wood → 80 gold", disabled: this.stock[0].wood < 100 });
        acts.push({ id: "trade:food", label: "100 food → 80 gold", disabled: this.stock[0].food < 100 });
      }
    }
    if (units.length || blds.length) acts.push({ id: "stop", label: "Stop" });
    if (blds.length) acts.push({ id: "delete", label: "Cancel / Raze" });
    if (vills.length || !sel.length) acts.push({ id: "idle", label: "Idle villager" });
    return acts;
  }

  render() {
    const ctx = this.ctx;
    const z = this.cam.z;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0e0b08";
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    if (this.shake) {
      ctx.save();
      ctx.translate((Math.random() - 0.5) * 8 * this.shake, (Math.random() - 0.5) * 8 * this.shake);
    }

    const x0 = Math.max(0, Math.floor(this.cam.x / TILE) - 1);
    const y0 = Math.max(0, Math.floor(this.cam.y / TILE) - 1);
    const x1 = Math.min(this.w, Math.ceil((this.cam.x + this.viewW / z) / TILE) + 1);
    const y1 = Math.min(this.h, Math.ceil((this.cam.y + this.viewH / z) / TILE) + 1);
    const grass = this.assets.tiles.grass;
    const dirt = this.assets.tiles.dirt;
    const water = this.assets.tiles.water;

    for (let ty = y0; ty < y1; ty++) {
      for (let tx = x0; tx < x1; tx++) {
        if (!this.explored[0][ty * this.w + tx]) continue;
        const t = this.tiles[ty * this.w + tx];
        const img = t === 2 ? water : t === 1 ? dirt : grass;
        const sx = (tx * TILE - this.cam.x) * z;
        const sy = (ty * TILE - this.cam.y) * z;
        const s = TILE * z + 0.5;
        if (img) ctx.drawImage(img, sx, sy, s, s);
        else {
          ctx.fillStyle = t === 2 ? "#2a5c6e" : t === 1 ? "#8a6a3a" : "#5a7a3a";
          ctx.fillRect(sx, sy, s, s);
        }
      }
    }

    const drawList = this.ents
      .filter((e) => e.kind !== "proj" && this.seenByPlayer(e))
      .sort((a, b) => a.y - b.y);
    for (const e of drawList) this.drawEnt(e, z);
    for (const e of this.ents) if (e.kind === "proj") this.drawProj(e, z);

    if (this.fogCanvas) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        this.fogCanvas,
        this.cam.x / TILE,
        this.cam.y / TILE,
        this.viewW / z / TILE,
        this.viewH / z / TILE,
        0,
        0,
        this.viewW,
        this.viewH,
      );
      ctx.imageSmoothingEnabled = true;
    }

    if (this.placing) this.drawGhost(z);
    if (this.mouse.down && !this.placing && !this.mouse.right && !this.touchUi) {
      const a = this.worldToScreen(this.mouse.sx, this.mouse.sy);
      const b = { x: this.mouse.x, y: this.mouse.y };
      ctx.strokeStyle = "rgba(212,196,160,0.9)";
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }
    if (this.orderMark) {
      const s = this.worldToScreen(this.orderMark.x, this.orderMark.y);
      const pulse = 10 + (1 - this.orderMark.t) * 16;
      ctx.globalAlpha = Math.max(0, this.orderMark.t);
      ctx.strokeStyle = "#d4c4a0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, pulse, pulse * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#d4c4a0";
      ctx.font = "12px Georgia";
      ctx.textAlign = "center";
      ctx.fillText(this.orderMark.text, s.x, s.y - 18);
      ctx.globalAlpha = 1;
    }
    for (const p of this.particles) {
      const s = this.worldToScreen(p.x, p.y);
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(s.x, s.y, 3, 3);
      ctx.globalAlpha = 1;
    }
    if (this.shake) ctx.restore();
  }

  worldToScreen(x: number, y: number) {
    return { x: (x - this.cam.x) * this.cam.z, y: (y - this.cam.y) * this.cam.z };
  }

  drawTinted(
    img: HTMLImageElement,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    color: string,
    amount: number,
  ) {
    if (amount <= 0 || !color) {
      this.ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      return;
    }
    if (!this.tintBuf) {
      this.tintBuf = document.createElement("canvas");
      this.tintCtx = this.tintBuf.getContext("2d");
    }
    const t = this.tintCtx!;
    const buf = this.tintBuf;
    const tw = Math.max(1, Math.ceil(sw));
    const th = Math.max(1, Math.ceil(sh));
    if (buf.width !== tw || buf.height !== th) {
      buf.width = tw;
      buf.height = th;
    }
    t.clearRect(0, 0, tw, th);
    t.globalCompositeOperation = "source-over";
    t.drawImage(img, sx, sy, sw, sh, 0, 0, tw, th);
    t.globalCompositeOperation = "source-atop";
    t.globalAlpha = amount;
    t.fillStyle = color;
    t.fillRect(0, 0, tw, th);
    t.globalAlpha = 1;
    t.globalCompositeOperation = "source-over";
    this.ctx.drawImage(buf, dx, dy, dw, dh);
  }

  drawEnt(e: Ent, z: number) {
    const s = this.worldToScreen(e.x, e.y);
    const selected = this.selected.includes(e.id);
    if (selected || (e.kind === "unit" && e.team >= 0)) {
      ctxRing(this.ctx, s.x, s.y + 4 * z, (e.kind === "bld" ? 22 : 12) * z, TEAM_COLOR[e.team as 0 | 1] ?? "#c4a574", selected);
    }
    if (e.kind === "node" || e.kind === "animal") {
      const img = this.assets.singles[e.type === "gazelle" && e.kind === "animal" ? "gazelle" : e.type] ?? this.assets.singles[e.type];
      const h = (e.type === "tree" ? 56 : 36) * z;
      const w = h * (img ? img.width / img.height : 1);
      if (img) this.ctx.drawImage(img, s.x - w / 2, s.y - h + 8 * z, w, h);
      else {
        this.ctx.fillStyle = e.type === "gold" ? "#d4b45a" : e.type === "stone" ? "#9aa0a6" : "#3d6b2a";
        this.ctx.beginPath();
        this.ctx.ellipse(s.x, s.y, 12 * z, 8 * z, 0, 0, Math.PI * 2);
        this.ctx.fill();
      }
      return;
    }
    if (e.kind === "bld") {
      const img = this.assets.singles[e.type];
      const footprint = Math.max(e.tw, e.th) * TILE * z * 0.95;
      const h = footprint * (img ? img.height / img.width : 0.85);
      this.ctx.globalAlpha = e.done ? 1 : 0.55 + e.progress * 0.45;
      if (img) this.ctx.drawImage(img, s.x - footprint / 2, s.y - h + 14 * z, footprint, h);
      else {
        this.ctx.fillStyle = TEAM_COLOR[e.team as 0 | 1];
        this.ctx.fillRect(s.x - footprint / 2, s.y - h / 2, footprint, h * 0.7);
      }
      this.ctx.globalAlpha = 1;
      const banner = TEAM_COLOR[e.team as 0 | 1];
      if (banner) {
        this.ctx.fillStyle = banner;
        this.ctx.fillRect(s.x - footprint / 2 + 4 * z, s.y - h + 18 * z, 8 * z, 12 * z);
        this.ctx.fillStyle = "#d4c4a0";
        this.ctx.fillRect(s.x - footprint / 2 + 4 * z, s.y - h + 18 * z, 2 * z, 16 * z);
      }
      if (!e.done) this.drawBar(s.x, s.y - h + 8 * z, 36 * z, e.progress, "#c4a574");
      if (selected || e.hp < e.maxHp) this.drawBar(s.x, s.y + 10 * z, 40 * z, e.hp / e.maxHp, e.team === 0 ? "#5d9e4a" : "#c44732");
      if (e.queue.length) {
        this.ctx.fillStyle = "#d4c4a0";
        this.ctx.font = `${11 * z}px Georgia`;
        this.ctx.textAlign = "center";
        this.ctx.fillText(`${e.queue.length}`, s.x, s.y - h + 4 * z);
      }
      return;
    }
    if (e.kind === "unit") {
      const def = UNITS[e.type];
      const sheetName = def?.sheet ?? e.type;
      const sheet = this.assets.sheets[sheetName];
      const single = this.assets.singles[sheetName];
      const h = (def?.role === "cavalry" || def?.role === "siege" ? 42 : 34) * z;
      if (sheet) {
        const cols = sheet.cols;
        const rows = sheet.rows;
        const fw = sheet.img.width / cols;
        const fh = sheet.img.height / rows;
        const row = rows === 2 ? Math.floor(e.anim) % rows : e.facing % rows;
        const col = Math.floor(e.anim) % cols;
        const w = h * (fw / fh);
        const tint = e.team >= 0 ? TEAM_COLOR[e.team as 0 | 1] : "";
        this.drawTinted(
          sheet.img,
          col * fw,
          row * fh,
          fw,
          fh,
          s.x - w / 2,
          s.y - h + 6 * z,
          w,
          h,
          tint,
          tint ? 0.28 : 0,
        );
      } else if (single) {
        const w = h * (single.width / single.height);
        const tint = e.team >= 0 ? TEAM_COLOR[e.team as 0 | 1] : "";
        if (e.facing === 1) {
          this.ctx.save();
          this.ctx.translate(s.x, s.y);
          this.ctx.scale(-1, 1);
          this.drawTinted(single, 0, 0, single.width, single.height, -w / 2, -h + 6 * z, w, h, tint, tint ? 0.28 : 0);
          this.ctx.restore();
        } else this.drawTinted(single, 0, 0, single.width, single.height, s.x - w / 2, s.y - h + 6 * z, w, h, tint, tint ? 0.28 : 0);
      } else {
        this.ctx.fillStyle = TEAM_COLOR[e.team as 0 | 1];
        this.ctx.beginPath();
        this.ctx.arc(s.x, s.y - 10 * z, 8 * z, 0, Math.PI * 2);
        this.ctx.fill();
      }
      if (selected || e.hp < e.maxHp) this.drawBar(s.x, s.y - h - 2 * z, 22 * z, e.hp / e.maxHp, e.team === 0 ? "#5d9e4a" : "#c44732");
      if (e.carryAmt > 0.8) {
        this.ctx.fillStyle = "#d4c4a0";
        this.ctx.font = `${10 * z}px Georgia`;
        this.ctx.textAlign = "center";
        this.ctx.fillText(String(Math.floor(e.carryAmt)), s.x, s.y + 12 * z);
      }
      if (e.task?.t === "convert") {
        this.ctx.strokeStyle = "rgba(220,210,160,0.7)";
        this.ctx.beginPath();
        this.ctx.arc(s.x, s.y - 16 * z, 16 * z, 0, Math.PI * 2);
        this.ctx.stroke();
      }
    }
  }

  drawProj(e: Ent, z: number) {
    const s = this.worldToScreen(e.x, e.y);
    this.ctx.fillStyle = "#e8d9a0";
    this.ctx.beginPath();
    this.ctx.arc(s.x, s.y, 3 * z, 0, Math.PI * 2);
    this.ctx.fill();
  }

  drawGhost(z: number) {
    if (!this.placing) return;
    const { tx, ty, ok, def } = this.tryPlace(this.placing, this.mouse.wx, this.mouse.wy);
    const x = (tx * TILE - this.cam.x) * z;
    const y = (ty * TILE - this.cam.y) * z;
    this.ctx.fillStyle = ok ? "rgba(80,140,70,0.35)" : "rgba(160,50,40,0.35)";
    this.ctx.fillRect(x, y, def.tw * TILE * z, def.th * TILE * z);
    const img = this.assets.singles[this.placing];
    if (img) {
      this.ctx.globalAlpha = 0.7;
      this.ctx.drawImage(img, x, y - def.th * TILE * z * 0.35, def.tw * TILE * z, def.th * TILE * z * 1.1);
      this.ctx.globalAlpha = 1;
    }
  }

  drawBar(x: number, y: number, w: number, p: number, color: string) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x - w / 2, y, w, 4);
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, p)), 4);
  }

  drawMinimap(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = "#1a140e";
    ctx.fillRect(0, 0, w, h);
    const sx = w / this.w;
    const sy = h / this.h;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!this.explored[0][y * this.w + x]) continue;
        const t = this.tiles[y * this.w + x];
        ctx.fillStyle = t === 2 ? "#2a5c6e" : t === 1 ? "#7a6238" : "#4a6a32";
        if (!this.visible[0][y * this.w + x]) ctx.fillStyle = t === 2 ? "#1a3a48" : "#2a3a22";
        ctx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
      }
    }
    for (const e of this.ents) {
      if (!this.seenByPlayer(e)) continue;
      if (e.kind === "unit") {
        ctx.fillStyle = TEAM_COLOR[e.team as 0 | 1] ?? "#ddd";
        ctx.fillRect((e.x / TILE) * sx - 1, (e.y / TILE) * sy - 1, 3, 3);
      } else if (e.kind === "bld") {
        ctx.fillStyle = TEAM_COLOR[e.team as 0 | 1] ?? "#ddd";
        ctx.fillRect((e.tx / this.w) * w, (e.ty / this.h) * h, Math.max(3, e.tw * sx), Math.max(3, e.th * sy));
      } else if (e.kind === "node" && (e.type === "gold" || e.type === "stone")) {
        ctx.fillStyle = e.type === "gold" ? "#d4b45a" : "#b8b8b8";
        ctx.fillRect((e.tx / this.w) * w, (e.ty / this.h) * h, 2, 2);
      }
    }
    ctx.strokeStyle = "#d4c4a0";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      (this.cam.x / TILE) * sx,
      (this.cam.y / TILE) * sy,
      (this.viewW / this.cam.z / TILE) * sx,
      (this.viewH / this.cam.z / TILE) * sy,
    );
  }

  jumpMinimap(nx: number, ny: number, mw: number, mh: number) {
    const tx = (nx / mw) * this.w;
    const ty = (ny / mh) * this.h;
    this.cam.x = tx * TILE - this.viewW / 2 / this.cam.z;
    this.cam.y = ty * TILE - this.viewH / 2 / this.cam.z;
    this.clampCam();
  }
}

function ctxRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, strong: boolean) {
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI * 2);
  ctx.strokeStyle = strong ? color : `${color}99`;
  ctx.lineWidth = strong ? 2 : 1;
  ctx.stroke();
}
