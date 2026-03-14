return {
	"folke/tokyonight.nvim",
  enabled = false,
	lazy = false,
	priority = 1000,
	opts = {
		style = "night",
		transparent = true,
		on_highlights = function(hl, c)
			hl.NormalFloat = { bg = "none" }
			hl.FloatBorder = { bg = "none" }
			hl.FloatTitle = { bg = "none" }
			hl.OpencodeBorder = { bg = "none", fg = "none" }
		end,
	},
	init = function()
		vim.cmd([[colorscheme tokyonight]])
	end,
}
