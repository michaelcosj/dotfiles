vim.opt.foldlevel = 99
vim.opt.foldlevelstart = 99

require("config.helpers").safeSetup("origami", {
	foldtext = {
		lineCount = {
			template = "  %d",
		},
	},
})
