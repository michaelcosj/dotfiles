-- Session restore, on top of Rex's own.
--
-- Rex already restores sessions, windows, splits, floats and each pane's
-- working directory when its server restarts, keeping block IDs. What it
-- can't bring back is the program a pane was running: every pane returns as
-- a fresh shell. So this records, per block, what was running (and for pi
-- and Claude Code, which conversation), and after a restart types it back in.
local util = require("rexkit.util")

local M = {}

local terminal = "com.superlogical.terminal.shell"
local shells = { fish = true, zsh = true, bash = true, sh = true, dash = true, nu = true, login = true }

M.snapshot_path = util.state_dir .. "/snapshot.json"
M.last_path = util.state_dir .. "/last-restore.json"

local defaults = {
	mode = "ask", -- "ask", "auto" or "off"
	exclude = {}, -- commands never saved: the pane comes back as a plain shell
	rerun = {}, -- commands run again; anything else is typed in but not run
	exclude_sessions = {}, -- session labels never saved
}

function M.config()
	local cfg = util.load_config(util.config_dir .. "/restore.lua") or {}
	for k, v in pairs(defaults) do
		if cfg[k] == nil then cfg[k] = v end
	end
	return cfg
end

local function call_block(session_id, block_id, method, args)
	local ok, res = pcall(util.call, "block.method", { session_id = session_id, block_id = block_id, method = method, args = args })
	if ok then return res end
end

local function command_line(pid)
	local r = rex.exec({ "ps", "-o", "args=", "-p", tostring(pid) })
	if r and r.ok then return (r.stdout:gsub("%s+$", "")) end
end

local function name_of(fg)
	local argv0 = (fg.argv0 or fg.name or ""):gsub("^%-", "")
	return util.basename(argv0)
end

-- The agents' own records: pi writes one per pane (extensions/rex-session.ts),
-- Claude Code keeps ~/.claude/sessions/<pid>.json.
local function agent_resume(name, fg, block_id)
	if name == "pi" then
		local id = block_id:gsub("^block:", "")
		local rec = util.read_json(util.state_dir .. "/agents/" .. id .. ".json")
		if rec and rec.session_file then
			return "pi --session " .. util.quote(rec.session_file), { kind = "pi", session = rec.session_file }
		end
	elseif name == "claude" then
		local rec = util.read_json(util.home .. "/.claude/sessions/" .. tostring(fg.pid) .. ".json")
		if rec and rec.sessionId then
			return "claude --resume " .. rec.sessionId, { kind = "claude", session = rec.sessionId }
		end
	end
end

-- What one pane is running, or nil when it is an idle shell or excluded.
function M.describe(cfg, session, block)
	local proc = call_block(session.session_id, block.block_id, "process")
	local fg = proc and proc.foreground
	if not fg or not fg.pid then return nil end
	local name = name_of(fg)
	if shells[name] then return nil end

	local cmd = command_line(fg.pid) or name
	-- a Nix store path would pin a build that garbage collection removes
	cmd = cmd:gsub("^/nix/store/[^/]+/bin/(%S+)", "%1")
	-- Neovim's own session (resession) brings back its buffers, and the Nix
	-- wrapper's injected --cmd arguments shouldn't be replayed
	if name == "nvim" then cmd = "nvim" end
	if util.matches_any(cmd, cfg.exclude) or util.matches_any(name, cfg.exclude) then return nil end

	local entry = {
		session_id = session.session_id,
		session_label = session.label,
		block_id = block.block_id,
		label = block.label,
		cwd = fg.cwd,
		program = name,
	}
	local resume, agent = agent_resume(name, fg, block.block_id)
	if resume then
		entry.command, entry.mode, entry.agent = resume, "run", agent
	else
		entry.command = cmd
		entry.mode = (util.matches_any(cmd, cfg.rerun) or util.matches_any(name, cfg.rerun)) and "run" or "prefill"
	end
	return entry
