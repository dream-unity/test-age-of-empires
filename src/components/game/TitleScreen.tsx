import type { ReactNode } from "react";
import { CIVS, type CivId } from "@/game/catalog";
import { assetUrl } from "@/lib/asset";

type Props = {
  civ: CivId;
  setCiv: (c: CivId) => void;
  difficulty: 0 | 1 | 2;
  setDifficulty: (d: 0 | 1 | 2) => void;
  onPlay: () => void;
  onHow: () => void;
  onSettings: () => void;
};

export function TitleScreen({
  civ,
  setCiv,
  difficulty,
  setDifficulty,
  onPlay,
  onHow,
  onSettings,
}: Props) {
  const selected = CIVS.find((c) => c.id === civ) ?? CIVS[0];

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-ink text-parchment">
      <img
        src={assetUrl("game/title.jpg")}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-ink/92 via-ink/70 to-ink/25" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-transparent to-ink/50" />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-8 sm:px-10 sm:py-10">
        <header className="max-w-xl pt-[max(0.5rem,env(safe-area-inset-top))]">
          <p className="font-display text-[0.7rem] tracking-[0.35em] text-bronze-dim uppercase">
            A chronicle of antiquity
          </p>
          <h1 className="mt-2 font-display text-4xl font-bold leading-tight tracking-tight text-parchment sm:text-6xl">
            Dawn of Empires
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-parchment-dim sm:text-base">
            Gather the four resources, raise a town from mud and timber, advance through the ages,
            and break the rival hearth. A living homage to classic 1997 real-time strategy.
          </p>
        </header>

        <div className="flex min-h-28 flex-1 items-center justify-center py-2">
          <button
            type="button"
            onClick={onPlay}
            className="min-h-16 min-w-56 rounded-md border border-bronze bg-wood/90 px-12 py-4 text-center font-display text-2xl tracking-[0.18em] text-parchment shadow-[0_0_32px_rgba(174,125,57,0.18)] backdrop-blur-sm transition-all duration-200 hover:bg-wood-light hover:shadow-[0_0_40px_rgba(174,125,57,0.3)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bronze"
          >
            Play
          </button>
        </div>

        <div className="grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
          <nav className="flex flex-col gap-2">
            <MenuBtn onClick={onHow}>How to Play</MenuBtn>
            <MenuBtn onClick={onSettings}>Settings</MenuBtn>
          </nav>

          <section className="rounded-lg border border-bronze/25 bg-wood/80 p-4 backdrop-blur-sm sm:p-5">
            <p className="font-display text-xs tracking-[0.22em] text-bronze uppercase">
              Civilization
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CIVS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCiv(c.id)}
                  className={`rounded-md border px-3 py-3 text-left transition-colors duration-200 ${
                    civ === c.id
                      ? "border-bronze bg-wood-light text-parchment"
                      : "border-bronze/20 bg-ink/40 text-parchment-dim hover:border-bronze/50"
                  }`}
                >
                  <span className="font-display text-sm">{c.name}</span>
                </button>
              ))}
            </div>
            <h2 className="mt-4 font-display text-xl text-bronze">{selected.name}</h2>
            <p className="text-sm italic text-parchment-dim">{selected.epithet}</p>
            <p className="mt-2 text-sm leading-relaxed">{selected.bonus}</p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs tracking-wide text-parchment-dim uppercase">
                Rival mettle
              </span>
              {(["Raider", "Warlord", "Emperor"] as const).map((label, i) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setDifficulty(i as 0 | 1 | 2)}
                  className={`rounded-full border px-3 py-1.5 text-xs ${
                    difficulty === i
                      ? "border-bronze bg-bronze text-ink"
                      : "border-bronze/30 text-parchment-dim hover:border-bronze/60"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function MenuBtn({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-bronze/30 bg-wood/85 px-4 py-3 text-left font-display text-lg tracking-wide text-parchment backdrop-blur-sm transition-colors duration-200 hover:border-bronze hover:bg-wood-light disabled:opacity-40"
    >
      {children}
    </button>
  );
}
