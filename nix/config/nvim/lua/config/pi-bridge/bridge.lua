local uv = vim.uv or vim.loop
local events = require("config.pi-bridge.events")

local M = {
	pipe = nil,
	buffer = "",
	pending = {},
	next_id = 0,
	agent = nil,
}

local function close(reason)
	if M.pipe then
		M.pipe:read_stop()
		M.pipe:close()
	end
	M.pipe = nil
	for _, callback in pairs(M.pending) do
		callback(nil, reason or "Pi bridge disconnected")
	end
	M.pending = {}
	events.emit("disconnected", { message = reason })
end

local function dispatch(message)
	if message.id then
		local callback = M.pending[message.id]
		M.pending[message.id] = nil
		if callback then
			callback(message.result, message.error and message.error.message)
		end
	elseif message.event then
		events.emit(message.event, message.data)
	end
end

local function read_start()
	M.pipe:read_start(function(err, chunk)
		if err then
			vim.schedule(function() close(err) end)
			return
		end
		if not chunk then
			vim.schedule(function() close() end)
			return
		end
		M.buffer = M.buffer .. chunk
		while true do
			local newline = M.buffer:find("\n", 1, true)
			if not newline then
				break
			end
			local line = M.buffer:sub(1, newline - 1)
			M.buffer = M.buffer:sub(newline + 1)
			local ok, decoded = pcall(vim.json.decode, line)
			if ok then
				vim.schedule(function() dispatch(decoded) end)
			end
		end
	end)
end

function M.request(method, params, callback)
	if not M.pipe then
		callback(nil, "Pi bridge is not connected")
		return
	end
	M.next_id = M.next_id + 1
	local id = M.next_id
	M.pending[id] = callback
	M.pipe:write(vim.json.encode({ id = id, method = method, params = params or {} }) .. "\n")
end

function M.connect(agent, callback)
	if M.pipe and M.agent and M.agent.pane_id == agent.pane_id then
		callback(true)
		return
	end
	if M.pipe then
		close()
	end
	local tokens = agent.tokens or {}
	if not tokens.pi_nvim_socket or not tokens.pi_nvim_token then
		callback(nil, "Pi bridge is unavailable; run /reload in the Pi pane")
		return
	end
	M.agent = agent
	M.buffer = ""
	M.pipe = uv.new_pipe(false)
	M.pipe:connect(tokens.pi_nvim_socket, function(err)
		if err then
			vim.schedule(function()
				close(err)
				callback(nil, err)
			end)
			return
		end
		read_start()
		M.request("hello", {
			protocol = tokens.pi_nvim_protocol or "1",
			token = tokens.pi_nvim_token,
			client_id = tostring(uv.os_getpid()),
		}, function(result, request_err)
			if request_err then
				close(request_err)
				callback(nil, request_err)
				return
			end
			events.set_agent(agent)
			events.emit("connected", vim.tbl_extend("force", result or {}, { pane_id = agent.pane_id }))
			callback(true)
		end)
	end)
end

function M.disconnect()
	close()
end

return M
