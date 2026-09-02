export type Res = "food" | "wood" | "gold" | "stone";
export type Cost = Partial<Record<Res, number>>;

export const TILE = 48;
export const POP_CAP_MAX = 50;
export const CARRY_MAX = 10;

export const AGES = [
  { id: 0, name: "Dawn Age", short: "Dawn", next: { food: 500 } as Cost, time: 36 },
  { id: 1, name: "Craft Age", short: "Craft", next: { food: 800, gold: 200 } as Cost, time: 44 },
  { id: 2, name: "Bronze Age", short: "Bronze", next: { food: 1000, gold: 800 } as Cost, time: 52 },
  { id: 3, name: "Iron Age", short: "Iron", next: null as Cost | null, time: 0 },
] as const;

export const CIVS = [
  {
    id: "nile",
    name: "Nile Kingdom",
    epithet: "Lords of the Black Land",
    bonus: "Farms yield +40% food. Priests cost 20% less gold.",
    color: "#b08d3e",
  },
  {
    id: "aegean",
    name: "Aegean League",
    epithet: "Spear of the Wine-Dark Sea",
    bonus: "Infantry gain +15% hit points and attack.",
    color: "#3d6dad",
  },
  {
    id: "rivers",
    name: "Twin Rivers",
    epithet: "Keepers of the Walls",
    bonus: "Buildings cost 20% less. Towers see farther.",
    color: "#8a5a28",
  },
  {
    id: "highland",
    name: "Highland Host",
    epithet: "Riders of the Plateau",
    bonus: "Cavalry move 20% faster. Age advances cost 20% less.",
    color: "#7a3b32",
  },
] as const;

export type CivId = (typeof CIVS)[number]["id"];

export type UnitDef = {
  id: string;
  name: string;
  role: "villager" | "infantry" | "ranged" | "cavalry" | "priest" | "siege";
  sheet: string;
  sheetRows?: number;
  cost: Cost;
  time: number;
  hp: number;
  speed: number;
  attack: number;
  range: number;
  los: number;
  pop: number;
  age: number;
  building: string;
  projectile?: boolean;
  splash?: number;
  convert?: boolean;
};

export const UNITS: Record<string, UnitDef> = {
  villager: {
    id: "villager",
    name: "Villager",
    role: "villager",
    sheet: "villager",
    cost: { food: 50 },
    time: 12,
    hp: 25,
    speed: 54,
    attack: 3,
    range: 20,
    los: 5,
    pop: 1,
    age: 0,
    building: "town_center",
  },
  clubman: {
    id: "clubman",
    name: "Clubman",
    role: "infantry",
    sheet: "clubman",
    cost: { food: 50 },
    time: 10,
    hp: 40,
    speed: 50,
    attack: 5,
    range: 22,
    los: 4,
    pop: 1,
    age: 0,
    building: "barracks",
  },
  axeman: {
    id: "axeman",
    name: "Axeman",
    role: "infantry",
    sheet: "clubman",
    cost: { food: 50 },
    time: 10,
    hp: 50,
    speed: 50,
    attack: 7,
    range: 22,
    los: 4,
    pop: 1,
    age: 1,
    building: "barracks",
  },
  bowman: {
    id: "bowman",
    name: "Bowman",
    role: "ranged",
    sheet: "bowman",
    cost: { wood: 40, gold: 20 },
    time: 12,
    hp: 35,
    speed: 50,
    attack: 4,
    range: 170,
    los: 5,
    pop: 1,
    age: 1,
    building: "archery",
    projectile: true,
  },
  scout: {
    id: "scout",
    name: "Scout",
    role: "cavalry",
    sheet: "scout",
    cost: { food: 80 },
    time: 14,
    hp: 60,
    speed: 86,
    attack: 5,
    range: 24,
    los: 7,
    pop: 1,
    age: 1,
    building: "stable",
  },
  swordsman: {
    id: "swordsman",
    name: "Swordsman",
    role: "infantry",
    sheet: "swordsman",
    cost: { food: 60, gold: 20 },
    time: 13,
    hp: 70,
    speed: 50,
    attack: 9,
    range: 22,
    los: 4,
    pop: 1,
    age: 2,
    building: "barracks",
  },
  cavalry: {
    id: "cavalry",
    name: "Cavalry",
    role: "cavalry",
    sheet: "cavalry",
    cost: { food: 70, gold: 60 },
    time: 16,
    hp: 95,
    speed: 80,
    attack: 8,
    range: 24,
    los: 5,
    pop: 1,
    age: 2,
    building: "stable",
  },
  priest: {
    id: "priest",
    name: "Priest",
    role: "priest",
    sheet: "priest",
    sheetRows: 2,
    cost: { gold: 125 },
    time: 20,
    hp: 26,
    speed: 40,
    attack: 0,
    range: 130,
    los: 5,
    pop: 1,
    age: 2,
    building: "temple",
    convert: true,
  },
  catapult: {
    id: "catapult",
    name: "Catapult",
    role: "siege",
    sheet: "catapult",
    cost: { wood: 80, gold: 80 },
    time: 24,
    hp: 80,
    speed: 28,
    attack: 20,
    range: 250,
    los: 5,
    pop: 1,
    age: 3,
    building: "archery",
    projectile: true,
    splash: 46,
  },
};

