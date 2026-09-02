import { useEffect, useRef, useState } from "react";
import { CIVS, type CivId } from "@/game/catalog";
import { Engine, loadAssets, type Assets, type GameConfig, type HudSnapshot } from "@/game/engine";
import { audio } from "@/game/audio";
import { TitleScreen } from "./TitleScreen";
import { HudOverlay } from "./HudOverlay";

type Screen = "title" | "play" | "how" | "settings";

const SAVE = "dawn-empires-v1";

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE);
    if (!raw)
      return {
        version: 1,
        campaign: 0,
        civ: "aegean" as CivId,
        music: 0.22,
        sfx: 0.55,
        muted: false,
      };
    const d = JSON.parse(raw) as {
      version?: number;
      campaign?: number;
      civ?: CivId;
      music?: number;
      sfx?: number;
      muted?: boolean;
    };
    return {
      version: 1,
      campaign: d.campaign ?? 0,
      civ: d.civ ?? "aegean",
      music: d.music ?? 0.22,
      sfx: d.sfx ?? 0.55,
      muted: d.muted ?? false,
    };
  } catch {
    return {
      version: 1,
      campaign: 0,
      civ: "aegean" as CivId,
      music: 0.22,
      sfx: 0.55,
      muted: false,
    };
  }
}

export function DawnApp() {
  const [screen, setScreen] = useState<Screen>("title");
  const [save, setSave] = useState({
    version: 1,
    campaign: 0,
    civ: "aegean" as CivId,
    music: 0.22,
    sfx: 0.55,
    muted: false,
  });
  const [civ, setCiv] = useState<CivId>("aegean");
  const [difficulty, setDifficulty] = useState<0 | 1 | 2>(1);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [cfg, setCfg] = useState<GameConfig | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);

  useEffect(() => {
    const s = loadSave();
    setSave(s);
    setCiv(s.civ);
    audio.setMusic(s.music);
    audio.setSfx(s.sfx);
    audio.setMuted(s.muted);
    void loadAssets()
      .then(setAssets)
      .catch((e: unknown) => setLoadErr(e instanceof Error ? e.message : "Could not load art"));
  }, []);

  useEffect(() => {
    if (screen !== "play" || !cfg || !assets || !canvasRef.current) return;
    const engine = new Engine(canvasRef.current, assets, cfg, setHud);
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [screen, cfg, assets]);

  const persist = (patch: Partial<typeof save>) => {
    const next = { ...save, ...patch, version: 1 as const };
    setSave(next);
    try {
      localStorage.setItem(SAVE, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const enemyCiv = (CIVS.find((c) => c.id !== civ) ?? CIVS[0]).id;

  const begin = () => {
    if (!assets) return;
    audio.unlock();
    persist({ civ });
    setCfg({
      mode: "skirmish",
      mission: 0,
      civ,
      enemyCiv,
      difficulty,
      seed: (Math.random() * 1e9) | 0,
    });
    setScreen("play");
  };

  if (screen === "title") {
    return (
      <>
        <TitleScreen
          civ={civ}
          setCiv={setCiv}
          difficulty={difficulty}
          setDifficulty={setDifficulty}
          onPlay={begin}
          onHow={() => setScreen("how")}
          onSettings={() => setScreen("settings")}
          ready={!!assets}
        />
        {!assets && !loadErr && (
          <p className="pointer-events-none absolute bottom-4 left-5 text-xs text-parchment-dim">
            Loading the field…
          </p>
        )}
        {loadErr && <p className="absolute bottom-4 left-5 text-xs text-blood">{loadErr}</p>}
      </>
    );
  }

  if (screen === "how") {
    return (
      <div className="flex h-dvh flex-col overflow-auto bg-ink px-6 py-10 text-parchment">
        <h1 className="font-display text-3xl">How to Play</h1>
        <div className="mt-6 max-w-xl space-y-4 text-sm leading-relaxed text-parchment-dim">
          <p>
            On a computer: left-click selects. Drag a box to select many. Right-click — or tap a
            resource — issues a command.
          </p>
          <p>
            On a tablet or phone: tap a villager to select, then tap a tree, berry bush, gold pile,
            or stone to gather. Tap the ground to move. Drag with one finger to pan, pinch to zoom.
            Double-tap a villager to select all of that type.
          </p>
          <p>
            You can also use the buttons along the bottom: Forage, Chop wood, Mine gold, Mine stone,
            Hunt. No right-click is needed.
          </p>
          <p>
            Villagers collect food, wood, gold and stone, then return to a Town Center, Granary
            (food) or Storage Pit.
          </p>
          <p>
            Houses raise population. Barracks, Archery Ranges and Stables train soldiers. Advance
            ages at the Town Center.
          </p>
          <p>
            WASD or arrows pan. Mouse-wheel zooms. C centers on the selection. Period finds an idle
            villager. Esc cancels placement.
          </p>
          <p>Destroy the enemy Town Center to win. Guard your own.</p>
        </div>
        <button
          type="button"
          onClick={() => setScreen("title")}
          className="mt-8 w-fit rounded-md border border-bronze/40 px-5 py-2.5 font-display"
        >
          Back
        </button>
      </div>
    );
  }

  if (screen === "settings") {
    return (
      <div className="flex h-dvh flex-col bg-ink px-6 py-10 text-parchment">
        <h1 className="font-display text-3xl">Settings</h1>
        <label className="mt-8 flex max-w-sm items-center justify-between gap-4 text-sm">
          Music
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={save.music}
            onChange={(e) => {
              const v = Number(e.target.value);
              audio.setMusic(v);
              persist({ music: v });
            }}
          />
        </label>
        <label className="mt-4 flex max-w-sm items-center justify-between gap-4 text-sm">
          Effects
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={save.sfx}
            onChange={(e) => {
              const v = Number(e.target.value);
              audio.setSfx(v);
              persist({ sfx: v });
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            audio.setMuted(!save.muted);
            persist({ muted: !save.muted });
          }}
          className="mt-6 w-fit rounded-md border border-bronze/40 px-4 py-2 font-display"
        >
          {save.muted ? "Unmute" : "Mute"}
        </button>
        <button
          type="button"
          onClick={() => setScreen("title")}
          className="mt-8 w-fit rounded-md border border-bronze/40 px-5 py-2.5 font-display"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-ink">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />
      {hud && engineRef.current && (
        <HudOverlay
          hud={hud}
          engine={engineRef.current}
          muted={save.muted}
          onMute={() => {
            audio.setMuted(!save.muted);
            persist({ muted: !save.muted });
          }}
          onAction={(id) => engineRef.current?.doAction(id)}
          onMenu={() => {
            if (engineRef.current) engineRef.current.paused = true;
            setHud((h) => (h ? { ...h, paused: true } : h));
          }}
          onResume={() => {
            if (engineRef.current) engineRef.current.paused = false;
            setHud((h) => (h ? { ...h, paused: false } : h));
          }}
          onQuit={() => {
            engineRef.current?.destroy();
            engineRef.current = null;
            setHud(null);
            setCfg(null);
            setScreen("title");
          }}
        />
      )}
    </main>
  );
}
