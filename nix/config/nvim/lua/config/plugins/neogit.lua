local neogit = require("config.helpers").safeSetup("neogit", {
	disable_hint = true,
	graph_style = "kitty",
})

if not neogit then
	return
end

vim.keymap.set("n", "<leader>gg", function()
	neogit.open({ kind = "floating" })
end, { desc = "Open Neogit UI" })
