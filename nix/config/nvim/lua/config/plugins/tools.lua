return {
	-- Task runner
	{
		"stevearc/overseer.nvim",
		opts = {
			output = {
				use_terminal = true,
				preserve_output = false,
			},
		},
		cmd = {
			"OverseerOpen",
			"OverseerRun",
			"OverseerToggle",
			"OverseerShell",
			"OverseerTaskAction",
		},
		keys = {
			{
				"<leader>or",
				"<cmd>OverseerRun<cr>",
				desc = "[O]verseer [R]un",
			},
			{
				"<leader>ot",
				"<cmd>OverseerToggle<cr>",
				desc = "[O]verseer [T]oggle",
			},
		},
	},

	-- Session Management
	-- TODO: replace with
	-- {
	--   'stevearc/resession.nvim',
	--   opts = {},
	-- }
	--
	{
		"rmagatti/auto-session",
		lazy = false,
		dependencies = { "stevearc/overseer.nvim" },
		keys = {
			{ "<leader>sr", "<cmd>SessionSearch<CR>", desc = "Session search" },
			{ "<leader>ss", "<cmd>SessionSave<CR>", desc = "Save session" },
			{ "<leader>sa", "<cmd>SessionToggleAutoSave<CR>", desc = "Toggle autosave" },
		},
		---@module "auto-session"
		---@type function|AutoSession.Config
		opts = function()
			return {
				suppressed_dirs = { "~/", "~/Downloads", "/" },
				cwd_change_handling = true,
				lsp_stop_on_restore = false,
				bypass_save_filetypes = {
					"alpha",
					"dashboard",
					"OverseerList",
					"codecompanion",
				},

				session_lens = {
					load_on_setup = true,
					previewer = false,
					mappings = {
						delete_session = { "i", "<C-D>" },
						alternate_session = { "i", "<C-S>" },
						copy_session = { "i", "<C-Y>" },
					},
					theme_conf = {
						border = true,
					},
				},

				pre_cwd_changed_cmds = {},

				post_cwd_changed_cmds = {
					function()
						require("lualine").refresh()
					end,
				},

				pre_save_cmds = {
					-- close all snacks pickers before save
					function()
						local pickers = require("snacks").picker.get()
						for _, picker in ipairs(pickers) do
							---@diagnostic disable-next-line: missing-parameter
							picker.close()
						end
					end,
				},

				save_extra_cmds = {
					-- https://github.com/stevearc/overseer.nvim/blob/master/doc/third_party.md#other-session-managers
					function()
						local tasks = require("overseer.task_list").list_tasks()
						local cmds = {}
						for _, task in ipairs(tasks) do
							local json = vim.json.encode(task:serialize())
							-- For some reason, vim.json.encode encodes / as \/.
							json = string.gsub(json, "\\/", "/")
							-- Escape backslashes first, then single quotes
							json = string.gsub(json, "\\", "\\\\")
							json = string.gsub(json, "'", "\\'")
							table.insert(
								cmds,
								string.format("lua require('overseer').new_task(vim.json.decode('%s')):start()", json)
							)
						end
						return cmds
					end,
				},

				pre_restore_cmds = {
					function()
						for _, task in ipairs(require("overseer").list_tasks({})) do
							task:dispose(true)
						end
					end,
				},
			}
		end,
	},

	-- Asynchronous Lint Engine (for linters that don't have LSP support)
	{
		"dense-analysis/ale",
		config = function()
			local g = vim.g

			g.ale_linters = {
				php = { "phpstan" },
			}
			--  Only run linters named in ale_linters settings.
			g.ale_linters_explicit = 1

			-- turn off echo errors
			g.ale_echo_cursor = 0

			-- display diagnostics through neovim
			g.ale_use_neovim_diagnostics_api = 1
		end,
	},
}
