import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testDir = mkdtempSync(join(tmpdir(), "dawn-of-empires-gameplay-"));
const bundle = join(testDir, "engine.mjs");

execFileSync(
  join(root, "node_modules", ".bin", "rolldown"),
  [
    "src/game/engine.ts",
    "--file",
    bundle,
    "--platform",
    "node",
    "--format",
    "esm",
    "--tsconfig",
    "tsconfig.json",
  ],
  { cwd: root, stdio: "pipe" },
);

installDomStubs();
const { Engine } = await import(pathToFileURL(bundle).href);

after(() => rmSync(testDir, { recursive: true, force: true }));

test("starting villagers are idle and obey a move order", () => {
  const engine = makeEngine();
  const villagers = playerUnits(engine).filter((unit) => unit.type === "villager");
  assert.equal(villagers.length, 3);
  assert.ok(villagers.every((unit) => unit.task === null && unit.vx === 0 && unit.vy === 0));

  const starts = villagers.map((unit) => ({ x: unit.x, y: unit.y }));
  stepFrames(engine, 60);
  villagers.forEach((unit, index) => {
    assert.equal(unit.x, starts[index].x);
    assert.equal(unit.y, starts[index].y);
  });

  const lead = villagers[0];
  const before = { x: lead.x, y: lead.y };
  findReachableOrder(engine, [lead.id], lead, 240);
  assert.ok(lead.task, "a reachable move order should create a path");
  assert.ok(
    runUntil(engine, () => !lead.task, 1_800),
    "villager should complete its route",
  );
  assert.ok(Math.hypot(lead.x - before.x, lead.y - before.y) > 150);
  assertActorSafe(engine, lead);
});

test("a trained villager appears safely outside the Town Center and stays visible", () => {
  const engine = makeEngine();
  const townCenter = playerBuilding(engine, "town_center");
  const beforeIds = new Set(playerUnits(engine).map((unit) => unit.id));

  townCenter.queue.push({ type: "villager", left: 0.01, cost: { food: 50 } });
  stepFrames(engine, 2);

  const trained = playerUnits(engine).find((unit) => !beforeIds.has(unit.id));
  assert.ok(trained, "trained villager should be inserted into the world");
  assert.equal(trained.type, "villager");
  assert.equal(trained.task, null, "no implicit route should carry the villager away");
  assertOutsideBuilding(trained, townCenter);
  assertNearBuilding(engine, trained, townCenter);
  assertActorSafe(engine, trained);
});

test("villagers hunt moving animals with tracked arrows and gather the carcass", () => {
  const engine = makeEngine();
  const hunter = playerUnits(engine)[0];
  const animalPoint = safePointAtDistance(engine, hunter, 115, 150);
  const animal = engine.mkEnt("animal", "gazelle", -1, animalPoint.x, animalPoint.y, 18);
  animal.vx = 32;
  animal.vy = 12;
  engine.ents.push(animal);
  hunter.task = { t: "attack", targetId: animal.id };

  let sawArrow = false;
  for (let frame = 0; frame < 240 && animal.hp > 0; frame++) {
    engine.step(1 / 30);
    sawArrow ||= engine.ents.some(
      (ent) =>
        ent.kind === "proj" &&
        ent.type === "arrow" &&
        ent.task?.t === "attack" &&
        ent.task.targetId === animal.id,
    );
  }

  assert.ok(sawArrow, "hunter should fire a visible arrow from beyond melee distance");
  assert.ok(animal.hp <= 0, "tracked arrows should bring down the animal");
  const carcass = engine.ents.find(
    (ent) =>
      ent.kind === "node" &&
      ent.type === "gazelle" &&
      Math.hypot(ent.x - animal.x, ent.y - animal.y) < 2,
  );
  assert.ok(carcass, "the animal should become a gatherable carcass");
  assert.equal(hunter.task?.t, "gather");
  assert.equal(hunter.task?.nodeId, carcass.id);
});

