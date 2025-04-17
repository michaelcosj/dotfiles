local M = {}

M.opts = {
	port = 37373,
	config = vim.fn.expand("~/.dotfiles/mcphub/servers.json"),
	native_servers = {},
	auto_approve = false,
	extensions = {
		codecompanion = {
			show_result_in_chat = true,
			make_vars = true,
			make_slash_commands = true,
		},
	},
	ui = {
		window = {
			width = 0.8,
			height = 0.8,
			border = "rounded",
			relative = "editor",
			zindex = 50,
		},
	},
	on_ready = function(hub) end,
	on_error = function(err) end,
	log = {
		level = vim.log.levels.WARN,
		to_file = false,
		file_path = nil,
		prefix = "MCPHub",
	},
}

return M
