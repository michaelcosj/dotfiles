return {
	"stevearc/overseer.nvim",
	opts = {
		output = {
			use_terminal = true,
			preserve_output = false,
		},
	},
	cmd = {
		"OverseerOpen",
		"OverseerRun",
		"OverseerToggle",
		"OverseerShell",
		"OverseerTaskAction",
	},
	keys = {
		{
			"<leader>or",
			"<cmd>OverseerRun<cr>",
			desc = "[O]verseer [R]un",
		},
		{
			"<leader>ot",
			"<cmd>OverseerToggle<cr>",
			desc = "[O]verseer [T]oggle",
		},
	},
	init = function()
    -- cmd alias for overseer shell
		vim.cmd.cnoreabbrev("OS OverseerShell")
	end,
}