test("trained soldiers have safe spawns and every route is clamped to the map", () => {
  const engine = makeEngine();
  const townCenter = playerBuilding(engine, "town_center");
  const barracks = placeBuildingNear(engine, "barracks", townCenter);
  const beforeIds = new Set(playerUnits(engine).map((unit) => unit.id));

  barracks.queue.push({ type: "clubman", left: 0.01, cost: { food: 50 } });
  stepFrames(engine, 2);
  const soldier = playerUnits(engine).find((unit) => !beforeIds.has(unit.id));
  assert.ok(soldier, "trained soldier should appear in the world");
  assert.equal(soldier.type, "clubman");
  assert.equal(soldier.task, null, "a default off-screen rally route must not be assigned");
  assertOutsideBuilding(soldier, barracks);
  assertNearBuilding(engine, soldier, barracks);
  assertActorSafe(engine, soldier);

  engine.issueMove([soldier.id], 1_000_000, -1_000_000);
  if (soldier.task?.t === "move") {
    const goal = soldier.task.path.at(-1);
    assert.ok(goal);
    assert.ok(goal.x >= 0 && goal.x < engine.w && goal.y >= 0 && goal.y < engine.h);
  }
  for (let frame = 0; frame < 2_400 && soldier.task; frame++) {
    engine.step(1 / 30);
    assertActorSafe(engine, soldier);
  }
  assertActorSafe(engine, soldier);

  engine.selected = [barracks.id];
  engine.issueCommand(-1_000_000, 1_000_000, null);
  assert.equal(barracks.rallySet, true);
  assert.ok(barracks.rallyX >= 16 && barracks.rallyX <= engine.w * 48 - 16);
  assert.ok(barracks.rallyY >= 16 && barracks.rallyY <= engine.h * 48 - 16);
});

test("units recover from blocked tiles and re-route instead of oscillating", () => {
  const engine = makeEngine();
  const unit = playerUnits(engine)[0];
  const townCenter = playerBuilding(engine, "town_center");
  engine.ents = engine.ents.filter(
    (ent) => ent.kind !== "unit" || ent.team !== 0 || ent.id === unit.id,
  );

  unit.x = townCenter.x;
  unit.y = townCenter.y;
  unit.task = null;
  engine.step(1 / 30);
  assertActorSafe(engine, unit);
  const recovered = { x: unit.x, y: unit.y };
  stepFrames(engine, 30);
  assert.equal(unit.x, recovered.x);
  assert.equal(unit.y, recovered.y);

  findReachableOrder(engine, [unit.id], unit, 260);
  assert.equal(unit.task?.t, "move");
  const goal = unit.task.path.at(-1);
  assert.ok(goal);
  unit.task = {
    t: "move",
    path: [
      { x: Math.floor(unit.x / 48), y: Math.floor(unit.y / 48) },
      { x: townCenter.tx + 1, y: townCenter.ty + 1 },
      goal,
    ],
    i: 0,
  };

  assert.ok(
    runUntil(engine, () => !unit.task, 2_400),
    "unit should replan around the blocked waypoint",
  );
  assert.ok(Math.hypot(unit.x - (goal.x + 0.5) * 48, unit.y - (goal.y + 0.5) * 48) < 18);
  assertActorSafe(engine, unit);
  const settled = { x: unit.x, y: unit.y };
  stepFrames(engine, 60);
  assert.ok(
    Math.hypot(unit.x - settled.x, unit.y - settled.y) < 0.01,
    "recovered unit should not dance in place",
  );
});

test("depleted trees fall, unblock their tile, persist as stumps, and workers move on", () => {
  const engine = makeEngine();
  const villager = playerUnits(engine)[0];
  const tree = engine.ents.find(
    (ent) => ent.kind === "node" && ent.type === "tree" && ent.amount > 0,
  );
  assert.ok(tree);
  const workPoint = safeAdjacentPoint(engine, tree);
  villager.x = workPoint.x;
  villager.y = workPoint.y;
  villager.carryAmt = 0;
  villager.carryRes = null;
  villager.task = { t: "gather", nodeId: tree.id, phase: "go" };
  tree.amount = 0.04;

  assert.ok(
    runUntil(engine, () => tree.amount === 0, 10),
    "tree should be depleted by chopping",
  );
  assert.equal(
    engine.blocked[tree.ty * engine.w + tree.tx],
    0,
    "felled tree must stop blocking paths",
  );
  assert.ok(tree.progress > 0, "tree should enter its falling animation state");
  engine.step(1 / 30);
  assert.notEqual(villager.task?.nodeId, tree.id, "worker should not keep chopping an empty tree");

  stepFrames(engine, 30);
  const stump = engine.byId(tree.id);
  assert.ok(stump, "the depleted tree should remain as a visible stump");
  assert.equal(stump.amount, 0);
  assert.equal(stump.progress, 0);
});

function makeEngine(seed = 424242) {
  const engine = new Engine(
    mockCanvas(),
    { tiles: {}, sheets: {}, singles: {}, ui: {} },
    {
      mode: "skirmish",
      mission: 0,
      civ: "aegean",
      enemyCiv: "nile",
      difficulty: 0,
      seed,
    },
    () => {},
  );
  engine.aiT = -1_000_000;
  engine.fogT = -1_000_000;
  engine.objT = -1_000_000;
  engine.winT = -1_000_000;
  return engine;
}

