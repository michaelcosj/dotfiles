-- Floating panes and session switching, shared by restore and the sessioniser.
local util = require("rexkit.util")

local M = {}

M.bin = util.config_dir .. "/bin"

local function active_window(session_id)
	local ok, view = pcall(util.call, "session.view", { session_id = session_id })
	if ok and view then return view.active_window_id end
end

-- Opens `argv` in a new floating pane at the front of the session's active
-- window. Bounds are fractions of the window: { x, y, w, h }.
function M.float(session_id, argv, opts)
	opts = opts or {}
	return util.call("session.new_layer", {
		session_id = session_id,
		window_id = opts.window_id or active_window(session_id),
		bounds = opts.bounds or { 0.2, 0.15, 0.6, 0.6 },
		focus = opts.focus ~= false,
		layout = {
			block = {
				flavor = "com.superlogical.terminal.shell",
				label = opts.label,
				options = { command = argv, cwd = opts.cwd },
			},
		},
	})
end

function M.app_clients(session_id)
	local out = {}
	for _, c in ipairs(util.call("client.list", {}).clients or {}) do
		if c.info and c.info.kind == "app" and c.connection_state == "connected" then
			local has = session_id == nil
			for _, sid in ipairs(c.session_ids or {}) do
				if sid == session_id then has = true end
			end
			if has then table.insert(out, c) end
		end
	end
	return out
end

-- Shows `session_id` in the apps that are showing `from` (every app if nil).
function M.select(session_id, from)
	local clients = M.app_clients(from)
	if #clients == 0 then clients = M.app_clients(nil) end
	for _, c in ipairs(clients) do
		pcall(util.call, "client.perform", {
			client_id = c.client_id,
			action = "session.select",
			args = { session_id = session_id },
		})
	end
end

return M