export type BldDef = {
  id: string;
  name: string;
  tw: number;
  th: number;
  hp: number;
  cost: Cost;
  time: number;
  pop: number;
  los: number;
  age: number;
  drop?: Res[] | "all";
  trains?: string[];
  attack?: number;
  range?: number;
};

export const BUILDINGS: Record<string, BldDef> = {
  town_center: {
    id: "town_center",
    name: "Town Center",
    tw: 4,
    th: 4,
    hp: 600,
    cost: { wood: 200, stone: 120 },
    time: 42,
    pop: 4,
    los: 8,
    age: 1,
    drop: "all",
    trains: ["villager"],
  },
  house: {
    id: "house",
    name: "House",
    tw: 2,
    th: 2,
    hp: 75,
    cost: { wood: 30 },
    time: 10,
    pop: 4,
    los: 2,
    age: 0,
  },
  barracks: {
    id: "barracks",
    name: "Barracks",
    tw: 4,
    th: 3,
    hp: 350,
    cost: { wood: 125 },
    time: 20,
    pop: 0,
    los: 4,
    age: 0,
    trains: ["clubman", "axeman", "swordsman"],
  },
  granary: {
    id: "granary",
    name: "Granary",
    tw: 3,
    th: 3,
    hp: 350,
    cost: { wood: 120 },
    time: 18,
    pop: 0,
    los: 4,
    age: 0,
    drop: ["food"],
  },
  storage_pit: {
    id: "storage_pit",
    name: "Storage Pit",
    tw: 3,
    th: 3,
    hp: 350,
    cost: { wood: 120 },
    time: 18,
    pop: 0,
    los: 4,
    age: 0,
    drop: ["wood", "gold", "stone"],
  },
  farm: {
    id: "farm",
    name: "Farm",
    tw: 3,
    th: 3,
    hp: 50,
    cost: { wood: 75 },
    time: 12,
    pop: 0,
    los: 2,
    age: 1,
    drop: ["food"],
  },
  archery: {
    id: "archery",
    name: "Archery Range",
    tw: 4,
    th: 3,
    hp: 350,
    cost: { wood: 125 },
    time: 20,
    pop: 0,
    los: 4,
    age: 1,
    trains: ["bowman", "catapult"],
  },
  stable: {
    id: "stable",
    name: "Stable",
    tw: 4,
    th: 3,
    hp: 350,
    cost: { wood: 125 },
    time: 20,
    pop: 0,
    los: 4,
    age: 1,
    trains: ["scout", "cavalry"],
  },
  tower: {
    id: "tower",
    name: "Watch Tower",
    tw: 2,
    th: 2,
    hp: 200,
    cost: { wood: 50, stone: 100 },
    time: 18,
    pop: 0,
    los: 10,
    age: 1,
    attack: 5,
    range: 190,
  },
  temple: {
    id: "temple",
    name: "Temple",
    tw: 3,
    th: 3,
    hp: 350,
    cost: { wood: 200 },
    time: 24,
    pop: 0,
    los: 4,
    age: 2,
    trains: ["priest"],
  },
  market: {
    id: "market",
    name: "Market",
    tw: 3,
    th: 3,
    hp: 350,
    cost: { wood: 150 },
    time: 20,
    pop: 0,
    los: 4,
    age: 1,
  },
  wall: {
    id: "wall",
    name: "Wall",
    tw: 1,
    th: 1,
    hp: 200,
    cost: { stone: 5 },
    time: 5,
    pop: 0,
    los: 1,
    age: 1,
  },
};

