-- Worktree sessions: a git worktree of a project (made by agent-worktree,
-- under ~/.local/share/worktrees/<repo>/<name>) opened as its own session
-- "<project>:<name>" with the project's tabs, rooted in the worktree.
local util = require("rexkit.util")

local M = {}

local function run(args)
	local argv = { "agent-worktree" }
	for _, a in ipairs(args) do table.insert(argv, a) end
	local r = rex.exec(argv)
	if not r or not r.ok then
		local msg = r and ((r.stderr ~= "" and r.stderr) or r.stdout) or "agent-worktree did not run"
		error((msg:gsub("^agent%-worktree: ", ""):gsub("%s+$", "")), 0)
	end
	return (r.stdout:gsub("%s+$", ""))
end

local function pane_cwd(session_id)
	local view = util.call("session.view", { session_id = session_id })
	for _, w in ipairs(view.windows or {}) do
		for _, layer in ipairs(w.layers or {}) do
			for _, b in ipairs(layer.blocks or {}) do
				local ok, pwd = pcall(util.call, "block.method", { session_id = session_id, block_id = b.block_id, method = "pwd" })
				local cwd = ok and pwd and pwd.pwd and pwd.pwd:match("^file://[^/]*(/.*)$")
				if cwd then return cwd end
			end
		end
	end
end

-- The main checkout for a directory, or nil when it isn't in a git repo.
function M.root_of(dir)
	local ok, root = pcall(run, { "root", "--repo", dir })
	return ok and root or nil
end

-- The project a session belongs to: { item, root } from projects.list(),
-- found by the label first, else by its first pane's repo.
function M.project_of(session_id)
	local projects = require("rexkit.projects")
	local view = util.call("session.view", { session_id = session_id })
	local label = view.label and view.label:match("^([^:]+)")
	local items = projects.list()
	for _, item in ipairs(items) do
		if item.root and item.name == label then return item end
	end
	local cwd = pane_cwd(session_id)
	local root = cwd and M.root_of(cwd)
	if not root then return nil end
	for _, item in ipairs(items) do
		if item.root == root then return item end
	end
	return { name = util.basename(root):gsub("^%.", ""), root = root, tabs = projects.config().default.tabs }
end

M.dir = util.expand(os.getenv("AGENT_WORKTREES") or "~/.local/share/worktrees")

-- Every worktree, by repo folder name (agent-worktree's <repo>, without a
-- leading dot): { dotfiles = { "auth", ... } }. One find, for the picker.
function M.all()
	local out = {}
	local r = rex.exec({ "find", M.dir, "-mindepth", "2", "-maxdepth", "2", "-type", "d" })
	for line in ((r and r.stdout) or ""):gmatch("[^\n]+") do
		local repo, name = line:match("([^/]+)/([^/]+)$")
		if repo then
			out[repo] = out[repo] or {}
			table.insert(out[repo], name)
		end
	end
	return out
end

-- Worktrees of a project as picker items: { name = "<project>:<wt>", root, tabs }.
-- `all` is M.all(), passed in when listing many projects.
function M.items(project, all)
	all = all or M.all()
	local repo = util.basename(project.root):gsub("^%.", "")
	local items = {}
	for _, name in ipairs(all[repo] or {}) do
		table.insert(items, { name = project.name .. ":" .. name, root = M.dir .. "/" .. repo .. "/" .. name, tabs = project.tabs })
	end
	table.sort(items, function(a, b) return a.name < b.name end)
	return items
end

-- Creates the worktree (or finds it) and opens or switches to its session.
function M.open(session_id, name, base)
	local project = M.project_of(session_id)
	if not project then error("this session is not in a git repository", 0) end
	local args = { "new", name, "--repo", project.root }
	if base and base ~= "" then
		table.insert(args, "--base")
		table.insert(args, base)
	end
	local path = run(args)
	local projects = require("rexkit.projects")
	local label = project.name .. ":" .. name
	local sid, switched = projects.open_item({ name = label, root = path, tabs = project.tabs }, session_id)
	return sid, switched, label
end

-- Removes this session's worktree, then closes the session. Refusals from
-- agent-worktree (uncommitted or unmerged work) leave both alone.
function M.remove(session_id, force)
	local view = util.call("session.view", { session_id = session_id })
	local project, name = (view.label or ""):match("^([^:]+):(.+)$")
	if not name then error("this session is not a worktree session (<project>:<name>)", 0) end
	local item = M.project_of(session_id)
	if not item or item.name ~= project then error("no project " .. project, 0) end
	local args = { "rm", name, "--repo", item.root }
	if force then table.insert(args, "--force") end
	local out = run(args)
	-- back to the project's session, if it's open, before this one closes
	for _, s in ipairs(util.call("session.list", {}).sessions or {}) do
		if s.label == project then
			require("rexkit.ui").select(s.session_id, session_id)
			break
		end
	end
	util.call("session.destroy", { session_id = session_id })
	return out
end

return M
