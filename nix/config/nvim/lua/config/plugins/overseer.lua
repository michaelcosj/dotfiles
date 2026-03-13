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
		vim.cmd.cnoreabbrev("OS OverseerShell")

		vim.api.nvim_create_user_command("OverseerRestartLast", function()
			local overseer = require("overseer")
			local task_list = require("overseer.task_list")
			local tasks = overseer.list_tasks({
				status = {
					overseer.STATUS.SUCCESS,
					overseer.STATUS.FAILURE,
					overseer.STATUS.CANCELED,
				},
				sort = task_list.sort_finished_recently,
			})
			if vim.tbl_isempty(tasks) then
				vim.notify("No tasks found", vim.log.levels.WARN)
			else
				local most_recent = tasks[1]
				overseer.run_action(most_recent, "restart")
			end
		end, {})
	end,
}
