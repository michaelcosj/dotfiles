return {
	"ellisonleao/gruvbox.nvim",
	priority = 1000,
	config = true,
	opts = {
		overrides = {
			NormalFloat = { bg = "none" },
			FloatBorder = { bg = "none" },
			FloatTitle = { bg = "none" },
			OpencodeBorder = { bg = "none", fg = "none" },
		},
	},
	init = function()
		vim.cmd([[colorscheme gruvbox]])
	end,
}
