return {
	{
		"sudo-tee/opencode.nvim",
		config = function()
			require("opencode").setup({
				default_mode = "plan",
				keymap = {
					global = {
						toggle = "<leader>aa",
						open_input = "<leader>ai",
						open_input_new_session = "<leader>aI",
						open_output = "<leader>ao",
						toggle_focus = "<leader>af",
						close = "<leader>aq",
						select_session = "<leader>as",
						select_child_session = "<leader>aS",
						configure_provider = "<leader>ap",
						diff_open = "<leader>ad",
						diff_next = "<leader>a]",
						diff_prev = "<leader>a[",
						diff_close = "<leader>ac",
						diff_revert_all_last_prompt = "<leader>ara",
						diff_revert_this_last_prompt = "<leader>art",
						diff_revert_all = "<leader>arA",
						diff_revert_this = "<leader>arT",
						diff_restore_snapshot_file = "<leader>arr",
						diff_restore_snapshot_all = "<leader>arR",
						open_configuration_file = "<leader>aC",
						swap_position = "<leader>ax",
						select_agent = "<leader>aM",
					},
					window = {
						switch_mode = "<leader>am",
					},
					context = {
						cursor_data = {
							enabled = true,
						},
					},
				},
			})

			vim.keymap.set("i", "<S-CR>", function()
				vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<CR>", true, false, true), "i", true)
			end, { noremap = true, silent = true })
		end,
		dependencies = {
			"nvim-lua/plenary.nvim",
			{
				"MeanderingProgrammer/render-markdown.nvim",
				opts = {
					anti_conceal = { enabled = false },
					file_types = { "markdown", "opencode_output" },
				},
				ft = { "markdown", "Avante", "copilot-chat", "opencode_output" },
			},
			"saghen/blink.cmp",
			"folke/snacks.nvim",
		},
	},
	-- Minuet AI (better copilot)
	{
		"milanglacier/minuet-ai.nvim",
		enabled = false,
		dependencies = {
			{ "nvim-lua/plenary.nvim" },
		},
		opts = {
			throttle = 1000,
			provider = "gemini",
			provider_options = {
				gemini = {
					model = "gemini-2.5-flash-lite-preview-06-17",
					api_key = "GEMINI_API_KEY",
					optional = {
						generationConfig = {
							maxOutputTokens = 1024,
							thinkingConfig = {
								thinkingBudget = 0,
							},
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
						max_tokens = 512,
						stop = { "\n\n" },
					},
				},
			},
		},
	},

	-- AI Code companion
	{
		"olimorris/codecompanion.nvim",
		enabled = false,
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
								default = "gemini-2.5-pro",
							},
						},
					})
				end,
			},
			display = {
				chat = {
					show_settings = false,
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
		enabled = false,
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
			-- on_ready = function() end,
			-- on_error = function() end,
			log = {
				level = vim.log.levels.WARN,
				to_file = false,
				file_path = nil,
				prefix = "MCPHub",
			},
		},
	},
	-- {
	-- 	"NickvanDyke/opencode.nvim",
	-- 	enabled = false,
	-- 	dependencies = { "folke/snacks.nvim" },
	-- 	----@type opencode.Config
	-- 	opts = {
	-- 		-- Your configuration, if any
	-- 	},
	--    -- stylua: ignore
	-- 	keys = {
	-- 		{ "<leader>at", function() require("opencode").toggle() end, desc = "Toggle embedded opencode", },
	-- 		{ "<leader>aa", function() require("opencode").ask("@cursor: ") end, desc = "Ask opencode", mode = "n", },
	-- 		{ "<leader>aa", function() require("opencode").ask("@selection: ") end, desc = "Ask opencode about selection", mode = "v", },
	-- 		{ "<leader>ap", function() require("opencode").select_prompt() end, desc = "Select prompt", mode = { "n", "v" }, },
	-- 		{ "<leader>an", function() require("opencode").command("session_new") end, desc = "New session", },
	--      { "<leader>ay", function() require("opencode").command("messages_copy") end, desc = "Copy last message", },
	-- 		{ "<S-C-u>", function() require("opencode").command("messages_half_page_up") end, desc = "Scroll messages up", },
	-- 		{ "<S-C-d>", function() require("opencode").command("messages_half_page_down") end, desc = "Scroll messages down", },
	-- 	},
	-- },
}
