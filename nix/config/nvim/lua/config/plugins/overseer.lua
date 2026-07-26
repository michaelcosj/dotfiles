local ok, overseer = pcall(require, "overseer")

if not ok then
	return
end

overseer.setup({
	output = {
		use_terminal = true,
		preserve_output = false,
	},
})

vim.cmd.cnoreabbrev("OS OverseerShell")

vim.api.nvim_create_user_command("OverseerRestartLast", function()
	local ok, task_list = pcall(require, "overseer.task_list")
	if not ok then
		vim.notify(("Failed to require overseer.task_list: %s"):format(task_list), vim.log.levels.WARN)
		return
	end

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

vim.keymap.set("n", "<leader>or", "<cmd>OverseerRun<cr>", { desc = "[O]verseer [R]un" })
vim.keymap.set("n", "<leader>ot", "<cmd>OverseerToggle<cr>", { desc = "[O]verseer [T]oggle" })