function playerUnits(engine) {
  return engine.ents.filter((ent) => ent.kind === "unit" && ent.team === 0);
}

function playerBuilding(engine, type) {
  const building = engine.ents.find(
    (ent) => ent.kind === "bld" && ent.team === 0 && ent.type === type,
  );
  assert.ok(building, `${type} should exist`);
  return building;
}

function stepFrames(engine, count) {
  for (let frame = 0; frame < count; frame++) engine.step(1 / 30);
}

function runUntil(engine, condition, maxFrames) {
  for (let frame = 0; frame < maxFrames; frame++) {
    engine.step(1 / 30);
    if (condition()) return true;
  }
  return condition();
}

function findReachableOrder(engine, ids, origin, minimumDistance) {
  const points = [];
  for (let ty = 1; ty < engine.h - 1; ty++) {
    for (let tx = 1; tx < engine.w - 1; tx++) {
      const point = { x: (tx + 0.5) * 48, y: (ty + 0.5) * 48 };
      const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
      if (distance >= minimumDistance && engine.canUnitStand(point.x, point.y))
        points.push({ ...point, distance });
    }
  }
  points.sort((a, b) => a.distance - b.distance);
  for (const point of points) {
    engine.issueMove(ids, point.x, point.y);
    const unit = engine.byId(ids[0]);
    if (unit?.task?.t === "move") return point;
  }
  assert.fail("could not find a reachable destination");
}

function safePointAtDistance(engine, origin, min, max) {
  for (let ty = 1; ty < engine.h - 1; ty++) {
    for (let tx = 1; tx < engine.w - 1; tx++) {
      const point = { x: (tx + 0.5) * 48, y: (ty + 0.5) * 48 };
      const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
      if (distance >= min && distance <= max && engine.canUnitStand(point.x, point.y)) return point;
    }
  }
  assert.fail("could not find a safe hunting point");
}

function safeAdjacentPoint(engine, target) {
  for (let radius = 1; radius <= 3; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const x = (target.tx + dx + 0.5) * 48;
        const y = (target.ty + dy + 0.5) * 48;
        if (engine.canUnitStand(x, y)) return { x, y };
      }
    }
  }
  assert.fail("could not find a safe adjacent tile");
}

function placeBuildingNear(engine, type, near) {
  for (let radius = 5; radius <= 16; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const tx = near.tx + dx;
        const ty = near.ty + dy;
        if (!engine.canPlace(type, tx, ty, 0)) continue;
        const occupied = playerUnits(engine).some((unit) => {
          const ux = Math.floor(unit.x / 48);
          const uy = Math.floor(unit.y / 48);
          return ux >= tx && ux < tx + 4 && uy >= ty && uy < ty + 3;
        });
        if (!occupied) return engine.spawnBld(type, 0, tx, ty, true);
      }
    }
  }
  assert.fail(`could not place ${type}`);
}

function assertOutsideBuilding(unit, building) {
  const tx = Math.floor(unit.x / 48);
  const ty = Math.floor(unit.y / 48);
  const inside =
    tx >= building.tx &&
    tx < building.tx + building.tw &&
    ty >= building.ty &&
    ty < building.ty + building.th;
  assert.equal(inside, false, "unit must spawn outside the building footprint");
}

function assertNearBuilding(engine, unit, building) {
  assert.ok(
    engine.distToEnt(unit, building) <= 30,
    "unit should use the nearest open perimeter tile",
  );
}

function assertActorSafe(engine, actor) {
  assert.ok(
    actor.x >= 16 && actor.x <= engine.w * 48 - 16,
    "actor x coordinate must remain in bounds",
  );
  assert.ok(
    actor.y >= 16 && actor.y <= engine.h * 48 - 16,
    "actor y coordinate must remain in bounds",
  );
  assert.ok(
    engine.canUnitStand(actor.x, actor.y),
    "actor must not occupy terrain, a tree, or a building",
  );
}

function mockCanvas() {
  return {
    width: 0,
    height: 0,
    style: {},
    parentElement: { getBoundingClientRect: () => ({ width: 1400, height: 900 }) },
    getContext: () => ({}),
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
  };
}

function installDomStubs() {
  const fogContext = {
    createImageData(width, height) {
      return { data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData() {},
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      visibilityState: "visible",
      createElement: () => ({ width: 0, height: 0, getContext: () => fogContext }),
      addEventListener() {},
      removeEventListener() {},
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      devicePixelRatio: 1,
      matchMedia: () => ({ matches: false }),
      addEventListener() {},
      removeEventListener() {},
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { maxTouchPoints: 0 },
  });
}
