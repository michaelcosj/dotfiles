-- Rex colorscheme: builds Neovim highlights from the Rex terminal's theme
-- (default fg/bg and the 16 ANSI colors) and follows theme changes.
--
-- Queries: OSC 10 (fg), OSC 11 (bg) and OSC 4;0..15 (palette), ended by DA1.
-- Replies arrive through the TermResponse autocmd; DA1 commits a reply set.
--
-- What Rex and Neovim 0.12 do (probed in Rex panes):
-- - TermResponse delivers OSC 4, OSC 10 and OSC 11 replies, DA1, DSR and DCS.
-- - The CSI ? 997 ; 1|2 n theme notification does NOT reach TermResponse. The
--   TUI eats it, re-queries OSC 11 (+ DSR) itself, and that OSC 11 reply does
--   reach TermResponse. An OSC 11 reply we did not ask for therefore means
--   "theme changed" and triggers a full query.
-- - Rex sends 997 only when the scheme flips between light and dark. After a
--   switch from one dark theme to another, restart Neovim (nothing is sent).
-- - A pane that no Rex app owns yet answers OSC 4 with the built-in palette
--   and does not answer OSC 10/11 at all. A reply set without a bg is
--   treated as provisional: it is never cached and only used when nothing
--   better is known.
local M = {}

local api = vim.api
local cache_path = vim.fn.stdpath("state") .. "/rex-theme.json"

-- tokyonight "night" until Rex answers and there is no cache.
local fallback = {
	bg = "#1a1b26",
	fg = "#c0caf5",
	palette = {
		"#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6",
		"#414868", "#ff899d", "#9fe044", "#faba4a", "#8db0ff", "#c7a9ff", "#a4daff", "#c0caf5",
	},
}

function M.in_rex()
	return vim.env.REX_BLOCK ~= nil or vim.env.REX_SESSION ~= nil or vim.env.TERM_PROGRAM == "rex"
end

-- [[ Color math ]]

local function rgb(hex)
	return tonumber(hex:sub(2, 3), 16), tonumber(hex:sub(4, 5), 16), tonumber(hex:sub(6, 7), 16)
end

local function hex(r, g, b)
	local function c(x) return math.max(0, math.min(255, math.floor(x + 0.5))) end
	return string.format("#%02x%02x%02x", c(r), c(g), c(b))
end

-- a over b, t = weight of a (0..1)
local function mix(a, b, t)
	local ar, ag, ab = rgb(a)
	local br, bg, bb = rgb(b)
	return hex(ar * t + br * (1 - t), ag * t + bg * (1 - t), ab * t + bb * (1 - t))
end

local function luminance(c)
	local function ch(x)
		x = x / 255
		return x <= 0.03928 and x / 12.92 or ((x + 0.055) / 1.055) ^ 2.4
	end
	local r, g, b = rgb(c)
	return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
end

local function contrast(a, b)
	local la, lb = luminance(a), luminance(b)
	if la < lb then la, lb = lb, la end
	return (la + 0.05) / (lb + 0.05)
end

-- Chroma (0..1): how far a color is from gray.
local function chroma(c)
	local r, g, b = rgb(c)
	return (math.max(r, g, b) - math.min(r, g, b)) / 255
end

-- An accent that reads on bg: the base ANSI color if it reaches min, else
-- the bright one if it does and still has a hue (Solarized's "brights" are
-- grays), else the base color pushed away from bg (darker on light themes,
-- lighter on dark ones) until it reaches min.
local function readable(bg, min, base, bright)
	if contrast(base, bg) >= min then return base end
	if bright and contrast(bright, bg) >= min and chroma(bright) >= 0.5 * chroma(base) then return bright end
	local toward = luminance(bg) > 0.18 and "#000000" or "#ffffff"
	for t = 0.05, 0.6, 0.05 do
		local c = mix(toward, base, t)
		if contrast(c, bg) >= min then return c end
	end
	return mix(toward, base, 0.6)
end


-- [[ Palette ]]

local function valid(theme)
	if type(theme) ~= "table" or type(theme.bg) ~= "string" or type(theme.fg) ~= "string" then return false end
	if type(theme.palette) ~= "table" then return false end
	for i = 1, 16 do
		if type(theme.palette[i]) ~= "string" or not theme.palette[i]:match("^#%x%x%x%x%x%x$") then return false end
	end
	return theme.bg:match("^#%x%x%x%x%x%x$") and theme.fg:match("^#%x%x%x%x%x%x$") and true or false
end

local function read_cache()
	local ok, lines = pcall(vim.fn.readfile, cache_path)
	if not ok or #lines == 0 then return nil end
	local ok2, t = pcall(vim.json.decode, table.concat(lines, "\n"))
	return ok2 and valid(t) and t or nil
end

