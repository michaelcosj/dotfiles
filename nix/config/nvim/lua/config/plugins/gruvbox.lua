require("config.helpers").safeSetup("gruvbox", {
	overrides = {
		NormalFloat = { bg = "none" },
		FloatBorder = { bg = "none" },
		FloatTitle = { bg = "none" },
		OpencodeBorder = { bg = "none", fg = "none" },
	},
})

vim.cmd([[colorscheme gruvbox]])
