-- Snacks Nvim
-- return {
-- 	"folke/snacks.nvim",
-- 	dependencies = { "folke/todo-comments.nvim" },
-- 	priority = 1000,
-- 	lazy = false,
-- 	---@type snacks.Config
-- 	opts = { ... },
-- 	keys = { ... },
-- 	init = function() ... end,
-- }

require("config.helpers").safeSetup("snacks", {
	animate = { enabled = true, duration = 1 },
	bigfile = { enabled = true },
	explorer = {
		enabled = true,
		wo = {
			cursorline = true,
		},
	},
	image = {
		enabled = false,
		convert = {
			notify = true,
		},
	},
	indent = {
		enabled = true,
		indent = { only_scope = false },
		chunk = { enabled = true },
		animate = { enabled = true },
	},
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
	lazygit = {
		configure = true,
		config = {
			os = {
				editPreset = "nvim-remote",
				open = "nvim-remote",
				editAtLine = "nvim-remote",
				openDirInEditor = "nvim-remote",
			},
			gui = {
				nerdFontsVersion = "3",
			},
		},
	},
	notifier = { enabled = true, style = "compact" },
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
		animate = {
			duration = { step = 15, total = 250 },
			easing = "linear",
		},
		animate_repeat = {
			delay = 100,
			duration = { step = 5, total = 50 },
			easing = "linear",
		},
		filter = function(buf)
			return vim.g.snacks_scroll ~= false
				and vim.b[buf].snacks_scroll ~= false
				and vim.bo[buf].buftype ~= "terminal"
		end,
	},
	statuscolumn = { enabled = true, git = { patterns = { "GitSigns" } } },
	words = { enabled = true },
	terminal = {
		win = {
			border = "rounded",
			position = "float",
			height = 0.8,
			width = 0.8,
			wo = {
				winhighlight = "Normal:Normal,FloatBorder:Normal",
			},
		},
	},
	styles = {},
	dashboard = {
		enabled = true,
		preset = {
			keys = {
				{ icon = "", key = "f", desc = "find file", action = ":lua Snacks.dashboard.pick('files')" },
				{ icon = "", key = "n", desc = "new file", action = ":ene | startinsert" },
				{ icon = "", key = "g", desc = "grep text", action = ":lua Snacks.dashboard.pick('live_grep')" },
				{
					icon = "",
					key = "r",
					desc = "recent file",
					action = ":lua Snacks.dashboard.pick('oldfiles')",
				},
				{
					icon = "",
					key = "c",
					desc = "config",
					action = ":lua Snacks.dashboard.pick('files', {cwd = vim.fn.stdpath('config')})",
				},
				-- { icon = "󰒲", key = "L", desc = "lazy", action = ":Lazy", enabled = package.loaded.lazy ~= nil },
				{ icon = "󰈆", key = "q", desc = "quit", action = ":qa" },
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
		formats = {
			header = {
				align = "left",
			},
		},
		sections = {
			{
				section = "header",
				padding = 6,
			},
			{
				pane = 2,
				padding = 1,
				{
					{ section = "keys", gap = 1, padding = 1 },
					{ section = "startup", icon = "󱐌 ", gap = 1, padding = 1 },
				},
			},
		},
	},
	dim = { enabled = true },
	win = {
		backdrop = { transparent = true, blend = 100 },
	},
})

vim.keymap.set("n", "<leader>bl", function()
	Snacks.picker.buffers()
end, { desc = "List Buffers" })

vim.keymap.set("n", "<leader>bd", function()
	Snacks.bufdelete()
end, { desc = "Delete Buffer" })

vim.keymap.set("n", "<leader><space>", function()
	Snacks.picker.files()
end, { desc = "Find Files" })

vim.keymap.set("n", "<leader>fn", "<cmd>NoiceSnacks<cr>", { desc = "Notification History" })

vim.keymap.set("n", "<leader>fp", function()
	Snacks.picker.projects()
end, { desc = "Projects" })

vim.keymap.set("n", "<leader>fr", function()
	Snacks.picker.recent()
end, { desc = "Recent" })

vim.keymap.set("n", "<leader>e", function()
	Snacks.picker.explorer({
		auto_close = true,
	})
end, { desc = "Explorer" })

vim.keymap.set("n", "<leader>fg", function()
	Snacks.picker.grep()
end, { desc = "Grep" })

vim.keymap.set("n", "<leader>fl", function()
	Snacks.picker.lines()
end, { desc = "Buffer Lines" })

vim.keymap.set({ "n", "x" }, "<leader>fw", function()
	Snacks.picker.grep_word()
end, { desc = "Visual selection or word" })

vim.keymap.set("n", "<leader>fd", function()
	Snacks.picker.diagnostics()
end, { desc = "Diagnostics" })

vim.keymap.set("n", "<leader>fD", function()
	Snacks.picker.diagnostics_buffer()
end, { desc = "Buffer Diagnostics" })

vim.keymap.set("n", "<leader>fh", function()
	Snacks.picker.help()
end, { desc = "Help Pages" })

vim.keymap.set("n", "<leader>fi", function()
	Snacks.picker.icons()
end, { desc = "Icons" })

vim.keymap.set("n", "<leader>fj", function()
	Snacks.picker.jumps()
end, { desc = "Jumps" })

vim.keymap.set("n", "<leader>fk", function()
	Snacks.picker.keymaps()
end, { desc = "Keymaps" })

-- vim.keymap.set("n", "<leader>fP", function()
-- 	Snacks.picker.lazy()
-- end, { desc = "Search for Plugin Spec" })

vim.keymap.set("n", "<leader>fq", function()
	Snacks.picker.qflist()
end, { desc = "Quickfix List" })

vim.keymap.set("n", "<leader>fu", function()
	Snacks.picker.undo()
end, { desc = "Undo History" })

vim.keymap.set("n", "<leader>ft", function()
	---@diagnostic disable-next-line: undefined-field
	Snacks.picker.todo_comments()
end, { desc = "Todo" })

vim.keymap.set("n", "<leader>fT", function()
	---@diagnostic disable-next-line: undefined-field
	Snacks.picker.todo_comments({ keywords = { "TODO", "FIX", "FIXME" } })
end, { desc = "Todo/Fix/Fixme" })

vim.keymap.set("n", "<leader>gb", function()
	Snacks.picker.git_branches()
end, { desc = "Git Branches" })

vim.keymap.set("n", "<leader>gf", ":lua Snacks.picker.git_log_file() <cr>", { desc = "Git Log File" })

vim.keymap.set("n", "<leader>gl", function()
	Snacks.picker.git_log()
end, { desc = "Git Log" })

vim.keymap.set("n", "<leader>gL", function()
	Snacks.picker.git_log_line()
end, { desc = "Git Log Line" })

vim.keymap.set("n", "<leader>gs", function()
	Snacks.picker.git_status()
end, { desc = "Git Status" })

vim.keymap.set("n", "<leader>gd", function()
	Snacks.picker.git_diff()
end, { desc = "Git Diff (Hunks)" })

vim.keymap.set({ "n", "v" }, "<leader>gB", function()
	Snacks.gitbrowse()
end, { desc = "Git Browse" })

vim.keymap.set("n", "<leader>gg", function()
	Snacks.lazygit()
end, { desc = "Lazygit" })

vim.keymap.set("n", "gd", function()
	Snacks.picker.lsp_definitions()
end, { desc = "Goto Definition" })

vim.keymap.set("n", "gD", function()
	Snacks.picker.lsp_declarations()
end, { desc = "Goto Declaration" })

vim.keymap.set("n", "gr", function()
	Snacks.picker.lsp_references()
end, { nowait = true, desc = "References" })

vim.keymap.set("n", "gI", function()
	Snacks.picker.lsp_implementations()
end, { desc = "Goto Implementation" })

vim.keymap.set("n", "gy", function()
	Snacks.picker.lsp_type_definitions()
end, { desc = "Goto T[y]pe Definition" })

vim.keymap.set("n", "gs", function()
	Snacks.picker.lsp_symbols()
end, { desc = "LSP Symbols" })

vim.keymap.set("n", "gS", function()
	Snacks.picker.lsp_workspace_symbols()
end, { desc = "LSP Workspace Symbols" })

vim.keymap.set("n", "<leader>z", function()
	Snacks.zen.zoom()
end, { desc = "Toggle Zoom" })

vim.keymap.set("n", "<leader>.", function()
	Snacks.scratch()
end, { desc = "Toggle Scratch Buffer" })

vim.keymap.set("n", "<leader>S", function()
	Snacks.scratch.select()
end, { desc = "Select Scratch Buffer" })

vim.keymap.set("n", "<leader>cR", function()
	Snacks.rename.rename_file()
end, { desc = "Rename File" })

vim.keymap.set("n", "<leader>un", function()
	Snacks.notifier.hide()
end, { desc = "Dismiss All Notifications" })

vim.keymap.set("n", "<c-;>", function()
	Snacks.terminal()
end, { desc = "Toggle Terminal" })

vim.keymap.set({ "n", "t" }, "]]", function()
	Snacks.words.jump(vim.v.count1)
end, { desc = "Next Reference" })

vim.keymap.set({ "n", "t" }, "[[", function()
	Snacks.words.jump(-vim.v.count1)
end, { desc = "Prev Reference" })

vim.api.nvim_create_autocmd("User", {
	pattern = "VeryLazy",
	callback = function()
		local Snacks = require("snacks")

		vim.api.nvim_create_autocmd("BufWinLeave", {
			pattern = "*",
			callback = function()
				if vim.bo.filetype == "snacks_explorer" then
					vim.schedule(function()
						---@diagnostic disable-next-line: param-type-mismatch
						pcall(vim.cmd, "redraw!")
					end)
				end
			end,
		})

		_G.dd = function(...)
			Snacks.debug.inspect(...)
		end

		_G.bt = function()
			Snacks.debug.backtrace()
		end

		vim.print = _G.dd

		Snacks.toggle.diagnostics():map("<leader>ud")
		Snacks.toggle.treesitter():map("<leader>uT")

		Snacks.toggle.indent():map("<leader>ug")
		Snacks.toggle.dim():map("<leader>uD")

		Snacks.toggle.option("spell", { name = "Spelling" }):map("<leader>us")
		Snacks.toggle.option("wrap", { name = "Wrap" }):map("<leader>uw")

		Snacks.toggle.line_number():map("<leader>ul")
		Snacks.toggle.option("relativenumber", { name = "Relative Number" }):map("<leader>uL")

		Snacks.toggle.inlay_hints():map("<leader>uh")
		Snacks.toggle
			.option("conceallevel", { off = 0, on = vim.o.conceallevel > 0 and vim.o.conceallevel or 2 })
			:map("<leader>uc")

		Snacks.toggle.option("background", { off = "light", on = "dark", name = "Dark Background" }):map("<leader>ub")
	end,
})

---@type table<number, {token:lsp.ProgressToken, msg:string, done:boolean}[]>
local progress = vim.defaulttable()

vim.api.nvim_create_autocmd("LspProgress", {
	---@param ev {data: {client_id: integer, params: lsp.ProgressParams}}
	callback = function(ev)
		local client = vim.lsp.get_client_by_id(ev.data.client_id)
		local value = ev.data.params.value --[[@as {percentage?: number, title?: string, message?: string, kind: "begin" | "report" | "end"}]]
		if not client or type(value) ~= "table" then
			return
		end
		local p = progress[client.id]

		for i = 1, #p + 1 do
			if i == #p + 1 or p[i].token == ev.data.params.token then
				p[i] = {
					token = ev.data.params.token,
					msg = ("[%3d%%] %s%s"):format(
						value.kind == "end" and 100 or value.percentage or 100,
						value.title or "",
						value.message and (" **%s**"):format(value.message) or ""
					),
					done = value.kind == "end",
				}
				break
			end
		end

		local msg = {} ---@type string[]
		progress[client.id] = vim.tbl_filter(function(v)
			return table.insert(msg, v.msg) or not v.done
		end, p)

		local spinner = {
			"⢌⣉⢎⣉",
			"⣉⡱⣉⡱",
			"⣉⢎⣉⢎",
			"⡱⣉⡱⣉",
			"⢎⣉⢎⣉",
			"⣉⡱⣉⡱",
			"⣉⢎⣉⢎",
			"⡱⣉⡱⣉",
			"⢎⣉⢎⣉",
			"⣉⡱⣉⡱",
			"⣉⢎⣉⢎",
			"⡱⣉⡱⣉",
			"⢎⣉⢎⣉",
			"⣉⡱⣉⡱",
			"⣉⢎⣉⢎",
			"⡱⣉⡱⣉",
		}
		vim.notify(table.concat(msg, "\n"), "info", {
			id = "lsp_progress",
			title = client.name,
			opts = function(notif)
				notif.icon = #progress[client.id] == 0 and " "
					or spinner[math.floor(vim.uv.hrtime() / (1e6 * 80)) % #spinner + 1]
			end,
		})
	end,
})
