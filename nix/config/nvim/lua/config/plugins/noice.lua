return {
	"folke/noice.nvim",
	event = "VeryLazy",
	opts = {
		notify = {
			view = "mini",
		},
		presets = {
			bottom_search = true,
			command_palette = true,
			lsp_doc_border = true,
		},
		lsp = {
			progress = {
				enabled = true,
			},
		},
	},
	dependencies = {
		"MunifTanjim/nui.nvim",
		"folke/snacks.nvim",
	},
}
