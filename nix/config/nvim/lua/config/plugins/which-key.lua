local wk = require("config.helpers").safeSetup("which-key", {})

if not wk then
	return
end

wk.add({
	{ "<leader>f", group = "Find" },
	{ "<leader>a", group = "AI" },
	{ "<leader>b", group = "Buffer" },
	{ "<leader>g", group = "Git" },
	{ "<leader>h", group = "Git Signs" },
	{ "<leader>u", group = "Toggle" },
})

vim.keymap.set("n", "<leader>?", function()
	wk.show({ global = false })
end, { desc = "Buffer Local Keymaps (which-key)" })