local function write_cache(theme)
	pcall(vim.fn.mkdir, vim.fn.fnamemodify(cache_path, ":h"), "p")
	pcall(vim.fn.writefile, { vim.json.encode({ bg = theme.bg, fg = theme.fg, palette = theme.palette }) }, cache_path)
end

-- The theme in use: { bg, fg, palette = { 16 colors, 1-based } }
function M.theme()
	if not M.current then M.current = read_cache() or vim.deepcopy(fallback) end
	return M.current
end

-- Semantic colors derived from the theme.
function M.colors(theme)
	theme = theme or M.theme()
	local p, bg, fg = theme.palette, theme.bg, theme.fg
	local light = luminance(bg) > 0.18
	local c = { bg = bg, fg = fg, light = light, none = "NONE" }

	-- Accents: normal ANSI color, else the bright one if it reads better.
	local min = 3.0
	c.red = readable(bg, min, p[2], p[10])
	c.green = readable(bg, min, p[3], p[11])
	c.yellow = readable(bg, min, p[4], p[12])
	c.blue = readable(bg, min, p[5], p[13])
	c.magenta = readable(bg, min, p[6], p[14])
	c.cyan = readable(bg, min, p[7], p[15])
	c.orange = readable(bg, min, mix(c.red, c.yellow, 0.5))
	-- Bright variants for emphasis (matches, builtins); fall back to normal.
	local function bright(base, br)
		if light or contrast(br, bg) < min or chroma(br) < 0.5 * chroma(base) then return base end
		return br
	end
	c.bright_blue = bright(c.blue, p[13])
	c.bright_magenta = bright(c.magenta, p[14])
	c.bright_cyan = bright(c.cyan, p[15])

	-- Neutrals blended between bg and fg.
	c.bg1 = mix(fg, bg, 0.05) -- cursorline, subtle surfaces
	c.bg2 = mix(fg, bg, 0.09) -- popup menu, float surfaces
	c.bg3 = mix(fg, bg, 0.15) -- selected item, statusline sections
	c.border = mix(fg, bg, 0.28)
	c.nontext = mix(fg, bg, 0.24)
	c.linenr = mix(fg, bg, 0.34)
	c.fg_dim = mix(fg, bg, 0.75)
	-- Comments: ANSI bright black when it sits between bg and fg, readable but
	-- quieter than text; otherwise a fg/bg blend.
	local cb, cf = contrast(p[9], bg), contrast(fg, bg)
	if cb >= 2.5 and cb < cf * 0.8 and (luminance(p[9]) - luminance(bg)) * (luminance(fg) - luminance(bg)) > 0 then
		c.comment = p[9]
	else
		local want = math.min(2.6, cf * 0.7)
		for t = 0.5, 1.0, 0.05 do
			c.comment = mix(fg, bg, t)
			if contrast(c.comment, bg) >= want then break end
		end
	end
	c.punct = mix(fg, bg, 0.72)

	-- Tinted backgrounds.
	local k = light and 1.3 or 1.0
	c.visual = mix(c.blue, bg, 0.22 * k)
	c.search = mix(c.yellow, bg, 0.30 * k)
	c.incsearch = c.orange
	c.diff_add = mix(c.green, bg, 0.14 * k)
	c.diff_delete = mix(c.red, bg, 0.14 * k)
	c.diff_change = mix(c.blue, bg, 0.10 * k)
	c.diff_text = mix(c.blue, bg, 0.26 * k)
	c.diff_text_add = mix(c.green, bg, 0.28 * k)
	c.diff_text_delete = mix(c.red, bg, 0.28 * k)
	c.ref = mix(c.fg, bg, 0.13)
	for _, n in ipairs({ "red", "yellow", "blue", "cyan", "green" }) do
		c[n .. "_tint"] = mix(c[n], bg, 0.10 * k)
	end
	return c
end

-- [[ Highlights ]]

