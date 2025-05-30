return {
	-- Minuet AI (better copilot)
	{
		"milanglacier/minuet-ai.nvim",
		dependencies = {
			{ "nvim-lua/plenary.nvim" },
		},
		opts = {
			throttle = 500,
			provider = "codestral",
			provider_options = {
				gemini = {
					model = "gemini-2.0-flash",
					api_key = "GEMINI_API_KEY",
					optional = {
						generationConfig = {
							maxOutputTokens = 256,
						},
						safetySettings = {
							{
								category = "HARM_CATEGORY_DANGEROUS_CONTENT",
								threshold = "BLOCK_ONLY_HIGH",
							},
						},
					},
				},
				codestral = {
					optional = {
						max_tokens = 256,
						stop = { "\n\n" },
					},
				},
			},
		},
	},

	-- AI Code companion
	{
		"olimorris/codecompanion.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-treesitter/nvim-treesitter",
			"folke/noice.nvim",
			"ravitemer/codecompanion-history.nvim",
		},
		opts = {
			strategies = {
				chat = {
					adapter = "gemini",
				},
				inline = {
					adapter = "gemini",
				},
			},
			extensions = {
				mcphub = {
					callback = "mcphub.extensions.codecompanion",
					opts = {
						make_vars = true,
						make_slash_commands = true,
						show_result_in_chat = true,
					},
				},
				history = {
					enabled = true,
					opts = {
						picker = "snacks",
					},
				},
			},
			adapters = {
				gemini = function()
					return require("codecompanion.adapters").extend("gemini", {
						env = {
							api_key = "GEMINI_API_KEY",
						},
						schema = {
							model = {
								default = "gemini-2.5-flash-preview-05-20",
							},
						},
					})
				end,
				copilot = function()
					return require("codecompanion.adapters").extend("copilot", {
						schema = {
							model = {
								default = "claude-3.5-sonnet",
							},
						},
					})
				end,
			},
			display = {
				chat = {
					show_settings = true,
					show_token_count = true,
					window = {
						opts = {
							breakindent = true,
							cursorcolumn = false,
							cursorline = false,
							foldcolumn = "0",
							linebreak = true,
							list = false,
							signcolumn = "no",
							spell = false,
							wrap = true,
							number = false,
							relativenumber = false,
						},
					},
				},
				action_palette = {
					width = 95,
					height = 10,
					prompt = "Prompt ",
					provider = "snacks",
					opts = {
						show_default_actions = true,
						show_default_prompt_library = true,
					},
				},
			},
		},
		init = function()
			vim.cmd([[cab cc CodeCompanion]])

			vim.keymap.set(
				{ "n", "v" },
				"<leader>aa",
				"<cmd>CodeCompanionActions<cr>",
				{ noremap = true, silent = true, desc = "Code Companion Actions" }
			)

			vim.keymap.set(
				{ "n", "v" },
				"<leader>ac",
				"<cmd>CodeCompanionChat Toggle<cr>",
				{ noremap = true, silent = true, desc = "Code Companion Chat" }
			)

			vim.keymap.set(
				"v",
				"ga",
				"<cmd>CodeCompanionChat Add<cr>",
				{ noremap = true, silent = true, desc = "Add To Code Companion Chat" }
			)

			require("config.extensions.codecompanion").init_notifications()
		end,
	},

	-- MCP Hub
	{
		"ravitemer/mcphub.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
		},
		cmd = "MCPHub",
		build = "npm install -g mcp-hub@latest",
		opts = {
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
		},
	},
}
