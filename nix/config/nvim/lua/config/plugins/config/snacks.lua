local M = {}

M.opts = {
	animate = { enabled = true, duration = 1 },
	bigfile = { enabled = true },
	dashboard = {
		enabled = true,
		preset = {
			keys = {
				{
					icon = "󰦛 ",
					key = "s",
					desc = "Restore Session",
					action = function()
						require("persistence").load({ last = true })
					end,
				},
				{ icon = " ", key = "q", desc = "Quit", action = ":qa" },
			},
			header = [[
⣇⣿⠘⣿⣿⣿⡿⡿⣟⣟⢟⢟⢝⠵⡝⣿⡿⢂⣼⣿⣷⣌⠩⡫⡻⣝⠹⢿⣿⣷
⡆⣿⣆⠱⣝⡵⣝⢅⠙⣿⢕⢕⢕⢕⢝⣥⢒⠅⣿⣿⣿⡿⣳⣌⠪⡪⣡⢑⢝⣇
⡆⣿⣿⣦⠹⣳⣳⣕⢅⠈⢗⢕⢕⢕⢕⢕⢈⢆⠟⠋⠉⠁⠉⠉⠁⠈⠼⢐⢕⢽
⡗⢰⣶⣶⣦⣝⢝⢕⢕⠅⡆⢕⢕⢕⢕⢕⣴⠏⣠⡶⠛⡉⡉⡛⢶⣦⡀⠐⣕⢕
⡝⡄⢻⢟⣿⣿⣷⣕⣕⣅⣿⣔⣕⣵⣵⣿⣿⢠⣿⢠⣮⡈⣌⠨⠅⠹⣷⡀⢱⢕
⡝⡵⠟⠈⢀⣀⣀⡀⠉⢿⣿⣿⣿⣿⣿⣿⣿⣼⣿⢈⡋⠴⢿⡟⣡⡇⣿⡇⡀⢕
⡝⠁⣠⣾⠟⡉⡉⡉⠻⣦⣻⣿⣿⣿⣿⣿⣿⣿⣿⣧⠸⣿⣦⣥⣿⡇⡿⣰⢗⢄
⠁⢰⣿⡏⣴⣌⠈⣌⠡⠈⢻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣬⣉⣉⣁⣄⢖⢕⢕⢕
⡀⢻⣿⡇⢙⠁⠴⢿⡟⣡⡆⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣵⣵⣿
⡻⣄⣻⣿⣌⠘⢿⣷⣥⣿⠇⣿⣿⣿⣿⣿⣿⠛⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿
⣷⢄⠻⣿⣟⠿⠦⠍⠉⣡⣾⣿⣿⣿⣿⣿⣿⢸⣿⣦⠙⣿⣿⣿⣿⣿⣿⣿⣿⠟
⡕⡑⣑⣈⣻⢗⢟⢞⢝⣻⣿⣿⣿⣿⣿⣿⣿⠸⣿⠿⠃⣿⣿⣿⣿⣿⣿⡿⠁⣠
⡝⡵⡈⢟⢕⢕⢕⢕⣵⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣶⣿⣿⣿⣿⣿⠿⠋⣀⣈⠙
⡝⡵⡕⡀⠑⠳⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⠛⢉⡠⡲⡫⡪⡪⡣ 
]],
		},
		sections = {
			{ section = "header" },
			{
				text = { { "Ad Astra Per Aspera", hl = "special" } },
				align = "center",
			},
			{
				text = { { os.date("%A %B, %Y") .. "", hl = "key" } },
				align = "center",
				padding = 1,
			},
			{ section = "projects", title = " Projects", padding = 2, indent = 2 },
			{ section = "recent_files", title = " Recent Files", padding = 1, indent = 2 },
			{ section = "keys", padding = 2 },
			{ section = "startup" },
		},
		pane_gap = 10,
	},
	explorer = {
		enabled = true,
		wo = {
			cursorline = true,
		},
	},
	indent = { enabled = true },
	input = {
		enabled = true,
		win = {
			position = "float",
			relative = "cursor",
			row = -3,
			col = 0,
			wo = {
				cursorline = false,
			},
		},
	},
	notifier = { enabled = false },
	picker = {
		enabled = true,
		ui_select = true,
		matcher = {
			frecency = true,
		},
		layout = {
			preset = "ivy",
			cycle = false,
		},
		layouts = {
			ivy = {
				layout = {
					height = 0.5,
				},
			},
		},
	},
	quickfile = { enabled = true },
	scope = { enabled = true },
	scroll = {
		enabled = true,
		animate = { duration = { step = 5, total = 50 } },
		animate_repeat = {
			delay = 50, -- delay in ms before using the repeat animation
			duration = { step = 2, total = 25 },
		},
	},
	statuscolumn = { enabled = true, git = { patterns = { "GitSigns" } } },
	words = { enabled = true },
	terminal = {
		win = {
			border = "rounded",
			position = "float",
			height = 0.8,
			width = 0.8,
		},
	},
	styles = {},
}

