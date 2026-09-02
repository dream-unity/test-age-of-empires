import { useEffect, useRef } from "react";
import type { Engine, HudSnapshot } from "@/game/engine";
import { assetUrl } from "@/lib/asset";
import { Pause, Volume2, VolumeX } from "lucide-react";

type Props = {
  hud: HudSnapshot;
  engine: Engine;
  muted: boolean;
  onMute: () => void;
  onAction: (id: string) => void;
  onMenu: () => void;
  onResume: () => void;
  onQuit: () => void;
};

const RES: { key: "food" | "wood" | "gold" | "stone"; src: string; label: string }[] = [
  { key: "food", src: assetUrl("game/ui/food.png"), label: "Food" },
  { key: "wood", src: assetUrl("game/ui/wood.png"), label: "Wood" },
  { key: "gold", src: assetUrl("game/ui/gold.png"), label: "Gold" },
  { key: "stone", src: assetUrl("game/ui/stone.png"), label: "Stone" },
];

export function HudOverlay({ hud, engine, muted, onMute, onAction, onMenu, onResume, onQuit }: Props) {
  const miniRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = miniRef.current;
    if (!c) return;
    let raf = 0;
    const draw = () => {
      const ctx = c.getContext("2d");
      if (ctx) engine.drawMinimap(ctx, c.width, c.height);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  const sel = hud.selected[0];
  const many = hud.selected.length > 1;

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between text-parchment">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 border-b border-bronze/25 bg-wood/92 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-sm sm:gap-4 sm:px-4">
        {RES.map((r) => (
          <div key={r.key} className="flex items-center gap-1.5 font-display text-sm tabular-nums sm:text-base">
            <img src={r.src} alt="" className="size-7 object-contain sm:size-8" />
            <span className="min-w-8">{hud[r.key]}</span>
            <span className="sr-only">{r.label}</span>
          </div>
        ))}
        <div className="font-display text-sm tabular-nums text-bronze">
          {hud.pop}/{hud.popCap}
        </div>
        <div className="hidden font-display text-sm tracking-wide text-parchment-dim sm:block">{hud.ageName}</div>
        <div className="ml-auto flex items-center gap-1.5">
          {hud.idleVillagers > 0 && (
            <button
              type="button"
              onClick={() => onAction("idle")}
              className="min-h-11 rounded-sm border border-bronze/40 bg-wood-mid px-3 py-2 text-xs text-bronze hover:border-bronze"
            >
              Idle {hud.idleVillagers}
            </button>
          )}
          <button type="button" onClick={onMute} className="min-h-11 min-w-11 rounded-sm p-2 text-parchment-dim hover:text-parchment" aria-label="Mute">
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          <button type="button" onClick={onMenu} className="min-h-11 min-w-11 rounded-sm p-2 text-parchment-dim hover:text-parchment" aria-label="Pause">
            <Pause className="size-4" />
          </button>
        </div>
      </div>

      <div className="pointer-events-none px-3 pt-2">
        <div className="max-w-sm rounded-md border border-bronze/20 bg-ink/70 px-3 py-2 text-xs backdrop-blur-sm">
          <p className="font-display tracking-wide text-bronze uppercase">{hud.title}</p>
          <p className="mt-0.5 text-parchment">{hud.objective}</p>
        </div>
        <ul className="mt-2 flex flex-col gap-1">
          {hud.messages.map((m) => (
            <li key={m.id} className="w-fit rounded-sm bg-ink/75 px-2 py-1 text-xs text-parchment">
              {m.text}
            </li>
          ))}
        </ul>
      </div>

      <div className="pointer-events-none px-3">
        <p className="mx-auto max-w-xl rounded-md bg-ink/75 px-3 py-2 text-center text-xs text-parchment sm:text-sm">
          {hud.hint}
        </p>
      </div>

      <div className="pointer-events-auto mt-auto flex max-h-[42vh] items-stretch gap-0 border-t border-bronze/25 bg-wood/94 pb-[max(0.4rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
        <button
          type="button"
          className="relative shrink-0 border-r border-bronze/20"
          aria-label="Minimap"
          onPointerDown={(ev) => {
            const c = miniRef.current;
            if (!c) return;
            const r = c.getBoundingClientRect();
            engine.jumpMinimap(ev.clientX - r.left, ev.clientY - r.top, r.width, r.height);
          }}
        >
          <canvas
            ref={miniRef}
            width={168}
            height={168}
            className="block size-[22vmin] max-h-[120px] max-w-[120px] min-h-[88px] min-w-[88px]"
          />
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden p-2 sm:p-3">
          <div className="flex min-h-10 items-center gap-3">
            {sel ? (
              <>
                <div className="min-w-0">
                  <p className="truncate font-display text-sm sm:text-base">
                    {many ? `${hud.selected.length} selected` : sel.name}
                  </p>
                  {!many && (
                    <div className="mt-1 h-1.5 w-36 max-w-full overflow-hidden rounded-sm bg-ink">
                      <div
                        className="h-full bg-moss"
                        style={{ width: `${Math.max(0, Math.min(100, (sel.hp / sel.maxHp) * 100))}%` }}
                      />
                    </div>
                  )}
                  {!many && sel.carryAmt > 0 && (
                    <p className="text-xs text-parchment-dim">
                      Carrying {sel.carryAmt} {sel.carryRes}
                    </p>
                  )}
                </div>
                {sel.queue.length > 0 && (
                  <p className="text-xs text-bronze">
                    Queue {sel.queue.map((q) => q.type).join(", ")}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-parchment-dim">{hud.hint}</p>
            )}
            {hud.placing && <p className="text-xs text-bronze">Placing {hud.placing.replace("_", " ")}</p>}
          </div>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto pb-1">
            {hud.actions.map((a) => (
              <button
                key={a.id + a.label}
                type="button"
                disabled={a.disabled}
                onClick={() => onAction(a.id)}
                className="flex min-h-12 shrink-0 items-center gap-1.5 rounded-sm border border-bronze/30 bg-wood-mid px-3 py-2 text-left text-xs leading-tight text-parchment enabled:hover:border-bronze disabled:opacity-40"
              >
                {a.sprite && (
                  <span className="relative size-8 shrink-0 overflow-hidden rounded-sm bg-ink/60">
                    <img
                      src={assetUrl(`game/sprites/${a.sprite}.png`)}
                      alt=""
                      className={
                        a.id.startsWith("train:")
                          ? "absolute left-0 top-0 h-[400%] w-[400%] max-w-none object-left-top"
                          : "size-8 object-contain"
                      }
                    />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block font-display">{a.label}</span>
                  {a.cost && (
                    <span className="text-parchment-dim">
                      {Object.entries(a.cost)
                        .filter(([, v]) => v)
                        .map(([k, v]) => `${v} ${k}`)
                        .join(" · ")}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {(hud.paused || hud.outcome !== "playing") && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-ink/70 p-4">
          <div className="w-full max-w-md rounded-lg border border-bronze/40 bg-wood p-6 shadow-lg">
            <h2 className="font-display text-2xl text-bronze">
              {hud.outcome === "win" ? "Victory" : hud.outcome === "lose" ? "Defeat" : "Paused"}
            </h2>
            <p className="mt-2 text-sm text-parchment-dim">
              {hud.outcome === "win"
                ? "The rival hearth is broken. Your people will remember this dawn."
                : hud.outcome === "lose"
                  ? "The town center is ash. Raise another tribe from the menu."
                  : "The field waits."}
            </p>
            {hud.outcome === "playing" && (
              <ul className="mt-4 space-y-1 text-sm">
                {hud.objectives.map((o) => (
                  <li key={o.text} className={o.done ? "text-moss line-through" : ""}>
                    {o.text}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              {hud.outcome === "playing" && (
                <button
                  type="button"
                  onClick={onResume}
                  className="min-h-11 rounded-md bg-parchment px-4 py-2 font-display text-ink"
                >
                  Resume
                </button>
              )}
              <button
                type="button"
                onClick={onQuit}
                className="min-h-11 rounded-md border border-bronze/40 px-4 py-2 font-display text-parchment"
              >
                {hud.outcome === "playing" ? "Quit to menu" : "Return to menu"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}