local function groups(c)
	local none = c.none
	local hl = {
		-- Editor
		Normal = { fg = c.fg },
		NormalNC = { fg = c.fg },
		NormalFloat = { fg = c.fg },
		FloatBorder = { fg = c.border },
		FloatTitle = { fg = c.blue, bold = true },
		FloatFooter = { fg = c.comment },
		WinSeparator = { fg = c.border },
		VertSplit = { link = "WinSeparator" },
		Cursor = { fg = c.bg, bg = c.fg },
		lCursor = { link = "Cursor" },
		CursorIM = { link = "Cursor" },
		TermCursor = { fg = c.bg, bg = c.fg },
		CursorLine = { bg = c.bg1 },
		CursorColumn = { bg = c.bg1 },
		ColorColumn = { bg = c.bg1 },
		CursorLineNr = { fg = c.orange, bold = true },
		LineNr = { fg = c.linenr },
		LineNrAbove = { link = "LineNr" },
		LineNrBelow = { link = "LineNr" },
		SignColumn = { fg = c.linenr },
		FoldColumn = { fg = c.linenr },
		Folded = { fg = c.blue, bg = c.bg2 },
		NonText = { fg = c.nontext },
		Whitespace = { fg = c.nontext },
		SpecialKey = { fg = c.nontext },
		EndOfBuffer = { fg = c.nontext },
		Conceal = { fg = c.comment },
		Directory = { fg = c.blue },
		Title = { fg = c.blue, bold = true },
		Question = { fg = c.blue },
		MoreMsg = { fg = c.blue },
		ModeMsg = { fg = c.fg_dim, bold = true },
		MsgArea = { fg = c.fg },
		MsgSeparator = { fg = c.border },
		ErrorMsg = { fg = c.red },
		WarningMsg = { fg = c.yellow },
		OkMsg = { fg = c.green },
		Visual = { bg = c.visual },
		VisualNOS = { bg = c.visual },
		Search = { fg = c.fg, bg = c.search },
		CurSearch = { fg = c.bg, bg = c.incsearch, bold = true },
		IncSearch = { fg = c.bg, bg = c.incsearch },
		Substitute = { fg = c.bg, bg = c.red },
		MatchParen = { fg = c.orange, bold = true, underline = true },
		QuickFixLine = { bg = c.visual, bold = true },
		WildMenu = { bg = c.visual },
		Pmenu = { fg = c.fg, bg = c.bg2 },
		PmenuSel = { bg = c.bg3, bold = true },
		PmenuSbar = { bg = c.bg2 },
		PmenuThumb = { bg = c.border },
		PmenuKind = { fg = c.cyan, bg = c.bg2 },
		PmenuKindSel = { fg = c.cyan, bg = c.bg3 },
		PmenuExtra = { fg = c.comment, bg = c.bg2 },
		PmenuExtraSel = { fg = c.comment, bg = c.bg3 },
		PmenuMatch = { fg = c.bright_cyan, bg = c.bg2, bold = true },
		PmenuMatchSel = { fg = c.bright_cyan, bg = c.bg3, bold = true },
		ComplMatchIns = { fg = c.comment },
		StatusLine = { fg = c.fg_dim, bg = c.bg2 },
		StatusLineNC = { fg = c.comment, bg = c.bg1 },
		StatusLineTerm = { link = "StatusLine" },
		StatusLineTermNC = { link = "StatusLineNC" },
		TabLine = { fg = c.comment, bg = c.bg1 },
		TabLineFill = { bg = none },
		TabLineSel = { fg = c.fg, bg = c.bg3, bold = true },
		WinBar = { fg = c.fg_dim, bold = true },
		WinBarNC = { fg = c.comment },
		SpellBad = { sp = c.red, undercurl = true },
		SpellCap = { sp = c.yellow, undercurl = true },
		SpellLocal = { sp = c.cyan, undercurl = true },
		SpellRare = { sp = c.magenta, undercurl = true },

		-- Diff
		DiffAdd = { bg = c.diff_add },
		DiffChange = { bg = c.diff_change },
		DiffDelete = { bg = c.diff_delete },
		DiffText = { bg = c.diff_text },
		DiffTextAdd = { bg = c.diff_text_add },
		Added = { fg = c.green },
		Changed = { fg = c.blue },
		Removed = { fg = c.red },
		diffAdded = { fg = c.green },
		diffRemoved = { fg = c.red },
		diffChanged = { fg = c.blue },
		diffOldFile = { fg = c.red },
		diffNewFile = { fg = c.green },
		diffFile = { fg = c.blue },
		diffLine = { fg = c.comment },
		diffIndexLine = { fg = c.magenta },

		-- Syntax
		Comment = { fg = c.comment, italic = true },
		Constant = { fg = c.orange },
		String = { fg = c.green },
		Character = { fg = c.green },
		Number = { fg = c.orange },
		Boolean = { fg = c.orange },
		Float = { link = "Number" },
		Identifier = { fg = c.fg },
		Function = { fg = c.blue },
		Statement = { fg = c.magenta },
		Conditional = { fg = c.magenta },
		Repeat = { fg = c.magenta },
		Label = { fg = c.magenta },
		Operator = { fg = c.cyan },
		Keyword = { fg = c.magenta, italic = true },
		Exception = { fg = c.magenta },
		PreProc = { fg = c.cyan },
		Include = { fg = c.magenta },
		Define = { fg = c.magenta },
		Macro = { fg = c.cyan },
		PreCondit = { fg = c.cyan },
		Type = { fg = c.yellow },
		StorageClass = { fg = c.magenta },
		Structure = { fg = c.yellow },
		Typedef = { fg = c.yellow },
		Special = { fg = c.cyan },
		SpecialChar = { fg = c.orange },
		Tag = { fg = c.blue },
		Delimiter = { fg = c.punct },
		SpecialComment = { fg = c.comment, bold = true },
		Debug = { fg = c.orange },
		Underlined = { underline = true },
		Bold = { bold = true },
		Italic = { italic = true },
		Ignore = { fg = c.nontext },
		Error = { fg = c.red },
		Todo = { fg = c.bg, bg = c.yellow, bold = true },

		-- Treesitter
		["@variable"] = { fg = c.fg },
		["@variable.builtin"] = { fg = c.red, italic = true },
		["@variable.parameter"] = { fg = c.fg, italic = true },
		["@variable.parameter.builtin"] = { fg = c.red, italic = true },
		["@variable.member"] = { fg = c.cyan },
		["@constant"] = { fg = c.orange },
		["@constant.builtin"] = { fg = c.orange, italic = true },
		["@constant.macro"] = { fg = c.cyan },
		["@module"] = { fg = c.yellow },
		["@module.builtin"] = { fg = c.red },
		["@label"] = { fg = c.blue },
		["@string"] = { link = "String" },
		["@string.documentation"] = { fg = c.comment },
		["@string.regexp"] = { fg = c.bright_cyan },
		["@string.escape"] = { fg = c.magenta },
		["@string.special"] = { fg = c.cyan },
		["@string.special.symbol"] = { fg = c.orange },
		["@string.special.url"] = { fg = c.cyan, underline = true },
		["@string.special.path"] = { fg = c.cyan },
		["@character"] = { link = "Character" },
		["@character.special"] = { fg = c.magenta },
		["@boolean"] = { link = "Boolean" },
		["@number"] = { link = "Number" },
		["@number.float"] = { link = "Number" },
		["@type"] = { link = "Type" },
		["@type.builtin"] = { fg = c.yellow, italic = true },
		["@type.definition"] = { link = "Type" },
		["@attribute"] = { fg = c.cyan },
		["@attribute.builtin"] = { fg = c.cyan, italic = true },
		["@property"] = { fg = c.cyan },
		["@function"] = { link = "Function" },
		["@function.builtin"] = { fg = c.bright_cyan },
		["@function.call"] = { link = "Function" },
		["@function.macro"] = { fg = c.cyan },
		["@function.method"] = { link = "Function" },
		["@function.method.call"] = { link = "Function" },
		["@constructor"] = { fg = c.yellow },
		["@operator"] = { link = "Operator" },
		["@keyword"] = { link = "Keyword" },
		["@keyword.coroutine"] = { fg = c.magenta, italic = true },
		["@keyword.function"] = { fg = c.magenta, italic = true },
		["@keyword.operator"] = { fg = c.magenta },
		["@keyword.import"] = { fg = c.magenta },
		["@keyword.type"] = { fg = c.magenta },
		["@keyword.modifier"] = { fg = c.magenta },
		["@keyword.repeat"] = { link = "Repeat" },
		["@keyword.return"] = { fg = c.magenta, italic = true },
		["@keyword.debug"] = { link = "Debug" },
		["@keyword.exception"] = { link = "Exception" },
		["@keyword.conditional"] = { link = "Conditional" },
		["@keyword.directive"] = { link = "PreProc" },
		["@punctuation"] = { fg = c.punct },
		["@punctuation.delimiter"] = { fg = c.punct },
		["@punctuation.bracket"] = { fg = c.punct },
		["@punctuation.special"] = { fg = c.cyan },
		["@comment"] = { link = "Comment" },
		["@comment.documentation"] = { link = "Comment" },
		["@comment.error"] = { fg = c.red, bold = true },
		["@comment.warning"] = { fg = c.yellow, bold = true },
		["@comment.todo"] = { fg = c.blue, bold = true },
		["@comment.note"] = { fg = c.cyan, bold = true },
		["@markup.strong"] = { bold = true },
		["@markup.italic"] = { italic = true },
		["@markup.strikethrough"] = { strikethrough = true },
		["@markup.underline"] = { underline = true },
		["@markup.heading"] = { fg = c.blue, bold = true },
		["@markup.heading.1"] = { fg = c.blue, bold = true },
		["@markup.heading.2"] = { fg = c.yellow, bold = true },
		["@markup.heading.3"] = { fg = c.green, bold = true },
		["@markup.heading.4"] = { fg = c.cyan, bold = true },
		["@markup.heading.5"] = { fg = c.magenta, bold = true },
		["@markup.heading.6"] = { fg = c.orange, bold = true },
		["@markup.quote"] = { fg = c.fg_dim, italic = true },
		["@markup.math"] = { fg = c.cyan },
		["@markup.link"] = { fg = c.cyan },
		["@markup.link.label"] = { fg = c.blue },
		["@markup.link.url"] = { fg = c.cyan, underline = true },
		["@markup.raw"] = { fg = c.green },
		["@markup.raw.block"] = { fg = c.fg },
		["@markup.list"] = { fg = c.orange },
		["@markup.list.checked"] = { fg = c.green },
		["@markup.list.unchecked"] = { fg = c.comment },
		["@diff.plus"] = { link = "Added" },
		["@diff.minus"] = { link = "Removed" },
		["@diff.delta"] = { link = "Changed" },
		["@tag"] = { fg = c.red },
		["@tag.builtin"] = { fg = c.red },
		["@tag.attribute"] = { fg = c.cyan, italic = true },
		["@tag.delimiter"] = { fg = c.punct },
		TreesitterContext = { bg = c.bg1 },
		TreesitterContextLineNumber = { fg = c.linenr, bg = c.bg1 },
		TreesitterContextBottom = { sp = c.border, underline = true },

		-- LSP
		["@lsp.type.namespace"] = { link = "@module" },
		["@lsp.type.parameter"] = { link = "@variable.parameter" },
		["@lsp.type.property"] = { link = "@property" },
		["@lsp.type.enumMember"] = { link = "@constant" },
		["@lsp.type.interface"] = { fg = c.yellow, italic = true },
		["@lsp.type.typeParameter"] = { fg = c.yellow, italic = true },
		["@lsp.type.builtinType"] = { link = "@type.builtin" },
		["@lsp.type.selfKeyword"] = { link = "@variable.builtin" },
		["@lsp.type.unresolvedReference"] = { sp = c.red, undercurl = true },
		["@lsp.typemod.variable.readonly"] = { fg = c.orange },
		["@lsp.typemod.variable.defaultLibrary"] = { link = "@variable.builtin" },
		["@lsp.typemod.function.defaultLibrary"] = { link = "@function.builtin" },
		LspReferenceText = { bg = c.ref },
		LspReferenceRead = { bg = c.ref },
		LspReferenceWrite = { bg = c.ref, underline = true },
		LspReferenceTarget = { bg = c.ref },
		LspInlayHint = { fg = c.comment, bg = c.bg1, italic = true },
		LspCodeLens = { fg = c.comment },
		LspCodeLensSeparator = { fg = c.nontext },
		LspSignatureActiveParameter = { fg = c.orange, bold = true, underline = true },
		LspInfoBorder = { link = "FloatBorder" },

		-- Diagnostics
		DiagnosticError = { fg = c.red },
		DiagnosticWarn = { fg = c.yellow },
		DiagnosticInfo = { fg = c.blue },
		DiagnosticHint = { fg = c.cyan },
		DiagnosticOk = { fg = c.green },
		DiagnosticUnnecessary = { fg = c.comment },
		DiagnosticDeprecated = { strikethrough = true },
		DiagnosticVirtualTextError = { fg = c.red, bg = c.red_tint },
		DiagnosticVirtualTextWarn = { fg = c.yellow, bg = c.yellow_tint },
		DiagnosticVirtualTextInfo = { fg = c.blue, bg = c.blue_tint },
		DiagnosticVirtualTextHint = { fg = c.cyan, bg = c.cyan_tint },
		DiagnosticVirtualTextOk = { fg = c.green, bg = c.green_tint },
		DiagnosticUnderlineError = { sp = c.red, undercurl = true },
		DiagnosticUnderlineWarn = { sp = c.yellow, undercurl = true },
		DiagnosticUnderlineInfo = { sp = c.blue, undercurl = true },
		DiagnosticUnderlineHint = { sp = c.cyan, undercurl = true },
		DiagnosticUnderlineOk = { sp = c.green, undercurl = true },

		-- gitsigns
		GitSignsAdd = { fg = c.green },
		GitSignsChange = { fg = c.blue },
		GitSignsDelete = { fg = c.red },
		GitSignsUntracked = { fg = c.comment },
		GitSignsAddInline = { bg = c.diff_text_add },
		GitSignsDeleteInline = { bg = c.diff_text_delete },
		GitSignsChangeInline = { bg = c.diff_text },
		GitSignsAddPreview = { link = "DiffAdd" },
		GitSignsDeletePreview = { link = "DiffDelete" },
		GitSignsCurrentLineBlame = { fg = c.comment, italic = true },

		-- mini.diff
		MiniDiffSignAdd = { fg = c.green },
		MiniDiffSignChange = { fg = c.blue },
		MiniDiffSignDelete = { fg = c.red },
		MiniDiffOverAdd = { link = "DiffAdd" },
		MiniDiffOverChange = { link = "DiffText" },
		MiniDiffOverChangeBuf = { link = "MiniDiffOverChange" },
		MiniDiffOverContext = { link = "DiffChange" },
		MiniDiffOverContextBuf = {},
		MiniDiffOverDelete = { link = "DiffDelete" },

		-- mini.icons
		MiniIconsAzure = { fg = c.blue },
		MiniIconsBlue = { fg = c.blue },
		MiniIconsCyan = { fg = c.cyan },
		MiniIconsGreen = { fg = c.green },
		MiniIconsGrey = { fg = c.fg_dim },
		MiniIconsOrange = { fg = c.orange },
		MiniIconsPurple = { fg = c.magenta },
		MiniIconsRed = { fg = c.red },
		MiniIconsYellow = { fg = c.yellow },

		-- snacks
		SnacksNormal = { fg = c.fg },
		SnacksWinBar = { link = "Title" },
		SnacksBackdrop = { bg = c.bg },
		SnacksIndent = { fg = c.nontext, nocombine = true },
		SnacksIndentScope = { fg = c.blue, nocombine = true },
		SnacksDashboardHeader = { fg = c.blue },
		SnacksDashboardIcon = { fg = c.bright_cyan },
		SnacksDashboardKey = { fg = c.orange },
		SnacksDashboardDesc = { fg = c.cyan },
		SnacksDashboardFooter = { fg = c.comment },
		SnacksDashboardSpecial = { fg = c.magenta },
		SnacksDashboardDir = { fg = c.comment },
		SnacksPickerBorder = { link = "FloatBorder" },
		SnacksPickerTitle = { fg = c.orange, bold = true },
		SnacksPickerInputBorder = { fg = c.orange },
		SnacksPickerInputTitle = { fg = c.orange, bold = true },
		SnacksPickerBoxTitle = { fg = c.orange, bold = true },
		SnacksPickerPrompt = { fg = c.orange },
		SnacksPickerMatch = { fg = c.bright_cyan, bold = true },
		SnacksPickerSelected = { fg = c.magenta },
		SnacksPickerDir = { fg = c.comment },
		SnacksPickerFile = { fg = c.fg },
		SnacksPickerCursorLine = { bg = c.bg3 },
		SnacksPickerListCursorLine = { bg = c.bg3 },
		SnacksPickerPreviewCursorLine = { bg = c.bg1 },
		SnacksPickerPickWinCurrent = { fg = c.bg, bg = c.magenta, bold = true },
		SnacksPickerPickWin = { fg = c.bg, bg = c.blue, bold = true },
		SnacksPickerToggle = { fg = c.blue, bg = c.blue_tint },
		SnacksInputIcon = { fg = c.blue },
		SnacksInputBorder = { fg = c.yellow },
		SnacksInputTitle = { fg = c.yellow },
		SnacksNotifierInfo = { fg = c.fg },
		SnacksNotifierWarn = { fg = c.fg },
		SnacksNotifierError = { fg = c.fg },
		SnacksNotifierDebug = { fg = c.fg },
		SnacksNotifierTrace = { fg = c.fg },
		SnacksNotifierBorderInfo = { fg = mix(c.blue, c.bg, 0.5) },
		SnacksNotifierBorderWarn = { fg = mix(c.yellow, c.bg, 0.5) },
		SnacksNotifierBorderError = { fg = mix(c.red, c.bg, 0.5) },
		SnacksNotifierBorderDebug = { fg = c.border },
		SnacksNotifierBorderTrace = { fg = mix(c.magenta, c.bg, 0.5) },
		SnacksNotifierIconInfo = { fg = c.blue },
		SnacksNotifierIconWarn = { fg = c.yellow },
		SnacksNotifierIconError = { fg = c.red },
		SnacksNotifierIconDebug = { fg = c.comment },
		SnacksNotifierIconTrace = { fg = c.magenta },
		SnacksNotifierTitleInfo = { fg = c.blue },
		SnacksNotifierTitleWarn = { fg = c.yellow },
		SnacksNotifierTitleError = { fg = c.red },
		SnacksNotifierTitleDebug = { fg = c.comment },
		SnacksNotifierTitleTrace = { fg = c.magenta },

		-- which-key
		WhichKey = { fg = c.cyan },
		WhichKeyGroup = { fg = c.blue },
		WhichKeyDesc = { fg = c.magenta },
		WhichKeySeparator = { fg = c.comment },
		WhichKeyNormal = { fg = c.fg },
		WhichKeyBorder = { link = "FloatBorder" },
		WhichKeyTitle = { link = "FloatTitle" },
		WhichKeyValue = { fg = c.comment },

		-- blink.cmp
		BlinkCmpMenu = { link = "Pmenu" },
		BlinkCmpMenuBorder = { fg = c.border, bg = c.bg2 },
		BlinkCmpMenuSelection = { link = "PmenuSel" },
		BlinkCmpScrollBarThumb = { link = "PmenuThumb" },
		BlinkCmpScrollBarGutter = { link = "PmenuSbar" },
		BlinkCmpLabel = { fg = c.fg },
		BlinkCmpLabelMatch = { fg = c.bright_cyan, bold = true },
		BlinkCmpLabelDeprecated = { fg = c.comment, strikethrough = true },
		BlinkCmpLabelDetail = { fg = c.comment },
		BlinkCmpLabelDescription = { fg = c.comment },
		BlinkCmpKind = { fg = c.cyan },
		BlinkCmpSource = { fg = c.comment },
		BlinkCmpGhostText = { fg = c.comment, italic = true },
		BlinkCmpDoc = { fg = c.fg, bg = c.bg2 },
		BlinkCmpDocBorder = { fg = c.border, bg = c.bg2 },
		BlinkCmpDocSeparator = { fg = c.border, bg = c.bg2 },
		BlinkCmpSignatureHelp = { fg = c.fg, bg = c.bg2 },
		BlinkCmpSignatureHelpBorder = { fg = c.border, bg = c.bg2 },
		BlinkCmpSignatureHelpActiveParameter = { link = "LspSignatureActiveParameter" },

		-- render-markdown
		RenderMarkdownCode = { bg = c.bg1 },
		RenderMarkdownCodeInline = { fg = c.green, bg = c.bg1 },
		RenderMarkdownBullet = { fg = c.orange },
		RenderMarkdownDash = { fg = c.border },
		RenderMarkdownTableHead = { fg = c.blue },
		RenderMarkdownTableRow = { fg = c.border },
		RenderMarkdownQuote = { fg = c.comment },
		RenderMarkdownChecked = { fg = c.green },
		RenderMarkdownUnchecked = { fg = c.comment },
		RenderMarkdownLink = { fg = c.cyan },

		-- neogit
		NeogitBranch = { fg = c.magenta, bold = true },
		NeogitBranchHead = { fg = c.magenta, bold = true, underline = true },
		NeogitRemote = { fg = c.cyan, bold = true },
		NeogitHunkHeader = { fg = c.fg_dim, bg = c.bg2 },
		NeogitHunkHeaderHighlight = { fg = c.blue, bg = c.bg3, bold = true },
		NeogitHunkHeaderCursor = { fg = c.blue, bg = c.bg3, bold = true },
		NeogitDiffContext = { fg = c.fg_dim },
		NeogitDiffContextHighlight = { fg = c.fg, bg = c.bg1 },
		NeogitDiffContextCursor = { bg = c.bg1 },
		NeogitDiffAdd = { fg = c.green, bg = c.diff_add },
		NeogitDiffAddHighlight = { fg = c.green, bg = c.diff_add },
		NeogitDiffAddCursor = { fg = c.green, bg = c.diff_text_add },
		NeogitDiffDelete = { fg = c.red, bg = c.diff_delete },
		NeogitDiffDeleteHighlight = { fg = c.red, bg = c.diff_delete },
		NeogitDiffDeleteCursor = { fg = c.red, bg = c.diff_text_delete },
		NeogitSectionHeader = { fg = c.magenta, bold = true },
		NeogitChangeModified = { fg = c.blue, bold = true },
		NeogitChangeAdded = { fg = c.green, bold = true },
		NeogitChangeDeleted = { fg = c.red, bold = true },
		NeogitChangeRenamed = { fg = c.magenta, bold = true },
		NeogitChangeNewFile = { fg = c.green, bold = true },
		NeogitObjectId = { fg = c.comment },
		NeogitFloatHeader = { bg = c.bg2, bold = true },
		NeogitFloatHeaderHighlight = { fg = c.cyan, bg = c.bg3, bold = true },

		-- codediff (line colors derive from DiffAdd/DiffDelete on ColorScheme)
		CodeDiffFiller = { fg = c.nontext },
		CodeDiffMoveFrom = { fg = c.blue },
		CodeDiffMoveTo = { fg = c.blue },

		-- quicker
		QuickFixHeaderHard = { fg = c.border },
		QuickFixHeaderSoft = { fg = c.nontext },
		QuickFixFilename = { fg = c.blue },
		QuickFixLineNr = { fg = c.linenr },
		qfFileName = { fg = c.blue },
		qfLineNr = { fg = c.linenr },

		-- todo-comments derives its colors from Diagnostic*/Todo on ColorScheme.
	}
	return hl