M.keys = {
	-- Find
	{
		"<leader><space>",
		function()
			Snacks.picker.smart()
		end,
		desc = "Smart Find Files",
	},
	{
		"<leader>ff",
		function()
			Snacks.picker.files()
		end,
		desc = "Find Files",
	},
	{
		"<leader>fb",
		function()
			Snacks.picker.buffers()
		end,
		desc = "Buffers",
	},
	{
		"<leader>fn",
		"<cmd>NoiceSnacks<cr>",
		desc = "Notification History",
	},
	{
		"<leader>fp",
		function()
			Snacks.picker.projects()
		end,
		desc = "Projects",
	},
	{
		"<leader>fr",
		function()
			Snacks.picker.recent()
		end,
		desc = "Recent",
	},
	{
		"<leader>e",
		function()
			Snacks.picker.explorer()
		end,
		desc = "Explorer",
	},

	-- git
	{
		"<leader>gb",
		function()
			Snacks.picker.git_branches()
		end,
		desc = "Git Branches",
	},
	{
		"<leader>gf",
		":lua Snacks.picker.git_log_file() <cr>",
		desc = "Git Log File",
	},
	{
		"<leader>gL",
		function()
			Snacks.picker.git_log()
		end,
		desc = "Git Log",
	},
	{
		"<leader>gl",
		function()
			Snacks.picker.git_log_line()
		end,
		desc = "Git Log Line",
	},
	{
		"<leader>gs",
		function()
			Snacks.picker.git_status()
		end,
		desc = "Git Status",
	},
	{
		"<leader>gd",
		function()
			Snacks.picker.git_diff()
		end,
		desc = "Git Diff (Hunks)",
	},
	{
		"<leader>gB",
		function()
			Snacks.gitbrowse()
		end,
		desc = "Git Browse",
		mode = { "n", "v" },
	},
	{
		"<leader>gg",
		function()
			Snacks.lazygit()
		end,
		desc = "Lazygit",
	},

	-- search
	{
		"<leader>sS",
		function()
			Snacks.picker.grep()
		end,
		desc = "Grep",
	},
	{
		"<leader>ss",
		function()
			Snacks.picker.lines()
		end,
		desc = "Buffer Lines",
	},
	{
		"<leader>sw",
		function()
			Snacks.picker.grep_word()
		end,
		desc = "Visual selection or word",
		mode = { "n", "x" },
	},
	{
		"<leader>sr",
		function()
			Snacks.picker.registers()
		end,
		desc = "Registers",
	},
	{
		"<leader>sd",
		function()
			Snacks.picker.diagnostics()
		end,
		desc = "Diagnostics",
	},
	{
		"<leader>sD",
		function()
			Snacks.picker.diagnostics_buffer()
		end,
		desc = "Buffer Diagnostics",
	},
	{
		"<leader>sh",
		function()
			Snacks.picker.help()
		end,
		desc = "Help Pages",
	},
	{
		"<leader>si",
		function()
			Snacks.picker.icons()
		end,
		desc = "Icons",
	},
	{
		"<leader>sj",
		function()
			Snacks.picker.jumps()
		end,
		desc = "Jumps",
	},
	{
		"<leader>sk",
		function()
			Snacks.picker.keymaps()
		end,
		desc = "Keymaps",
	},
	{
		"<leader>sl",
		function()
			Snacks.picker.loclist()
		end,
		desc = "Location List",
	},
	{
		"<leader>sp",
		function()
			Snacks.picker.lazy()
		end,
		desc = "Search for Plugin Spec",
	},
	{
		"<leader>sq",
		function()
			Snacks.picker.qflist()
		end,
		desc = "Quickfix List",
	},
	{
		"<leader>su",
		function()
			Snacks.picker.undo()
		end,
		desc = "Undo History",
	},
	-- Doesn't work on mac
	-- {
	-- 	"<leader>c",
	-- 	function()
	-- 		Snacks.picker.cliphist()
	-- 	end,
	-- 	desc = "Clipboard history",
	-- },
	{
		"<leader>st",
		function()
			---@diagnostic disable-next-line: undefined-field
			Snacks.picker.todo_comments()
		end,
		desc = "Todo",
	},
	{
		"<leader>sT",
		function()
			---@diagnostic disable-next-line: undefined-field
			Snacks.picker.todo_comments({ keywords = { "TODO", "FIX", "FIXME" } })
		end,
		desc = "Todo/Fix/Fixme",
	},

	-- LSP
	{
		"gd",
		function()
			Snacks.picker.lsp_definitions()
		end,
		desc = "Goto Definition",
	},
	{
		"gD",
		function()
			Snacks.picker.lsp_declarations()
		end,
		desc = "Goto Declaration",
	},
	{
		"gr",
		function()
			Snacks.picker.lsp_references()
		end,
		nowait = true,
		desc = "References",
	},
	{
		"gI",
		function()
			Snacks.picker.lsp_implementations()
		end,
		desc = "Goto Implementation",
	},
	{
		"gy",
		function()
			Snacks.picker.lsp_type_definitions()
		end,
		desc = "Goto T[y]pe Definition",
	},
	{
		"gs",
		function()
			Snacks.picker.lsp_symbols()
		end,
		desc = "LSP Symbols",
	},
	{
		"gS",
		function()
			Snacks.picker.lsp_workspace_symbols()
		end,
		desc = "LSP Workspace Symbols",
	},

	-- Other
	{
		"<leader>z",
		function()
			Snacks.zen.zoom()
		end,
		desc = "Toggle Zoom",
	},
	{
		"<leader>.",
		function()
			Snacks.scratch()
		end,
		desc = "Toggle Scratch Buffer",
	},
	{
		"<leader>S",
		function()
			Snacks.scratch.select()
		end,
		desc = "Select Scratch Buffer",
	},
	{
		"<leader>bd",
		function()
			Snacks.bufdelete()
		end,
		desc = "Delete Buffer",
	},
	{
		"<leader>cR",
		function()
			Snacks.rename.rename_file()
		end,
		desc = "Rename File",
	},
	{
		"<leader>un",
		function()
			Snacks.notifier.hide()
		end,
		desc = "Dismiss All Notifications",
	},
	{
		"<c-;>",
		function()
			Snacks.terminal()
		end,
		desc = "Toggle Terminal",
	},
	{
		"]]",
		function()
			Snacks.words.jump(vim.v.count1)
		end,
		desc = "Next Reference",
		mode = { "n", "t" },
	},
	{
		"[[",
		function()
			Snacks.words.jump(-vim.v.count1)
		end,
		desc = "Prev Reference",
		mode = { "n", "t" },
	},
}

