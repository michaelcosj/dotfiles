-- Runs beside the Rex server (started by launchd/systemd from home-manager):
--   rex do ~/.config/rex/bin/rex-watch.lua --all
-- After a server restart it resumes what panes were running, asking first if
-- restore.lua says so; then it saves a snapshot every 15 seconds.
local dir = debug.getinfo(1, "S").source:gsub("^@", ""):match("^(.*)/bin/[^/]+$")
package.path = dir .. "/lua/?.lua;" .. package.path

local util = require("rexkit.util")
local restore = require("rexkit.restore")
local ui = require("rexkit.ui")

local function log(...)
	io.stderr:write(os.date("%Y-%m-%d %H:%M:%S "), table.concat({ ... }, " "), "\n")
end

-- The prompt needs an app showing a session; wait for one, but not forever.
local function wait_for_app(seconds)
	for _ = 1, seconds / 2 do
		if #ui.app_clients(nil) > 0 then return true end
		rex.sleep(2)
	end
	return false
end

local function resume()
	local snap = restore.unresumed()
	if not snap then return end
	-- let restored panes finish starting their shells
	rex.sleep(2)
	local cfg = restore.config()
	local pending = restore.pending(snap)
	if #pending == 0 or cfg.mode == "off" then
		log("restore: nothing to resume")
		restore.consume(snap)
	elseif cfg.mode == "auto" then
		log("restore: resumed", restore.apply(pending), "panes")
		restore.consume(snap)
	else
		local groups = restore.by_session(pending)
		local lines = {}
		for _, g in ipairs(groups) do
			table.insert(lines, string.format("%s\t%-20s %d pane%s: %s", g.session_id, g.label, #g.panes, #g.panes == 1 and "" or "s", restore.summary(g)))
		end
		util.write_file(util.state_dir .. "/pending.tsv", table.concat(lines, "\n") .. "\n")
		util.write_json(util.state_dir .. "/pending.json", pending)
		if not wait_for_app(600) then
			log("restore: no app connected; run `rex do restore_last` to resume later")
			restore.consume(snap)
			return
		end
		local first = groups[1].session_id
		ui.select(first, nil)
		ui.present(first, { "/bin/sh", ui.bin .. "/rex-pick", "restore" }, { label = "restore", bounds = { 0.15, 0.2, 0.7, 0.5 } })
		log("restore: asking about", #groups, "sessions")
	end
end

local ok, err = pcall(resume)
if not ok then log("restore failed:", tostring(err)) end

local function save()
	local saved, e = pcall(restore.save)
	if not saved then log("snapshot failed:", tostring(e)) end
end

rex.every(15, save)
-- also keeps the script listening, so it runs until the server goes away
rex.on("session_destroyed", save)