end

-- Applies the theme. Called by colors/rex.lua.
function M.load()
	local theme = M.theme()
	local c = M.colors(theme)
	vim.cmd("hi clear")
	-- Setting 'background' reloads g:colors_name, so set it while unset.
	vim.g.colors_name = nil
	local want = c.light and "light" or "dark"
	if vim.o.background ~= want then vim.o.background = want end
	vim.g.colors_name = "rex"
	for name, spec in pairs(groups(c)) do
		api.nvim_set_hl(0, name, spec)
	end
	for i = 0, 15 do
		vim.g["terminal_color_" .. i] = theme.palette[i + 1]
	end
end

-- lualine theme (lua/lualine/themes/rex.lua returns this).
function M.lualine()
	local c = M.colors()
	local function mode(color)
		return {
			a = { fg = c.bg, bg = color, gui = "bold" },
			b = { fg = color, bg = c.bg3 },
			c = { fg = c.fg_dim, bg = c.none },
		}
	end
	return {
		normal = mode(c.blue),
		insert = mode(c.green),
		visual = mode(c.magenta),
		replace = mode(c.red),
		command = mode(c.yellow),
		terminal = mode(c.cyan),
		inactive = {
			a = { fg = c.comment, bg = c.bg1 },
			b = { fg = c.comment, bg = c.bg1 },
			c = { fg = c.comment, bg = c.none },
		},
	}
