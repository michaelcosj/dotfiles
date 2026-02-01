return {
	-- Comments
	{
		"echasnovski/mini.comment",
		version = "*",
		opts = {},
	},

	-- Auto pairs
	{
		"echasnovski/mini.pairs",
		version = "*",
		opts = {},
	},

	-- Surround
	{
		"echasnovski/mini.surround",
		version = "*",
		opts = { n_lines = 100 },
	},

	-- mini icons
	{
		"echasnovski/mini.icons",
		version = false,
		opts = {},
		config = function(_, opts)
			require("mini.icons").setup(opts)
			require("mini.icons").mock_nvim_web_devicons()
		end,
	},
}
