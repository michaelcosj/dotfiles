-- Pickers (floating pane or tab, per client platform) and session switching,
-- shared by restore and the sessioniser.
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
		-- An app, or a client that didn't name its kind but shows sessions (a
		-- third-party app may not report one). Never a cli or agent: rex do
		-- scripts, rex-watch included, attach to sessions too.
		local kind = c.info and c.info.kind
		local shows = c.session_ids and #c.session_ids > 0
		local is_app = kind == "app" or ((kind == nil or kind == "other") and shows)
		if is_app and c.connection_state == "connected" then
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
-- Returns how many apps switched. A client can refuse: Rex Linux does unless
-- its Remote control setting is on for this host.
function M.select(session_id, from)
	local clients = M.app_clients(from)
	if #clients == 0 then clients = M.app_clients(nil) end
	local switched = 0
	for _, c in ipairs(clients) do
		local ok = pcall(util.call, "client.perform", {
			client_id = c.client_id,
			action = "session.select",
			args = { session_id = session_id },
		})
		if ok then switched = switched + 1 end
	end
	return switched
end

-- The platform of the app showing the session (any app if none shows it), or
-- nil when no app is connected or the app didn't say.
function M.client_platform(session_id)
	local clients = M.app_clients(session_id)
	if #clients == 0 then clients = M.app_clients(nil) end
	local c = clients[1]
	return c and c.info and c.info.platform or nil
end

-- platform.lua's entry for that platform. Missing or broken file: floats on
-- macOS, tabs elsewhere.
function M.presentation(session_id)
	local platform = M.client_platform(session_id)
	local ok, cfg = pcall(dofile, util.config_dir .. "/platform.lua")
	if not ok or type(cfg) ~= "table" then
		cfg = { macos = { picker = "float" }, default = { picker = "tab" } }
	end
	return (platform and cfg[platform]) or cfg.default or { picker = "tab" }, platform
end

-- Opens `argv` as a picker: a floating pane or a new tab, as platform.lua says
-- for the client showing the session. A tab closes when argv exits, since the
-- shell block ends with its command.
function M.present(session_id, argv, opts)
	opts = opts or {}
	if M.presentation(session_id).picker == "float" then return M.float(session_id, argv, opts) end
	return util.call("session.new_window", {
		session_id = session_id,
		window_label = opts.label,
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

return M
