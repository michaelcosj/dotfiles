require("config.helpers").safeSetup("gruvbox", {
	contrast = "",
	transparent_mode = true,
	overrides = {
		NormalFloat = { bg = "none" },
		FloatBorder = { bg = "none" },
		FloatTitle = { bg = "none" },
		OpencodeBorder = { bg = "none", fg = "none" },
	},
})

vim.cmd([[colorscheme gruvbox]])
