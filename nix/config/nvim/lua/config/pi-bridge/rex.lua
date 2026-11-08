-- The Rex backend for pi-bridge, with the same functions as herdr.lua.
-- pi-control-bridge writes <tmpdir>/pi-control-<uid>/<block>.json in a Rex
-- pane; this finds those for this Rex session, and starts pi in the agent
-- panel (config.agent-panel) when there are none.
local rex = require("config.rex")
local herdr = require("config.pi-bridge.herdr")
local panel = require("config.agent-panel")

local M = {}

local last_used_pane_id = nil

local function runtime_dir()
	local tmp = (vim.env.TMPDIR or "/tmp"):gsub("/$", "")
	return string.format("%s/pi-control-%d", tmp, vim.uv.getuid())
end

local function alive(pid)
	return type(pid) == "number" and vim.uv.kill(pid, 0) == 0
end

local function canonical(path)
	local real = path and vim.uv.fs_realpath(path)
	return real and real:gsub("/$", "") or path
end

local function score(agent, cwd)
	local a, b = canonical(agent.cwd), canonical(cwd)
	if a == b then return 100000 end
	return math.min(#(a or ""), #(b or ""))
end

local function read_agents()
	local out = {}
	local dir = runtime_dir()
	for name, kind in vim.fs.dir(dir) do
		if kind == "file" and name:match("%.json$") then
			local f = io.open(dir .. "/" .. name, "r")
			local ok, rec = pcall(vim.json.decode, f and f:read("*a") or "")
			if f then f:close() end
			if ok and type(rec) == "table" and rec.rex_session == rex.session and alive(rec.pid)
				and rec.tokens and rec.tokens.pi_control_socket and vim.uv.fs_stat(rec.tokens.pi_control_socket)
			then
				rec.agent_status = "running"
				table.insert(out, rec)
			end
		end
	end
	return out
end

function M.discover(callback)
	if not rex.available() then
		callback(nil, "Neovim is not running inside Rex")
		return
	end
	local cwd = vim.uv.cwd()
	local candidates = vim.tbl_filter(function(agent)
		return herdr._overlaps(agent.cwd, cwd)
	end, read_agents())
	table.sort(candidates, function(a, b)
		local a_last, b_last = a.pane_id == last_used_pane_id, b.pane_id == last_used_pane_id
		if a_last ~= b_last then return a_last end
		return score(a, cwd) > score(b, cwd)
	end)
	callback(candidates)
end

local function wait_for_agent(block_id, deadline, callback)
	M.discover(function(candidates, err)
		if not candidates then return callback(nil, err) end
		for _, agent in ipairs(candidates) do
			if agent.pane_id == block_id then return callback(agent) end
		end
		-- pi also lists agents in other directories; the new one may sit above cwd
		for _, agent in ipairs(read_agents()) do
			if agent.pane_id == block_id then return callback(agent) end
		end
		if vim.uv.now() >= deadline then
			return callback(nil, "Timed out waiting for Pi control bridge; run /reload in the Pi pane")
		end
		vim.defer_fn(function() wait_for_agent(block_id, deadline, callback) end, 500)
	end)
end

-- Starts pi in the agent panel. It runs in a shell, so quitting pi leaves
-- the panel open at a prompt.
function M.spawn(callback, opts)
	opts = opts or {}
	panel.open({ agent = "pi", focus = opts.focus == true }, function(block_id, err)
		if not block_id then return callback(nil, err) end
		local timeout = require("config.pi-bridge.config").values.spawn_timeout_ms
		wait_for_agent(block_id, vim.uv.now() + timeout, callback)
	end)
end

local function select_agent(candidates, callback)
	if #candidates == 1 then return callback(candidates[1]) end
	vim.ui.select(candidates, {
		prompt = "Select Pi",
		format_item = function(agent)
			local mark = agent.pane_id == last_used_pane_id and "󰋚 " or "  "
			return string.format("%s%s  %s", mark, agent.pane_id:gsub("^block:", ""):sub(-6), agent.cwd or "?")
		end,
	}, callback)
end

function M.ensure(callback)
	local function use(agent, err)
		if agent then last_used_pane_id = agent.pane_id end
		callback(agent, err)
	end
	M.discover(function(candidates, err)
		if not candidates then
			use(nil, err)
		elseif #candidates == 0 then
			M.spawn(use)
		else
			select_agent(candidates, function(agent)
				use(agent, agent == nil and "Pi selection cancelled" or nil)
			end)
		end
	end)
end

function M.focus(agent)
	if not agent then
		vim.notify("Pi control bridge: No Pi pane selected", vim.log.levels.ERROR)
		return
	end
	rex.reveal(agent.pane_id)
end

return M
