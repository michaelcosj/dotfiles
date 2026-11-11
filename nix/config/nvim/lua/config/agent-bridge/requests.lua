-- Questions pi asks Neovim (review an edit, review a plan), shown one at a
-- time. While one is open, Neovim's Rex pane reports `blocked` so Rex marks
-- the tab, and a floating agent panel is hidden so it doesn't cover the
-- review; it comes back once the queue is empty.
local bridge = require("config.agent-bridge.bridge")

local M = { queue = {}, active = nil }

local handlers = {
	review_edit = require("config.agent-bridge.edit-review"),
	review_plan = require("config.agent-bridge.plan-review"),
}

local panel_hidden = false

local function program_status(blocked, msg)
	if not vim.api.nvim_ui_send or vim.env.REX_BLOCK == nil then return end
	local seq
	if blocked then
		seq = string.format("\27]7501;id=pi-review:state=blocked:kind=permission:app=nvim:msg=%s\27\\", vim.base64.encode(msg))
	else
		seq = "\27]7501;id=pi-review:state=clear\27\\"
	end
	pcall(vim.api.nvim_ui_send, seq)
end

local function respond(request_id, result)
	bridge.request("respond", { request_id = request_id, result = result }, function(_, err)
		if err then vim.notify("Agent bridge: " .. err, vim.log.levels.ERROR) end
	end)
end

local function focus_editor()
	local rex = require("config.rex")
	if rex.available() then rex.focus_block(rex.block) end
end

local next_request

local function settle()
	M.active = nil
	if #M.queue > 0 then return next_request() end
	program_status(false)
	if panel_hidden then
		panel_hidden = false
		require("config.agent-panel").show()
	end
end

next_request = function()
	local req = table.remove(M.queue, 1)
	if not req then return settle() end
	M.active = req
	local handler = handlers[req.kind]
	local what = req.kind == "review_plan" and "Review pi's plan" or ("Review pi's edit to " .. vim.fn.fnamemodify(req.path, ":t"))
	program_status(true, what)
	local cfg = require("config.agent-bridge.config").values.review
	local function start()
		if M.active ~= req then return end
		if cfg.focus ~= false then focus_editor() end
		local ok, err = pcall(handler.open, req, function(result)
			if M.active ~= req then return end
			respond(req.request_id, result)
			settle()
		end)
		if not ok then
			vim.notify("Pi review failed: " .. tostring(err), vim.log.levels.ERROR)
			respond(req.request_id, { pass = true })
			settle()
		end
	end
	if cfg.focus ~= false and not panel_hidden then
		require("config.agent-panel").hide_float(function(hidden)
			panel_hidden = panel_hidden or hidden
			start()
		end)
	else
		start()
	end
end

function M.on_request(req)
	local handler = handlers[req.kind]
	if not handler or not handler.wants(req) then
		return respond(req.request_id, { pass = true })
	end
	table.insert(M.queue, req)
	if not M.active then next_request() end
end

-- pi got its answer elsewhere, or the user cancelled in pi.
function M.on_done(data)
	local id = data and data.request_id
	for i, req in ipairs(M.queue) do
		if req.request_id == id then
			table.remove(M.queue, i)
			return
		end
	end
	local req = M.active
	if req and req.request_id == id then
		M.active = nil
		pcall(handlers[req.kind].close, req)
		settle()
	end
end

-- Brings the open review back to the front.
function M.resume()
	local req = M.active
	if not req then return vim.notify("No pi review waiting", vim.log.levels.INFO) end
	handlers[req.kind].resume(req)
end

-- The connection dropped: nothing is waiting for an answer any more.
function M.reset()
	local req = M.active
	M.queue = {}
	M.active = nil
	if req then pcall(handlers[req.kind].close, req) end
	settle()
end

function M.setup()
	local group = vim.api.nvim_create_augroup("agent_bridge_requests", { clear = true })
	vim.api.nvim_create_autocmd("User", {
		group = group,
		pattern = "AgentEvent:request",
		callback = function(args) M.on_request(args.data) end,
	})
	vim.api.nvim_create_autocmd("User", {
		group = group,
		pattern = "AgentEvent:request_done",
		callback = function(args) M.on_done(args.data) end,
	})
	vim.api.nvim_create_autocmd("User", {
		group = group,
		pattern = { "AgentEvent:disconnected", "AgentEvent:shutdown" },
		callback = function() M.reset() end,
	})
	vim.api.nvim_create_autocmd("User", {
		group = group,
		pattern = "AgentEvent:open",
		callback = function(args) M.open(args.data) end,
	})
end

-- pi's open_in_editor: show path:line in a normal window and switch to Neovim.
function M.open(data)
	if not data or not data.path then return end
	local win = vim.api.nvim_get_current_win()
	if vim.bo[vim.api.nvim_win_get_buf(win)].buftype ~= "" then
		for _, w in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
			if vim.bo[vim.api.nvim_win_get_buf(w)].buftype == "" then
				win = w
				break
			end
		end
	end
	vim.api.nvim_set_current_win(win)
	vim.cmd("edit " .. vim.fn.fnameescape(data.path))
	if data.line then
		local last = vim.api.nvim_buf_line_count(0)
		pcall(vim.api.nvim_win_set_cursor, 0, { math.min(data.line, last), math.max((data.col or 1) - 1, 0) })
		vim.cmd("normal! zvzz")
	end
	require("config.agent-panel").hide_float()
	focus_editor()
end

return M