end

function M.capture()
	local cfg = M.config()
	local status = util.call("server.status", {})
	local panes = {}
	for _, s in ipairs(util.call("session.list", {}).sessions or {}) do
		if not util.matches_any(s.label or "", cfg.exclude_sessions) then
			local blocks = util.call("session.list_blocks", { session_id = s.session_id }).blocks or {}
			for _, b in ipairs(blocks) do
				-- ps only sees this machine's processes
				if b.flavor == terminal and (b.host_id == nil or b.host_id == status.host_id) then
					local e = M.describe(cfg, s, b)
					if e then table.insert(panes, e) end
				end
			end
		end
	end
	return {
		version = 1,
		saved_at = os.time(),
		instance_id = status.instance_id,
		host_id = status.host_id,
		panes = panes,
	}
end

-- Saves a snapshot, unless the one on disk is from an earlier server run
-- and hasn't been resumed yet: that one is what the next restore needs.
function M.save()
	local status = util.call("server.status", {})
	local old = util.read_json(M.snapshot_path)
	if old and old.instance_id ~= status.instance_id and not old.resumed then return false end
	util.write_json(M.snapshot_path, M.capture())
	return true
end

local function live_blocks()
	local live = {}
	for _, s in ipairs(util.call("session.list", {}).sessions or {}) do
		for _, b in ipairs(util.call("session.list_blocks", { session_id = s.session_id }).blocks or {}) do
			live[b.block_id] = s
		end
	end
	return live
end

local function idle_shell(e)
	local proc = call_block(e.session_id, e.block_id, "process")
	local fg = proc and proc.foreground
	return fg and shells[name_of(fg)] and fg or nil
end

-- Panes from `snap` that came back and sit at a shell, waiting to resume.
function M.pending(snap)
	local out = {}
	if not snap then return out end
	local live = live_blocks()
	for _, e in ipairs(snap.panes or {}) do
		local s = live[e.block_id]
		if s then
			e.session_label = s.label or e.session_label
			if idle_shell(e) then table.insert(out, e) end
		end
	end
	return out
end

-- The snapshot from the previous server run, if it still needs resuming.
function M.unresumed()
	local snap = util.read_json(M.snapshot_path)
	if not snap or snap.resumed then return nil end
	local status = util.call("server.status", {})
	if snap.instance_id == status.instance_id then return nil end
	return snap
end

-- Marks the snapshot handled and keeps a copy, so `restore_last` can still
-- resume it after a skip.
function M.consume(snap)
	snap.resumed = os.time()
	util.write_json(M.last_path, snap)
	util.write_json(M.snapshot_path, snap)
end

function M.apply(entries)
	local done = 0
	for _, e in ipairs(entries) do
		local fg = idle_shell(e)
		if fg then
			local cmd = e.command
			if e.cwd and fg.cwd and e.cwd ~= fg.cwd then cmd = "cd " .. util.quote(e.cwd) .. " && " .. cmd end
			local data = cmd .. (e.mode == "run" and "\r" or "")
			if call_block(e.session_id, e.block_id, "write", { data = data }) then done = done + 1 end
		end
	end
	return done
end

-- Groups pending panes by session, for the prompt.
function M.by_session(entries)
	local order, groups = {}, {}
	for _, e in ipairs(entries) do
		local g = groups[e.session_id]
		if not g then
			g = { session_id = e.session_id, label = e.session_label or e.session_id, panes = {} }
			groups[e.session_id] = g
			table.insert(order, g)
		end
		table.insert(g.panes, e)
	end
	return order
end

function M.summary(group)
	local parts = {}
	for _, e in ipairs(group.panes) do
		local what = e.agent and (e.program .. " (resume)") or e.program
		if e.mode == "prefill" then what = what .. " (typed, not run)" end
		table.insert(parts, what)
	end
	return table.concat(parts, ", ")
end

return M
