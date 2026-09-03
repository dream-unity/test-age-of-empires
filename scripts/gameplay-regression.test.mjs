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

test("touch taps deselect on empty ground until Move is chosen from the HUD", () => {
  const engine = makeEngine();
  const villager = playerUnits(engine)[0];
  const destination = findReachableOrder(engine, [villager.id], villager, 240);
  villager.task = null;
  engine.touchUi = true;
  engine.selected = [villager.id];

  tapWorld(engine, destination);
  assert.deepEqual(engine.selected, [], "an ordinary empty-ground tap should clear selection");
  assert.equal(villager.task, null, "deselecting must not silently issue a move order");

  engine.selected = [villager.id];
  engine.doAction("move");
  assert.equal(engine.commandMode, "move");
  tapWorld(engine, destination);
  assert.deepEqual(engine.selected, [villager.id]);
  assert.equal(engine.commandMode, null, "Move mode should finish after choosing a destination");
  assert.equal(villager.task?.t, "move", "the explicit Move action should issue the route");

  const townCenter = playerBuilding(engine, "town_center");
  townCenter.rallySet = false;
  engine.selected = [townCenter.id];
  tapWorld(engine, destination);
  assert.deepEqual(engine.selected, [], "empty ground should also deselect a building");
  assert.equal(townCenter.rallySet, false, "deselecting must not silently set a rally point");

  engine.selected = [townCenter.id];
  engine.doAction("rally");
  tapWorld(engine, destination);
  assert.equal(townCenter.rallySet, true, "Set rally should explicitly enable the next ground tap");

  const resource = engine.ents.find(
    (ent) => ent.kind === "node" && ent.amount > 0 && engine.seenByPlayer(ent),
  );
  assert.ok(resource, "a visible resource should exist for direct touch commands");
  villager.task = null;
  engine.selected = [villager.id];
  tapWorld(engine, {
    x: resource.x,
    y: resource.type === "tree" ? resource.y - 18 : resource.y,
  });
  assert.equal(villager.task?.t, "gather", "tapping a relevant resource should still command it");
  assert.equal(villager.task?.nodeId, resource.id);
});

test("touch supports hold-drag subset selection while preserving pan and double-tap", () => {
  const engine = makeEngine();
  const villagers = playerUnits(engine).filter((unit) => unit.type === "villager");
  assert.equal(villagers.length, 3);
  engine.touchUi = true;
  engine.cam = { x: 0, y: 0, z: 1 };
  Object.assign(villagers[0], { x: 120, y: 120 });
  Object.assign(villagers[1], { x: 190, y: 180 });
  Object.assign(villagers[2], { x: 360, y: 320 });

  engine.onDown(touchPointer("pointerdown", 11, 80, 80));
  engine.holdAt = performance.now() - 500;
  engine.onMove(touchPointer("pointermove", 11, 240, 240));
  assert.equal(engine.touchBoxSelecting, true, "a held drag should enter marquee mode");
  assert.equal(engine.cam.x, 0, "marquee selection must not pan the map");
  engine.onUp(touchPointer("pointerup", 11, 240, 240));
  assert.deepEqual(
    engine.selected,
    [villagers[0].id, villagers[1].id],
    "the marquee should select exactly the units inside it",
  );
  assert.equal(engine.touchBoxSelecting, false);

  engine.lastClick = { id: 0, t: 0 };
  tapWorld(engine, villagers[0]);
  tapWorld(engine, villagers[0]);
  assert.deepEqual(
    engine.selected,
    villagers.map((villager) => villager.id),
    "double-tap should still select every unit of the tapped type",
  );

  engine.cam = { x: 0, y: 0, z: 1 };
  engine.onDown(touchPointer("pointerdown", 12, 500, 400));
  engine.onMove(touchPointer("pointermove", 12, 440, 400));
  assert.equal(engine.touchBoxSelecting, false, "an immediate drag should remain a pan gesture");
  assert.ok(engine.cam.x > 0, "the immediate drag should move the camera");
  engine.onUp(touchPointer("pointerup", 12, 440, 400));
});

