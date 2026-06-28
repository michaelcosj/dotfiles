vim.keymap.set("n", "<leader>bl", function()
	Snacks.picker.buffers()
end, { desc = "List Buffers" })

vim.keymap.set("n", "<leader>bd", function()
	Snacks.bufdelete()
end, { desc = "Delete Buffer" })

vim.keymap.set("n", "<leader><space>", function()
	Snacks.picker.files()
end, { desc = "Find Files" })

vim.keymap.set("n", "<leader>fn", function()
	Snacks.notifier.show_history()
end, { desc = "Notification History" })

vim.keymap.set("n", "<leader>fp", function()
	Snacks.picker.projects()
end, { desc = "Projects" })

vim.keymap.set("n", "<leader>fr", function()
	Snacks.picker.recent()
end, { desc = "Recent" })

vim.keymap.set("n", "<leader>e", function()
	Snacks.picker.explorer({
		auto_close = true,
	})
end, { desc = "Explorer" })

vim.keymap.set("n", "<leader>fg", function()
	Snacks.picker.grep()
end, { desc = "Grep" })

vim.keymap.set("n", "<leader>fl", function()
	Snacks.picker.lines()
end, { desc = "Buffer Lines" })

vim.keymap.set({ "n", "x" }, "<leader>fw", function()
	Snacks.picker.grep_word()
end, { desc = "Visual selection or word" })

vim.keymap.set("n", "<leader>fd", function()
	Snacks.picker.diagnostics()
end, { desc = "Diagnostics" })

vim.keymap.set("n", "<leader>fD", function()
	Snacks.picker.diagnostics_buffer()
end, { desc = "Buffer Diagnostics" })

vim.keymap.set("n", "<leader>fh", function()
	Snacks.picker.help()
end, { desc = "Help Pages" })

vim.keymap.set("n", "<leader>fi", function()
	Snacks.picker.icons()
end, { desc = "Icons" })

vim.keymap.set("n", "<leader>fj", function()
	Snacks.picker.jumps()
end, { desc = "Jumps" })

vim.keymap.set("n", "<leader>fk", function()
	Snacks.picker.keymaps()
end, { desc = "Keymaps" })

vim.keymap.set("n", "<leader>fq", function()
	Snacks.picker.qflist()
end, { desc = "Quickfix List" })

vim.keymap.set("n", "<leader>fu", function()
	Snacks.picker.undo()
end, { desc = "Undo History" })

vim.keymap.set("n", "<leader>ft", function()
	---@diagnostic disable-next-line: undefined-field
	Snacks.picker.todo_comments()
end, { desc = "Todo" })

vim.keymap.set("n", "<leader>fT", function()
	---@diagnostic disable-next-line: undefined-field
	Snacks.picker.todo_comments({ keywords = { "TODO", "FIX", "FIXME" } })
end, { desc = "Todo/Fix/Fixme" })

vim.keymap.set("n", "<leader>gb", function()
	Snacks.picker.git_branches()
end, { desc = "Git Branches" })

vim.keymap.set("n", "<leader>gf", function()
	Snacks.picker.git_log_file()
end, { desc = "Git Log File" })

vim.keymap.set("n", "<leader>gl", function()
	Snacks.picker.git_log()
end, { desc = "Git Log" })

vim.keymap.set("n", "<leader>gL", function()
	Snacks.picker.git_log_line()
end, { desc = "Git Log Line" })

vim.keymap.set("n", "<leader>gs", function()
	Snacks.picker.git_status()
end, { desc = "Git Status" })

vim.keymap.set("n", "<leader>gd", function()
	Snacks.picker.git_diff()
end, { desc = "Git Diff (Hunks)" })

vim.keymap.set({ "n", "v" }, "<leader>gB", function()
	Snacks.gitbrowse()
end, { desc = "Git Browse" })

vim.keymap.set("n", "<leader>gg", function()
	Snacks.lazygit()
end, { desc = "Lazygit" })

vim.keymap.set("n", "gd", function()
	Snacks.picker.lsp_definitions()
end, { desc = "Goto Definition" })

vim.keymap.set("n", "gD", function()
	Snacks.picker.lsp_declarations()
end, { desc = "Goto Declaration" })

vim.keymap.set("n", "gr", function()
	Snacks.picker.lsp_references()
end, { nowait = true, desc = "References" })

vim.keymap.set("n", "gI", function()
	Snacks.picker.lsp_implementations()
end, { desc = "Goto Implementation" })

vim.keymap.set("n", "gy", function()
	Snacks.picker.lsp_type_definitions()
end, { desc = "Goto T[y]pe Definition" })

vim.keymap.set("n", "gs", function()
	Snacks.picker.lsp_symbols()
end, { desc = "LSP Symbols" })

vim.keymap.set("n", "gS", function()
	Snacks.picker.lsp_workspace_symbols()
end, { desc = "LSP Workspace Symbols" })

vim.keymap.set("n", "<leader>z", function()
	Snacks.zen.zoom()
end, { desc = "Toggle Zoom" })

vim.keymap.set("n", "<leader>.", function()
	Snacks.scratch()
end, { desc = "Toggle Scratch Buffer" })

vim.keymap.set("n", "<leader>S", function()
	Snacks.scratch.select()
end, { desc = "Select Scratch Buffer" })

vim.keymap.set("n", "<leader>cR", function()
	Snacks.rename.rename_file()
end, { desc = "Rename File" })

vim.keymap.set("n", "<leader>un", function()
	Snacks.notifier.hide()
end, { desc = "Dismiss All Notifications" })

vim.keymap.set("n", "<c-;>", function()
	Snacks.terminal()
end, { desc = "Toggle Terminal" })

vim.keymap.set({ "n", "t" }, "]]", function()
	Snacks.words.jump(vim.v.count1)
end, { desc = "Next Reference" })

vim.keymap.set({ "n", "t" }, "[[", function()
	Snacks.words.jump(-vim.v.count1)
end, { desc = "Prev Reference" })
