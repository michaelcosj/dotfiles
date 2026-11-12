-- Loaded on first use: :Neogit is defined by the plugin without loading it.
local ready = false

vim.keymap.set("n", "<leader>gg", function()
	local ok, neogit = pcall(require, "neogit")
	if not ok then
		return
	end
	if not ready then
		neogit.setup({
			disable_hint = true,
			graph_style = "kitty",
		})
		ready = true
	end
	neogit.open({ kind = "floating" })
end, { desc = "Open Neogit UI" })
