local agents = require("config.agent-bridge.agents")

local M = {}

local picker = agents.picker({
	cwd_of = function(agent) return agent.foreground_cwd or agent.cwd end,
	label = function(agent, last_used)
		local tokens = agent.tokens or {}
		local instance_id = tokens.pi_instance_id or ("[?] " .. agent.pane_id)
		return string.format("%s%s  %s  [%s]", last_used and "󰋚 " or "  ", instance_id, agent.foreground_cwd or agent.cwd or "?", agent.agent_status or "?")
	end,
})

local function notify_error(message)
	vim.notify("Agent bridge: " .. message, vim.log.levels.ERROR)
end

local function run(args, callback)
	vim.system(vim.list_extend({ "herdr" }, args), { text = true }, function(result)
		vim.schedule(function()
			if result.code ~= 0 then
				callback(nil, vim.trim(result.stderr or result.stdout or "Herdr command failed"))
				return
			end
			local ok, value = pcall(vim.json.decode, result.stdout)
			callback(ok and value or result.stdout)
		end)
	end)
end

local function snapshot_value(value)
	return value and value.result and value.result.snapshot or value and value.snapshot or value
end

function M.discover(callback)
	local workspace = vim.env.HERDR_WORKSPACE_ID
	if not workspace then
		callback(nil, "Neovim is not running inside Herdr")
		return
	end
	local cwd = vim.uv.cwd()
	run({ "api", "snapshot" }, function(value, err)
		if not value then
			callback(nil, err)
			return
		end
		local snapshot = snapshot_value(value)
		local candidates = {}
		for _, agent in ipairs(snapshot.agents or {}) do
			if
				agent.workspace_id == workspace
				and agent.agent == "pi"
				and agent.agent_status ~= "done"
				and agents.overlaps(agent.foreground_cwd or agent.cwd, cwd)
			then
				table.insert(candidates, agent)
			end
		end
		picker.rank(candidates, cwd)
		callback(candidates)
	end)
end

local function find_pane_id(value)
	if type(value) ~= "table" then
		return nil
	end
	if type(value.pane_id) == "string" then
		return value.pane_id
	end
	for _, child in pairs(value) do
		local found = find_pane_id(child)
		if found then
			return found
		end
	end
end

local function wait_for_agent(pane_id, deadline, callback)
	M.discover(function(candidates, err)
		if not candidates then
			callback(nil, err)
			return
		end
		for _, agent in ipairs(candidates) do
			if agent.pane_id == pane_id and agent.tokens and agent.tokens.pi_control_socket then
				callback(agent)
				return
			end
		end
		if vim.uv.now() >= deadline then
			callback(nil, "Timed out waiting for Agent bridge; run /reload in the Pi pane")
			return
		end
		vim.defer_fn(function()
			wait_for_agent(pane_id, deadline, callback)
		end, 500)
	end)
end

local function spawn(callback)
	local source_pane = vim.env.HERDR_PANE_ID
	if not source_pane then
		callback(nil, "HERDR_PANE_ID is not set")
		return
	end
	run({ "pane", "split", "--pane", source_pane, "--direction", "right", "--cwd", vim.uv.cwd(), "--no-focus" }, function(value, err)
		if not value then
			callback(nil, err)
			return
		end
		local pane_id = find_pane_id(value)
		if not pane_id then
			callback(nil, "Herdr did not return the new pane ID")
			return
		end
		run({ "agent", "start", "pi", "--kind", "pi", "--pane", pane_id }, function(_, start_err)
			if start_err then
				callback(nil, start_err)
				return
			end
			wait_for_agent(pane_id, vim.uv.now() + require("config.agent-bridge.config").values.spawn_timeout_ms, callback)
		end)
	end)
end

function M.ensure(callback)
	picker.ensure(M.discover, spawn, callback)
end

function M.focus(agent)
	if not agent then
		notify_error("No Pi pane selected")
		return
	end
	run({ "agent", "focus", agent.pane_id }, function(_, err)
		if err then
			notify_error(err)
		end
	end)
end

return M
