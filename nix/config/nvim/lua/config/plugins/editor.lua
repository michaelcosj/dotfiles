return {

	-- Comments
	{ "echasnovski/mini.comment", version = "*", opts = {} },

	-- Auto pairs
	{ "echasnovski/mini.pairs", version = "*", opts = {} },

	-- Surround
	{ "echasnovski/mini.surround", version = "*", opts = { n_lines = 100 } },

	-- Better quickfix
	{
		"stevearc/quicker.nvim",
		-- event = "FileType qf",
		---@module "quicker"
		---@type function|quicker.SetupOptions
		opts = function()
			vim.keymap.set("n", "<leader>q", function()
				require("quicker").toggle()
			end, { desc = "Toggle quickfix" })

			vim.keymap.set("n", "<leader>l", function()
				require("quicker").toggle({ loclist = true })
			end, { desc = "Toggle loclist" })

			return {
				keys = {
					{
						">",
						function()
							require("quicker").expand({ before = 2, after = 2, add_to_existing = true })
						end,
						desc = "Expand quickfix context",
					},
					{
						"<",
						function()
							require("quicker").collapse()
						end,
						desc = "Collapse quickfix context",
					},
				},
			}
		end,
	},
}