end

-- [[ Querying Rex ]]

local pending -- reply set being collected, nil when no query is in flight
local pending_timer
local applied_key

local function key(t) return vim.json.encode({ t.bg, t.fg, t.palette }) end

-- Makes `theme` current and repaints if the rex scheme is active.
function M.set(theme, opts)
	opts = opts or {}
	local k = key(theme)
	if k == applied_key and M.current then return false end
	applied_key = k
	M.current = theme
	if not opts.provisional then write_cache(theme) end
	if vim.g.colors_name == "rex" then
		vim.cmd.colorscheme("rex") -- fires ColorScheme: lualine, codediff, neogit... refresh
	end
	return true
end

local function commit()
	local p = pending
	pending = nil
	if pending_timer then pending_timer:stop() end
	if not p then return end
	for i = 1, 16 do
		if not p.palette[i] then return end -- incomplete: ignore
	end
	local base = M.current or read_cache()
	if p.bg then
		M.set({ bg = p.bg, fg = p.fg or (base and base.fg) or p.palette[16], palette = p.palette })
	elseif not base and not M.provisional_done then
		-- Rex did not answer OSC 10/11 (pane not yet owned by an app): the
		-- palette is Rex's built-in one. Use it only when nothing else is known.
		M.provisional_done = true
		M.set({ bg = p.palette[1], fg = p.palette[8], palette = p.palette }, { provisional = true })
	end
