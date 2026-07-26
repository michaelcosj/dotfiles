local ok, neogit = pcall(require, "neogit")

if not ok then
	return
end

neogit.setup({
	disable_hint = true,
	graph_style = "kitty",
})

vim.keymap.set("n", "<leader>gg", function()
	neogit.open({ kind = "floating" })
end, { desc = "Open Neogit UI" })
