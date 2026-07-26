local ok, catppuccin = pcall(require, "catppuccin")

if not ok then
	return
end

catppuccin.setup({
	flavour = "auto",
  transparent_background = true,
	background = {
		dark = "macchiato",
		light = "latte",
	},
	float = {
    solid = false;
		transparent = true,
	},
	integrations = {
		blink_cmp = true,
		gitsigns = true,
		mini = true,
		neogit = true,
		overseer = true,
		render_markdown = true,
		snacks = true,
		treesitter_context = true,
		which_key = true,
	},
	custom_highlights = function(colors)
		local color_utils = require("catppuccin.utils.colors")

		local makeDiagnosticColor = function(color)
			return { fg = color, bg = color_utils.blend(color, colors.base, 0.05) }
		end

		return {
			-- Remove gutter background
			SignColumn = { bg = "none" },
			FoldColumn = { bg = "none" },

			-- Transparent floating windows
			NormalFloat = { bg = "none" },
			FloatBorder = { bg = "none" },
			FloatTitle = { bg = "none" },

			-- Dark background for windows that should remain visually distinct
			NormalDark = { fg = colors.subtext0, bg = colors.mantle },

			-- Dark completion menu
			Pmenu = { fg = colors.text, bg = colors.mantle },
			PmenuSel = { fg = "NONE", bg = colors.surface0 },
			PmenuSbar = { bg = colors.crust },
			PmenuThumb = { bg = colors.surface1 },

			-- Tint diagnostic virtual text with its foreground color
			DiagnosticVirtualTextHint = makeDiagnosticColor(colors.teal),
			DiagnosticVirtualTextInfo = makeDiagnosticColor(colors.sky),
			DiagnosticVirtualTextWarn = makeDiagnosticColor(colors.yellow),
			DiagnosticVirtualTextError = makeDiagnosticColor(colors.red),

			-- Neogit
			NeogitDiffAddHighlight = {
				bg = color_utils.blend(colors.green, colors.base, 0.2),
				fg = colors.subtext0,
			},
			NeogitDiffDeleteHighlight = {
				bg = color_utils.blend(colors.red, colors.base, 0.2),
				fg = colors.subtext0,
			},

			-- Tiny cmdline
			TinyCmdlineNormal = { fg = colors.text, bg = colors.base },
		}
	end,
})

vim.cmd.colorscheme("catppuccin")