test("a completed Granary unlocks placeable food-producing Farms in the Dawn Age", () => {
  const engine = makeEngine();
  const townCenter = playerBuilding(engine, "town_center");
  const villager = playerUnits(engine).find((unit) => unit.type === "villager");
  assert.ok(villager);
  assert.equal(engine.age[0], 0);
  assert.equal(engine.buildingUnlocked("farm", 0), false);

  engine.selected = [villager.id];
  engine.doAction("build:farm");
  assert.equal(engine.placing, null, "a Farm should require a completed Granary");

  const granary = placeBuildingNear(engine, "granary", townCenter);
  assert.equal(engine.buildingUnlocked("farm", 0), true);
  engine.selected = [granary.id];
  const granaryFarm = engine.snapshot().actions.find((action) => action.id === "build:farm");
  assert.ok(granaryFarm, "selecting a completed Granary should expose its Farm action");
  assert.equal(granaryFarm.disabled, false);

  engine.selected = [villager.id];
  assert.ok(
    engine.snapshot().actions.some((action) => action.id === "build:farm"),
    "villagers should also gain Farm construction after a Granary is complete",
  );

  engine.selected = [granary.id];
  engine.doAction("build:farm");
  assert.equal(engine.placing, "farm");
  const site = findBuildingSiteNear(engine, "farm", granary);
  const woodBefore = engine.stock[0].wood;
  engine.confirmPlace((site.tx + 1.5) * 48, (site.ty + 1.5) * 48);
  const farm = engine.ents.find(
    (ent) => ent.kind === "bld" && ent.team === 0 && ent.type === "farm" && !ent.done,
  );
  assert.ok(farm, "the Farm action should create a construction site");
  assert.equal(engine.stock[0].wood, woodBefore - 75);

  const builder = playerUnits(engine).find(
    (unit) => unit.type === "villager" && unit.task?.t === "build" && unit.task.bldId === farm.id,
  );
  assert.ok(builder, "a nearby villager should be assigned to build the Farm");
  const workPoint = safeAdjacentPoint(engine, farm);
  builder.x = workPoint.x;
  builder.y = workPoint.y;
  farm.progress = 0.99;
  assert.ok(
    runUntil(engine, () => farm.done, 30),
    "the Farm should complete normally",
  );
  assert.ok(farm.amount > 0, "a completed Farm should contain gatherable food");
  assert.equal(builder.task?.t, "gather");
  assert.equal(builder.task?.nodeId, farm.id);
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
      if (
        distance >= minimumDistance &&
        engine.canUnitStand(point.x, point.y) &&
        !engine.hitEnt(point.x, point.y, true, 50)
      )
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

function tapWorld(engine, point) {
  engine.cam.z = 1;
  engine.cam.x = Math.max(0, Math.min(engine.w * 48 - engine.viewW, point.x - engine.viewW / 2));
  engine.cam.y = Math.max(0, Math.min(engine.h * 48 - engine.viewH, point.y - engine.viewH / 2));
  const clientX = point.x - engine.cam.x;
  const clientY = point.y - engine.cam.y;
  engine.mouse.down = true;
  engine.mouse.right = false;
  engine.mouse.sx = point.x;
  engine.mouse.sy = point.y;
  engine.pointerDragged = false;
  engine.holdAt = performance.now();
  engine.pointers.set(1, { x: clientX, y: clientY });
  engine.onUp({
    pointerId: 1,
    pointerType: "touch",
    clientX,
    clientY,
    shiftKey: false,
  });
}

function touchPointer(type, pointerId, clientX, clientY) {
  return {
    type,
    pointerId,
    pointerType: "touch",
    clientX,
    clientY,
    button: 0,
    ctrlKey: false,
    shiftKey: false,
    preventDefault() {},
  };
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
  const { tx, ty } = findBuildingSiteNear(engine, type, near);
  return engine.spawnBld(type, 0, tx, ty, true);
}

function findBuildingSiteNear(engine, type, near) {
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
        if (!occupied) return { tx, ty };
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
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1400, height: 900 }),
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
      AudioContext: class {
        state = "running";
        currentTime = 0;
        destination = {};
        createGain() {
          return {
            gain: {
              setTargetAtTime() {},
              setValueAtTime() {},
              exponentialRampToValueAtTime() {},
            },
            connect() {},
            disconnect() {},
          };
        }
        createOscillator() {
          return {
            type: "sine",
            frequency: {
              setValueAtTime() {},
              exponentialRampToValueAtTime() {},
            },
            connect() {},
            disconnect() {},
            start() {},
            stop() {},
            onended: null,
          };
        }
        resume() {}
      },
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { maxTouchPoints: 0 },
  });
}