export const NODE_AMOUNTS: Record<string, number> = {
  tree: 40,
  berry: 100,
  gold: 250,
  stone: 250,
  gazelle: 60,
  farm: 250,
};

export const GATHER_RATE: Record<string, number> = {
  tree: 0.85,
  berry: 1.05,
  gold: 0.62,
  stone: 0.62,
  gazelle: 0.95,
  farm: 0.9,
};

export const NODE_RES: Record<string, Res> = {
  tree: "wood",
  berry: "food",
  gold: "gold",
  stone: "stone",
  gazelle: "food",
  farm: "food",
};

export const TEAM_COLOR = ["#3d7ec9", "#c44732"] as const;

export function scaleCost(cost: Cost, mul: number): Cost {
  const out: Cost = {};
  (Object.keys(cost) as Res[]).forEach((k) => {
    const v = cost[k];
    if (v) out[k] = Math.max(1, Math.round(v * mul));
  });
  return out;
}

export function canAfford(stock: Record<Res, number>, cost: Cost): boolean {
  return (Object.keys(cost) as Res[]).every((k) => stock[k] >= (cost[k] ?? 0));
}

export function pay(stock: Record<Res, number>, cost: Cost) {
  (Object.keys(cost) as Res[]).forEach((k) => {
    stock[k] -= cost[k] ?? 0;
  });
}

export function refund(stock: Record<Res, number>, cost: Cost) {
  (Object.keys(cost) as Res[]).forEach((k) => {
    stock[k] += cost[k] ?? 0;
  });
}

export function civCostMul(civ: CivId, kind: "age" | "build" | "priest"): number {
  if (civ === "rivers" && kind === "build") return 0.8;
  if (civ === "highland" && kind === "age") return 0.8;
  if (civ === "nile" && kind === "priest") return 0.8;
  return 1;
}

export function unitBonuses(civ: CivId, def: UnitDef): { hp: number; attack: number; speed: number } {
  let hp = def.hp;
  let attack = def.attack;
  let speed = def.speed;
  if (civ === "aegean" && def.role === "infantry") {
    hp = Math.round(hp * 1.15);
    attack = Math.round(attack * 1.15);
  }
  if (civ === "highland" && def.role === "cavalry") speed = Math.round(speed * 1.2);
  return { hp, attack, speed };
}

export const MISSIONS = [
  {
    id: 1,
    title: "The First Dawn",
    map: "raid" as const,
    blurb:
      "A small people gathers on the river plain. Raise houses, arm clubmen, and drive the raiders from the olive groves.",
    objectives: [
      "Gather 150 food",
      "Build a House",
      "Build a Barracks",
      "Train 4 soldiers",
      "Destroy the raider camp",
    ],
  },
  {
    id: 2,
    title: "Rival Hearth",
    map: "duel" as const,
    blurb:
      "Another tribe has raised a town across the valley. Advance to the Craft Age and tear down their Town Center.",
    objectives: ["Advance to the Craft Age", "Destroy the enemy Town Center"],
  },
  {
    id: 3,
    title: "Empire's Edge",
    map: "duel" as const,
    blurb:
      "Two rising powers claim the same hills. Reach the Bronze Age and leave no rival hall standing.",
    objectives: ["Advance to the Bronze Age", "Defeat the rival empire"],
    enemyAge: 1,
  },
];

export const BUILD_HOTKEYS: Record<string, string> = {
  KeyH: "house",
  KeyB: "barracks",
  KeyF: "farm",
  KeyR: "archery",
  KeyL: "stable",
  KeyG: "granary",
  KeyP: "storage_pit",
  KeyY: "tower",
  KeyM: "market",
  KeyX: "wall",
};
