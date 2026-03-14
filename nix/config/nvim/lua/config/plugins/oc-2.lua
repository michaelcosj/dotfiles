return {
	"0xleodevv/oc-2.nvim",
	enabled = true,
	opts = {
		overrides = {
			NormalFloat = { bg = "none" },
			FloatBorder = { bg = "none" },
			FloatTitle = { bg = "none" },
			OpencodeBorder = { bg = "none", fg = "none" },
		},
	},
	init = function()
		vim.cmd([[colorscheme oc-2]])
	end,
}
