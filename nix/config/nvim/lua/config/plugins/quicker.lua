local quicker
quicker = require("config.helpers").safeSetup("quicker", {
	keys = {
		{
			">",
			function()
				quicker.expand({ before = 2, after = 2, add_to_existing = true })
			end,
			desc = "Expand quickfix context",
		},
		{
			"<",
			function()
				quicker.collapse()
			end,
			desc = "Collapse quickfix context",
		},
	},
})

if not quicker then
	return
end

vim.keymap.set("n", "<leader>q", function()
	quicker.toggle()
end, { desc = "Toggle quickfix" })

vim.keymap.set("n", "<leader>l", function()
	quicker.toggle({ loclist = true })
end, { desc = "Toggle loclist" })
