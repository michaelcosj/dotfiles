-- Tells pi where you are in Neovim (file, cursor, visible lines and the last
-- selection while the cursor stays in it), so a prompt like "why does this
-- fail?" works without @this. pi adds it to the next prompt when it changed.
local bridge = require("config.agent-bridge.bridge")

local M = {}

local MAX_SELECTION = 4000
local last_sent
local selection -- { buf, first, last }
local timer

local function relative(path)
	return vim.fs.relpath(vim.uv.cwd(), path) or path
end

local function snapshot()
	local buf = vim.api.nvim_get_current_buf()
	local name = vim.api.nvim_buf_get_name(buf)
	if vim.bo[buf].buftype ~= "" or name == "" then return nil end
	local cursor = vim.api.nvim_win_get_cursor(0)
	local ctx = {
		file = relative(name),
		line = cursor[1],
		col = cursor[2] + 1,
		filetype = vim.bo[buf].filetype,
		visible = { vim.fn.line("w0"), vim.fn.line("w$") },
		modified = vim.bo[buf].modified,
	}
	local mode = vim.api.nvim_get_mode().mode
	local first, last
	if mode:match("^[vV\22]") then
		first, last = vim.fn.line("v"), cursor[1]
		if first > last then first, last = last, first end
	elseif selection and selection.buf == buf and cursor[1] >= selection.first and cursor[1] <= selection.last then
		first, last = selection.first, selection.last
	else
		selection = nil
	end
	if first then
		local text = table.concat(vim.api.nvim_buf_get_lines(buf, first - 1, last, false), "\n")
		ctx.selection = { first = first, last = last, text = text:sub(1, MAX_SELECTION) }
	end
	return ctx
end

function M.send(force)
	if not bridge.pipe then return end
	local ctx = snapshot()
	if not ctx then return end
	local encoded = vim.json.encode(ctx)
	if encoded == last_sent and not force then return end
	last_sent = encoded
	bridge.request("set_context", ctx, function() end)
end

local function schedule()
	if not bridge.pipe then return end
	if timer then timer:stop() end
	timer = vim.defer_fn(function() M.send() end, 300)
end

function M.setup()
	local group = vim.api.nvim_create_augroup("agent_bridge_ambient", { clear = true })
	vim.api.nvim_create_autocmd({ "BufEnter", "CursorHold", "WinScrolled" }, { group = group, callback = schedule })
	vim.api.nvim_create_autocmd("ModeChanged", {
		group = group,
		pattern = "[vV\22]*:*",
		callback = function()
			local first, last = vim.fn.line("'<"), vim.fn.line("'>")
			if first > 0 then selection = { buf = vim.api.nvim_get_current_buf(), first = first, last = last } end
			schedule()
		end,
	})
	vim.api.nvim_create_autocmd("User", {
		group = group,
		pattern = "AgentEvent:connected",
		callback = function()
			last_sent = nil
			M.send(true)
		end,
	})
end

return M
