return {
	{
		"sudo-tee/opencode.nvim",
		config = function()
			require("opencode").setup({
				default_global_keymaps = true,
				default_mode = "plan",
				keymap_prefix = "<leader>a",
				keymap = {
					editor = {
						["<leader>aa"] = { "toggle" }, -- Open opencode. Close if opened
						["<leader>af"] = { "toggle_focus" },
					},
					input_window = {
						["<S-cr>"] = false,
						["<cr>"] = { "submit_input_prompt", mode = { "n" } },
						["<C-cr>"] = { "submit_input_prompt", mode = { "i" } },
						["<leader>am"] = { "switch_mode" }, -- Switch between modes (build/plan)
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
				-- server = {
				-- 	url = "localhost",
				-- 	port = "auto",
				-- 	timeout = 5,
				-- },
			})

			vim.keymap.set("n", "<leader>aCc", function()
				require("opencode.api").run_user_command("commit")
			end, { desc = "Generate commit" })

			local function insert_code_block(bufnr)
				local win = vim.api.nvim_get_current_win()
				if vim.api.nvim_win_get_buf(win) ~= bufnr then
					return
				end

				local row = vim.api.nvim_win_get_cursor(win)[1]
				local line = vim.api.nvim_buf_get_lines(bufnr, row - 1, row, false)[1]
				local end_row = line == "" and row or row - 1

				vim.api.nvim_buf_set_lines(bufnr, row, end_row, false, { "```", "", "```" })
				vim.api.nvim_win_set_cursor(win, { row, 3 })
				vim.api.nvim_exec_autocmds("TextChanged", { buffer = bufnr, modeline = false })

				vim.cmd("startinsert")
			end

			vim.api.nvim_create_autocmd("FileType", {
				pattern = "opencode",
				callback = function(args)
					if not vim.api.nvim_buf_is_valid(args.buf) then
						return
					end

					vim.keymap.set("i", "<S-CR>", "<CR>", { buffer = args.buf })

					vim.schedule(function()
						local ok, state = pcall(require, "opencode.state")
						if not ok or not state.windows or args.buf ~= state.windows.input_buf then
							return
						end

						vim.keymap.set("n", "gcc", function()
							insert_code_block(args.buf)
						end, { buffer = args.buf })
					end)
				end,
			})

			require("config.extensions.opencode_three_state_layout")
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
	{
		"guill/mcp-tools.nvim",
		dependencies = { "sudo-tee/opencode.nvim" },
		build = "cd bridge && bun install",
		opts = {
			integrations = {
				opencode = true,
			},
		},
		init = function()
			local mcp = require("mcp-tools")

			mcp.register({
				name = "build_handoff",
				description = "For Neovim clients. Create a new session with the handoff prompt as an editable draft",
				args = {
					prompt = {
						type = "string",
						description = "The generated handoff prompt",
						required = true,
					},
					files = {
						type = "array",
						description = "Array of file paths to load into the new session's context",
						required = false,
						default = {},
					},
				},
				execute = function(cb, args)
					local opencode_api = require("opencode.api")
					local input_window = require("opencode.ui.input_window")

					local files = args.files

					local fileRefs = table.concat(
						vim.tbl_map(function(f)
							return "@" .. f:gsub("^@", "")
						end, files),
						" "
					)

					local fullPrompt = table.concat(
						vim.tbl_filter(function(part)
							return part ~= nil and part ~= ""
						end, {
							fileRefs,
							"---\n\nUse the `implement-plan` skill to implement this plan\n---",
							args.prompt,
						}),
						"\n\n"
					)

					local new_session_result = opencode_api.open_input_new_session()
					new_session_result
						:and_then(function()
							return require("opencode.core").switch_to_mode("build")
						end)
						:and_then(function()
							require("opencode.state").current_model = "openai/gpt-5.4"
						end)
						:and_then(function()
							input_window.set_content(fullPrompt)
							input_window.focus_input()

							cb({ message = "successfully submitted build handoff" })
						end)
						:catch(function(err)
							cb({ message = "an error occured", error = err })
						end)
				end,
			})
		end,
	},
}
