// The Rex theme as colors for the tui viewer: the terminal's fg, bg and 16
// palette colors, plus shades blended from them (as rex-view's themeVars).

export type Theme = {
  dark: boolean;
  fg: string; bg: string; palette: string[];
  accent: string; muted: string; subtle: string; border: string; surface: string;
  red: string; green: string; yellow: string; blue: string; magenta: string; cyan: string;
};

const hexRe = /^#[0-9a-f]{6}$/i;

export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, k) => Math.round(v + (y[k] - v) * t).toString(16).padStart(2, "0")).join("");
}

export function lum(h: string): number {
  const [r, g, b] = [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// fg/bg/palette as reported by the terminal (any may be missing).
export function makeTheme(fg?: string | null, bg?: string | null, palette: (string | null | undefined)[] = []): Theme {
  const ok = (c?: string | null) => (c && hexRe.test(c) ? c.toLowerCase() : undefined);
  // A pane no Rex app shows yet answers the palette but not fg/bg: guess
  // from palette 0 (black in dark themes, usually light in light ones).
  const p0 = ok(palette[0]);
  const b = ok(bg) ?? (p0 ? (lum(p0) > 0.5 ? "#ffffff" : p0) : "#1a1b26");
  const dark = lum(b) < 0.5;
  const f = ok(fg) ?? (dark ? ok(palette[15]) ?? ok(palette[7]) ?? "#c0caf5" : ok(palette[0]) ?? "#1f2328");
  const defaults = dark
    ? ["#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6"]
    : ["#e9e9ed", "#cf222e", "#116329", "#9a6700", "#0969da", "#8250df", "#1b7c83", "#6e7781"];
  const p = Array.from({ length: 16 }, (_, k) => ok(palette[k]) ?? defaults[k % 8]);
  return {
    dark, fg: f, bg: b, palette: p,
    accent: p[4], muted: mix(f, b, 0.4), subtle: mix(f, b, 0.92), border: mix(f, b, 0.75),
    surface: mix(f, b, dark ? 0.94 : 0.97),
    red: p[1], green: p[2], yellow: p[3], blue: p[4], magenta: p[5], cyan: p[6],
  };
}

export const themeKey = (t: Theme) => [t.fg, t.bg, ...t.palette].join(",");
