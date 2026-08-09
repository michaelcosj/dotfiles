local M = {}

local config = require("config.pi-bridge.config")
local bridge = require("config.pi-bridge.bridge")
local context = require("config.pi-bridge.context")
local events = require("config.pi-bridge.events")
local herdr = require("config.pi-bridge.herdr")
local ui = require("config.pi-bridge.ui")

local function report_error(err)
	if err and err ~= "Pi selection cancelled" then
		vim.notify("Pi bridge: " .. err, vim.log.levels.ERROR)
	end
end

local function with_bridge(callback)
	herdr.ensure(function(agent, err)
		if not agent then
			report_error(err)
			return
		end
		bridge.connect(agent, function(ok, connect_err)
			if not ok then
				report_error(connect_err)
				return
			end
			callback(agent)
		end)
	end)
end

function M.prompt(text, opts)
	opts = vim.deepcopy(opts or {})
	if text:sub(-3) == "..." then
		M.ask(text:sub(1, -4), opts)
		return
	end
	if opts.append == nil and text:match("%s$") then
		opts.append = true
	end
	local expanded = context.expand(text, opts.range)
	local method = opts.append and "append_prompt" or "prompt"
	with_bridge(function()
		bridge.request(method, { text = expanded }, function(_, err)
			if err then
				report_error(err)
			end
		end)
	end)
end

function M.ask(default, opts)
	opts = opts or {}
	ui.input(default or "@this: ", function(value)
		M.prompt(value, opts)
	end)
end

function M.select(opts)
	ui.select_prompt(function(prompt)
		M.ask(prompt .. " ", opts)
	end)
end

function M.focus()
	local agent = events.agent or bridge.agent
	if agent then
		herdr.focus(agent)
		return
	end
	herdr.ensure(function(found, err)
		if found then
			events.set_agent(found)
			herdr.focus(found)
		else
			report_error(err)
		end
	end)
end

function M.format(range)
	return context.current(range)
end

function M.statusline()
	return events.statusline()
end

function M.operator(type)
	if not type then
		vim.go.operatorfunc = "v:lua.require'config.pi-bridge'._operator"
		return "g@"
	end
	local first = vim.api.nvim_buf_get_mark(0, "[")[1]
	local last = vim.api.nvim_buf_get_mark(0, "]")[1]
	M.ask("@this: ", { range = { bufnr = 0, first = first, last = last } })
end

function M._operator(type)
	M.operator(type)
end

local function visual_range()
	local first = vim.fn.line("v")
	local last = vim.fn.line(".")
	if first > last then
		first, last = last, first
	end
	return { bufnr = 0, first = first, last = last }
end

function M.setup(opts)
	config.setup(opts)

	vim.api.nvim_create_user_command("PiAsk", function(command)
		M.ask(command.args ~= "" and command.args or "@this: ")
	end, { nargs = "*" })
	vim.api.nvim_create_user_command("PiSelect", function()
		M.select()
	end, {})
	vim.api.nvim_create_user_command("PiFocus", M.focus, {})

	vim.keymap.set("n", "<leader>aa", function()
		M.ask("@this: ")
	end, { desc = "Pi: ask" })
	vim.keymap.set("x", "<leader>aa", function()
		M.ask("@this: ", { range = visual_range() })
	end, { desc = "Pi: ask about selection" })
	vim.keymap.set("n", "<leader>as", M.select, { desc = "Pi: select prompt" })
	vim.keymap.set("x", "<leader>as", function()
		M.select({ range = visual_range() })
	end, { desc = "Pi: select prompt for selection" })
	vim.keymap.set("n", "<leader>ap", function()
		M.ask("")
	end, { desc = "Pi: quick chat" })
	vim.keymap.set("n", "<leader>af", M.focus, { desc = "Pi: focus pane" })
	vim.keymap.set("n", "<leader>ao", M.operator, { expr = true, desc = "Pi: operator" })

	vim.api.nvim_create_autocmd("User", {
		pattern = "PiEvent:status",
		callback = function(args)
			if args.data and args.data.state == "blocked" then
				vim.notify("Pi is blocked: " .. (args.data.message or "interaction required") .. " (<leader>af to focus)", vim.log.levels.WARN)
			end
		end,
	})
end

return M
