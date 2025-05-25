return {
	-- Task runner
	{
		"stevearc/overseer.nvim",
		opts = {
			strategy = "terminal",
			task_list = {
				max_height = nil,
				height = 0.3,
			},
		},
		cmd = {
			"OverseerDebugParser",
			"OverseerInfo",
			"OverseerOpen",
			"OverseerRun",
			"OverseerRunCmd",
			"OverseerToggle",
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
			local function get_cwd_as_name()
				local dir = vim.fn.getcwd(0)
				return dir:gsub("[^A-Za-z0-9]", "_")
			end

			local overseer = require("overseer")

			return {
				suppressed_dirs = { "~/", "~/Downloads", "/" },
				cwd_change_handling = true,
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
					function()
						overseer.save_task_bundle(get_cwd_as_name(), nil, { on_conflict = "overwrite" })
					end,
				},

				pre_restore_cmds = {
					function()
						for _, task in ipairs(overseer.list_tasks({})) do
							task:dispose(true)
						end
					end,
				},

				post_restore_cmds = {
					function()
						overseer.load_task_bundle(get_cwd_as_name(), { ignore_missing = true })
					end,
				},
			}
		end,
	},

	{
		{
			"jedrzejboczar/exrc.nvim",
			dependencies = { "neovim/nvim-lspconfig" }, -- (optional)
			opts = {},
		},
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
