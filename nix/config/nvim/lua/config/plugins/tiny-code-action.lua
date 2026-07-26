local ok, tiny_code_action = pcall(require, "tiny-code-action")

if not ok then
	return
end

tiny_code_action.setup({
	backend = "vim",
	picker = "snacks",
})

vim.keymap.set({ "n", "x" }, "g.", function()
	tiny_code_action.code_action({})
end, { desc = "Code Actions", noremap = true, silent = true })
