local ok, opencode = pcall(require, "opencode")

if not ok then
	return
end

opencode.setup({
	default_global_keymaps = true,
	default_mode = "plan",
	keymap_prefix = "<leader>a",
	keymap = {
		editor = {
			["<leader>aa"] = { "toggle" },
			["<leader>af"] = { "toggle_focus" },
			["<leader>an"] = { "open_input_new_session" },
		},
		input_window = {
			["<S-cr>"] = false,
			["<cr>"] = { "submit_input_prompt", mode = { "n" } },
			["<C-cr>"] = { "submit_input_prompt", mode = { "i" } },
			["<leader>am"] = { "switch_mode" },
		},
		permission = {
			accept = "a",
			accept_all = "A",
			deny = "d",
		},
		session_picker = {
			delete_session = { "<C-d>" },
		},
	},
	ui = {
		position = "right",
		input_position = "bottom",
		window_width = 0.40,
		input_height = 0.15,
		display_model = true,
		display_context_size = true,
		display_cost = true,
		window_highlight = "Normal:OpencodeBackground,FloatBorder:OpencodeBorder",
		icons = {
			preset = "nerdfonts",
			overrides = {},
		},
		output = {
			tools = {
				show_output = true,
			},
			rendering = {
				markdown_debounce_ms = 250,
				on_data_rendered = nil,
			},
		},
		input = {
			text = {
				wrap = true,
			},
		},
		completion = {
			file_sources = {
				enabled = true,
				preferred_cli_tool = "server",
				ignore_patterns = {
					"^%.git/",
					"^%.svn/",
					"^%.hg/",
					"node_modules/",
					"%.pyc$",
					"%.o$",
					"%.obj$",
					"%.exe$",
					"%.dll$",
					"%.so$",
					"%.dylib$",
					"%.class$",
					"%.jar$",
					"%.war$",
					"%.ear$",
					"target/",
					"build/",
					"dist/",
					"out/",
					"deps/",
					"%.tmp$",
					"%.temp$",
					"%.log$",
					"%.cache$",
				},
				max_files = 10,
				max_display_length = 50,
			},
		},
	},
	context = {
		enabled = true,
		cursor_data = {
			enabled = false,
		},
		diagnostics = {
			info = false,
			warn = true,
			error = true,
		},
		current_file = {
			enabled = true,
		},
		selection = {
			enabled = false,
		},
	},
	debug = {
		enabled = false,
	},
	prompt_guard = nil,
	quick_chat = {},
	server = {
		port = "auto",
	},
})

require("config.extensions.opencode_three_state_layout")