end

local function chan(h)
	if #h == 0 then return nil end
	local v = tonumber(h:sub(1, 2), 16)
	if #h == 1 then v = v * 17 end
	return v
end

local function parse_color(spec)
	local r, g, b = spec:match("^rgba?:(%x+)/(%x+)/(%x+)")
	if not r then return nil end
	return hex(chan(r), chan(g), chan(b))
end

local function schedule_query(delay)
	vim.defer_fn(function() M.query() end, delay or 0)
end

-- Handles one TermResponse sequence. Returns true when it was ours.
function M.on_response(seq)
	local num, rest = seq:match("^\27%](%d+);(.*)$")
	if num then
		if num == "4" then
			local idx, spec = rest:match("^(%d+);(.*)$")
			idx = tonumber(idx)
			local color = spec and parse_color(spec)
			if pending and idx and idx < 16 and color then pending.palette[idx + 1] = color end
			return pending ~= nil
		elseif num == "10" or num == "11" then
			local color = parse_color(rest)
			if not color then return false end
			if pending then
				pending[num == "10" and "fg" or "bg"] = color
			elseif num == "11" and (not M.current or color ~= M.current.bg) then
				-- Unsolicited OSC 11: the TUI re-queried after a CSI ? 997
				-- theme notification. Fetch the whole theme.
				schedule_query(0)
			end
			return true
		end
		return false
	end
	if seq:match("^\27%[%?[%d;]*c$") then -- DA1: all earlier replies are in
		if pending then commit() end
		return false
	end
	return false
