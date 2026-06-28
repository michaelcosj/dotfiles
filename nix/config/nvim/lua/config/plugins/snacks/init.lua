local opts = vim.tbl_deep_extend(
	"force",
	require("config.plugins.snacks.options"),
	require("config.plugins.snacks.picker"),
	require("config.plugins.snacks.terminal"),
	require("config.plugins.snacks.dashboard")
)

local snacks = require("config.helpers").safeSetup("snacks", opts)

if not snacks then
	return
end

require("config.plugins.snacks.keymaps")
require("config.plugins.snacks.autocmds")
require("config.plugins.snacks.lsp-progress")
