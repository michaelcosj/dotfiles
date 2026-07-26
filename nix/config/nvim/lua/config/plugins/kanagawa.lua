local ok, kanagawa = pcall(require, "kanagawa")

if not ok then
	return
end

kanagawa.setup({
  transparent = true,
	background = { -- map the value of 'background' option to a theme
		dark = "wave", -- try "dragon" !
		light = "lotus",
	},
	-- Remove gutter background
	colors = {
		theme = {
			all = {
				ui = {
					bg_gutter = "none",
				},
			},
		},
	},
	overrides = function(colors)
		local theme = colors.theme

		local makeDiagnosticColor = function(color)
			local c = require("kanagawa.lib.color")
			return { fg = color, bg = c(color):blend(theme.ui.bg, 0.95):to_hex() }
		end

		return {
			-- Transparent Floating Windows
			NormalFloat = { bg = "none" },
			FloatBorder = { bg = "none" },
			FloatTitle = { bg = "none" },

			-- Save an hlgroup with dark background and dimmed foreground
			-- so that you can use it where your still want darker windows.
			-- E.g.: autocmd TermOpen * setlocal winhighlight=Normal:NormalDark
			NormalDark = { fg = theme.ui.fg_dim, bg = theme.ui.bg_m3 },

			-- Dark completion (popup) menu
			Pmenu = { fg = theme.ui.shade0, bg = theme.ui.bg_p1 }, -- add `blend = vim.o.pumblend` to enable transparency
			PmenuSel = { fg = "NONE", bg = theme.ui.bg_p2 },
			PmenuSbar = { bg = theme.ui.bg_m1 },
			PmenuThumb = { bg = theme.ui.bg_p2 },

			-- Tint background of diagnostic messages with their foreground color
			DiagnosticVirtualTextHint = makeDiagnosticColor(theme.diag.hint),
			DiagnosticVirtualTextInfo = makeDiagnosticColor(theme.diag.info),
			DiagnosticVirtualTextWarn = makeDiagnosticColor(theme.diag.warning),
			DiagnosticVirtualTextError = makeDiagnosticColor(theme.diag.error),

			-- Neogit
			NeogitDiffAddHighlight = { bg = theme.diff.add, fg = theme.ui.fg_dim },
			NeogitDiffDeleteHighlight = { bg = theme.diff.delete, fg = theme.ui.fg_dim },

			-- Tiny cmdline
			TinyCmdlineNormal = { fg = theme.ui.shade0, bg = theme.ui.bg },
		}
	end,
})

vim.cmd("colorscheme kanagawa")
