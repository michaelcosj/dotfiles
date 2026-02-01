return {
	"folke/which-key.nvim",
	event = "VeryLazy",
	opts = {},
	keys = {
		{
			"<leader>?",
			function()
				require("which-key").show({ global = false })
			end,
			desc = "Buffer Local Keymaps (which-key)",
		},
	},
	init = function()
		local wk = require("which-key")
		wk.add({
			{ "<leader>f", group = "Find" },
			{ "<leader>a", group = "AI" },
			{ "<leader>b", group = "Buffer" },
			{ "<leader>g", group = "Git" },
			{ "<leader>h", group = "Git Signs" },
			{ "<leader>u", group = "Toggle" },
		})
	end,
}
