local tiny_code_action = require("config.helpers").safeSetup("tiny-code-action", {
	backend = "vim",
	picker = "snacks",
})

if not tiny_code_action then
	return
end

vim.keymap.set({ "n", "x" }, "g.", function()
	tiny_code_action.code_action({})
end, { desc = "Code Actions", noremap = true, silent = true })
