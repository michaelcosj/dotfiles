// SVG and Mermaid as PNGs in the theme's colors. Pele lays diagrams out
// as SVG, the theme's colors replace its CSS variables (resvg has no var()),
// and resvg rasterizes it. One font file keeps resvg fast (a few ms, versus
// seconds when it scans every system font). resvg can't read SF Pro (a
// variable font), so text is Helvetica on macOS.
import { existsSync } from "node:fs";
import { render } from "pele";
import { Resvg } from "@resvg/resvg-js";
import { mix, type Theme } from "./theme.ts";

const FONT = ["/System/Library/Fonts/Helvetica.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/TTF/DejaVuSans.ttf"].find(existsSync);

// The family name resvg knows the font file by.
const FAMILY = FONT?.includes("Helvetica") ? "Helvetica" : "DejaVu Sans";

export type Diagram = { svg: string; width: number; height: number };

export function layout(source: string): Diagram | { error: string } {
  try {
    const { svg } = render(source);
    const m = /<svg\b[^>]*?\bwidth="([\d.]+)"[^>]*?\bheight="([\d.]+)"/.exec(svg);
    return { svg, width: m ? Math.ceil(Number(m[1])) : 600, height: m ? Math.ceil(Number(m[2])) : 400 };
  } catch (e: any) {
    return { error: String(e?.message || e).split("\n")[0] };
  }
}

function vars(t: Theme): Record<string, string> {
  const series = [t.blue, t.green, t.yellow, t.magenta, t.cyan, t.red, t.palette[12], t.palette[10]];
  return {
    "--pele-bg": t.bg, "--pele-fg": t.fg, "--pele-line": mix(t.fg, t.bg, 0.15), "--pele-muted": t.muted,
    "--pele-border": t.border, "--pele-surface": t.surface, "--pele-surface-alt": mix(t.fg, t.bg, t.dark ? 0.86 : 0.9),
    "--pele-accent": t.accent, "--pele-font": FAMILY,
    ...Object.fromEntries(series.map((c, k) => [`--pele-series-${k + 1}`, c])),
  };
}

// Swaps CSS variables for values, a few levels deep (Pele defines its own
// from --pele-* ones), then drops custom property declarations: resvg
// rejects a style attribute that has any.
function resolve(svg: string, set: Record<string, string>): string {
  for (let i = 0; i < 5; i++) {
    const known: Record<string, string> = {};
    for (const m of svg.matchAll(/(--[\w-]+)\s*:\s*([^;"]+)/g)) if (!m[2].includes("var(")) known[m[1]] = m[2].trim();
    Object.assign(known, set);
    const next = svg.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*?))?\s*\)/g, (m, n, f) => known[n] ?? f ?? m);
    if (next === svg) break;
    svg = next;
  }
  // resvg reads font-family from attributes more reliably than from the font shorthand
  svg = svg.replace(/^<svg /, `<svg font-family="${FAMILY}" `);
  return svg.replace(/style="([^"]*)"/g, (_, s) => `style="${s.replace(/--[\w-]+\s*:[^;]*;?/g, "").replace(/(^|;)\s*font(-family)?\s*:[^;]*/g, "$1")}"`)
    .replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_, a, css, b) => a + css.replace(/--[\w-]+\s*:[^;}]*;?/g, "") + b);
}

// An SVG as a PNG in the theme's colors. `width`/`height` are its own size
// (so a small icon stays small); the PNG is 2x that for sharpness, and at
// most 2x `maxWidthPx`.
export function svgToPng(svg: string, t: Theme, maxWidthPx: number): { png: Uint8Array; width: number; height: number } {
  const colors = Object.fromEntries(["fg", "bg", "accent", "muted", "border", "surface", "red", "green", "yellow", "blue", "magenta", "cyan"].map(k => [`--${k}`, t[k as keyof Theme] as string]));
  const font = FONT ? { loadSystemFonts: false, fontFiles: [FONT], defaultFontFamily: FAMILY } : { loadSystemFonts: true };
  const source = resolve(svg.replace(/currentColor/g, t.fg), colors);
  const own = new Resvg(source, { font });
  const width = Math.min(own.width, Math.max(1, maxWidthPx)), height = own.height * width / own.width;
  const png = new Resvg(source, { fitTo: { mode: "width", value: Math.round(width * 2) }, font }).render().asPng();
  return { png, width, height };
}

// PNG at most `width` px wide (and never more than 3x the layout size).
export function rasterize(d: Diagram, t: Theme, width: number): Uint8Array {
  const w = Math.max(64, Math.min(width, d.width * 3));
  const r = new Resvg(resolve(d.svg, vars(t)), {
    fitTo: { mode: "width", value: Math.round(w) },
    font: FONT ? { loadSystemFonts: false, fontFiles: [FONT], defaultFontFamily: FAMILY, sansSerifFamily: FAMILY } : { loadSystemFonts: true },
  });
  return r.render().asPng();
}
