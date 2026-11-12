// Can the tui viewer draw this page, or does it need Chrome? No dependencies:
// rex-web imports this before the tui packages are installed.

const TAGS = new Set(("html head body title meta h1 h2 h3 h4 h5 h6 p br hr b strong i em u s del ins mark code kbd samp pre a ul ol li " +
  "table thead tbody tfoot tr th td caption blockquote small span div section article main header footer nav aside " +
  "form fieldset legend label input textarea select option optgroup button").split(" "));
const CLASSES = new Set(("muted card row stack grid spacer primary danger choice mermaid stat label value badge " +
  "red green yellow blue magenta cyan").split(" "));
const BLOCKERS = /<(script|style|link|img|svg|canvas|iframe|video|audio|picture|object|embed|template|dialog|details)\b|\sstyle\s*=|\son[a-z]+\s*=|\brex\.\w+\(|javascript:/i;

// Markdown (anything not starting with a tag), or HTML using only plain
// elements and the kit classes the tui viewer knows.
export function tuiCanDraw(text: string, filename = ""): boolean {
  if (/\.(md|markdown)$/i.test(filename)) return true;
  if (/^https?:/i.test(filename)) return false;
  const body = text.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!body.startsWith("<")) return !BLOCKERS.test(body.replace(/```[\s\S]*?```/g, "")) || !/<\w/.test(body);
  if (BLOCKERS.test(body)) return false;
  for (const m of body.matchAll(/<\/?([a-zA-Z][\w-]*)/g)) if (!TAGS.has(m[1].toLowerCase())) return false;
  for (const m of body.matchAll(/\sclass\s*=\s*["']([^"']*)["']/g))
    for (const c of m[1].split(/\s+/).filter(Boolean)) if (!CLASSES.has(c) && !/^language-[\w+-]+$/.test(c)) return false;
  return true;
}
