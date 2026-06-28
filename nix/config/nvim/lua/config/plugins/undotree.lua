vim.cmd.packadd("nvim.undotree")

vim.keymap.set("n", "<leader>uU", function()
	require("undotree").open({
		command = "topleft 30vnew | setlocal nonumber norelativenumber",
	})
end, { desc = "Toggle Undo Tree" })
