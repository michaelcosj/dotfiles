-- See lua/config/agent-panel.lua for every option and :AgentPanel subcommand.
require("config.agent-panel").setup({
	agent = "pi",
	layout = "tile", -- "float" or "tile"
	side = "left", -- "left", "right", "top" or "bottom"
	width = 0.3,
	height = 1,
})
