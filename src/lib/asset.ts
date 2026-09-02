/** Prefix public files with Vite's base so GitHub Pages (`/test-age-of-empires/`) works. */
export function assetUrl(path: string): string {
  const rel = path.replace(/^\/+/, "");
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${base}${rel}`;
}
