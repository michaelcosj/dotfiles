local opts = vim.tbl_deep_extend(
	"force",
	require("config.plugins.snacks.options"),
	require("config.plugins.snacks.picker"),
	require("config.plugins.snacks.terminal"),
	require("config.plugins.snacks.dashboard")
)

local ok, snacks = pcall(require, "snacks")

if not ok then
	return
end

snacks.setup(opts)

require("config.plugins.snacks.keymaps")
require("config.plugins.snacks.autocmds")
require("config.plugins.snacks.lsp-progress")