M.init = function()
	vim.api.nvim_create_autocmd("User", {
		pattern = "VeryLazy",
		callback = function()
			local Snacks = require("snacks")

			-- Setup some globals for debugging (lazy-loaded)
			-- Inspect
			_G.dd = function(...)
				Snacks.debug.inspect(...)
			end

			-- Backtrace
			_G.bt = function()
				Snacks.debug.backtrace()
			end

			vim.print = _G.dd -- Override print to use snacks for `:=` command

			-- Create some toggle mappings
			Snacks.toggle.option("spell", { name = "Spelling" }):map("<leader>us")
			Snacks.toggle.option("wrap", { name = "Wrap" }):map("<leader>uw")

			Snacks.toggle.line_number():map("<leader>ul")
			Snacks.toggle.option("relativenumber", { name = "Relative Number" }):map("<leader>uL")

			Snacks.toggle.diagnostics():map("<leader>ud")
			Snacks.toggle
				.option("conceallevel", { off = 0, on = vim.o.conceallevel > 0 and vim.o.conceallevel or 2 })
				:map("<leader>uc")
			Snacks.toggle.treesitter():map("<leader>uT")
			Snacks.toggle
				.option("background", { off = "light", on = "dark", name = "Dark Background" })
				:map("<leader>ub")

			Snacks.toggle.inlay_hints():map("<leader>uh")
			Snacks.toggle.indent():map("<leader>ug")
			Snacks.toggle.dim():map("<leader>uD")
		end,
	})
end

return M
