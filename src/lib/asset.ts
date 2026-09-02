/** Prefix public files so both Vite (`/`) and GitHub Pages (`/test-age-of-empires/`) resolve art. */
export function assetUrl(path: string): string {
  const rel = path.replace(/^\/+/, "");
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  // Pages is served from the repo root, so game files live under /public/game.
  const onPages = base.includes("/test-age-of-empires/");
  const file = onPages && rel.startsWith("game/") ? `public/${rel}` : rel;
  return `${base}${file}`;
}