end

function M.query()
	if #api.nvim_list_uis() == 0 or api.nvim_get_mode().mode == "!" then return end
	if pending then return end -- one in flight
	pending = { palette = {} }
	pending_timer = pending_timer or vim.uv.new_timer()
	pending_timer:start(1500, 0, vim.schedule_wrap(function() commit() end))
	local s = {}
	for i = 0, 15 do s[#s + 1] = ("\27]4;%d;?\7"):format(i) end
	s[#s + 1] = "\27]10;?\7\27]11;?\7\27[c"
	api.nvim_ui_send(table.concat(s))
end

-- A few queries spread over `delays` (ms); a new pane gets its real theme a
-- moment after it starts or gains focus.
function M.burst(delays)
	for _, d in ipairs(delays or { 0, 400, 1500, 4000 }) do schedule_query(d) end
end

function M.setup()
	if M._setup then return end
	M._setup = true
	M.theme()
	applied_key = M.current and key(M.current)
	local group = api.nvim_create_augroup("rex_theme", { clear = true })
	api.nvim_create_autocmd("TermResponse", {
		group = group,
		nested = true, -- so :colorscheme fires ColorScheme (lualine etc. refresh)
		callback = function(ev) M.on_response(ev.data.sequence or "") end,
	})
	local function start()
		-- Ask Rex for theme notifications too. Neovim's TUI handles the CSI ?
		-- 997 reply by re-querying OSC 11, which on_response picks up.
		api.nvim_ui_send("\27[?2031h")
		M.burst()
	end
	if vim.v.vim_did_enter == 1 then
		start()
	else
		api.nvim_create_autocmd("UIEnter", { group = group, once = true, callback = start })
	end
end

return M
