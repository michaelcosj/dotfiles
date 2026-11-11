-- Ctrl+A prefix, matching the tmux and Herdr configurations.
rex.bind("ctrl+a>ctrl+a", "pane.send_key", { key = "ctrl+a" })
rex.bind("ctrl+a>r", "client.config.reload")
rex.bind("ctrl+a>shift+r", "client.config.reload")
rex.bind("ctrl+a>c", "client.tab.new")
-- : is Shift+; on a US keyboard, like tmux's command prompt.
rex.bind("ctrl+a>shift+;", "client.palette.toggle")

-- | is Shift+Backslash on a US keyboard; Rex matches unshifted keys.
rex.bind("ctrl+a>shift+\\", "pane.split", { direction = "right" })
rex.bind("ctrl+a>-", "pane.split", { direction = "down" })
rex.bind("ctrl+a>h", "pane.focus", { direction = "left" })
rex.bind("ctrl+a>j", "pane.focus", { direction = "down" })
rex.bind("ctrl+a>k", "pane.focus", { direction = "up" })
rex.bind("ctrl+a>l", "pane.focus", { direction = "right" })
rex.bind("ctrl+a>shift+h", "pane.resize", { direction = "left" })
rex.bind("ctrl+a>shift+j", "pane.resize", { direction = "down" })
rex.bind("ctrl+a>shift+k", "pane.resize", { direction = "up" })
rex.bind("ctrl+a>shift+l", "pane.resize", { direction = "right" })
rex.bind("ctrl+a>z", "pane.zoom")
rex.bind("ctrl+a>m", "pane.minimize_floating")

-- Accept both Herdr's p/n and tmux's Ctrl+P/Ctrl+N.
rex.bind("ctrl+a>p", "client.tab.previous")
rex.bind("ctrl+a>n", "client.tab.next")
rex.bind("ctrl+a>ctrl+p", "client.tab.previous")
rex.bind("ctrl+a>ctrl+n", "client.tab.next")
rex.bind("ctrl+a>shift+,", "client.tab.move", { direction = "backward" })
rex.bind("ctrl+a>shift+.", "client.tab.move", { direction = "forward" })

-- Use Rex's session picker in place of the project sessionizer.
rex.bind("ctrl+a>s", "session.switch")
rex.bind("ctrl+a>shift+s", "session.switch")

-- Session restore and the project sessioniser (lua/rexkit, configured by
-- projects.lua and restore.lua). bin/rex-watch.lua, started beside the
-- server, saves snapshots and resumes them after a restart.
local rex_dir = (os.getenv("XDG_CONFIG_HOME") or (os.getenv("HOME") .. "/.config")) .. "/rex"
package.path = rex_dir .. "/lua/?.lua;" .. package.path

local util = require("rexkit.util")
local restore = require("rexkit.restore")
local projects = require("rexkit.projects")
local ui = require("rexkit.ui")

rex.action({
	name = "project_pick",
	title = "Open Project",
	description = "Pick a project to open as a session, or switch to its open session.",
	category = "Projects",
	run = function(ctx)
		assert(ctx.session_id, "project_pick needs a session")
		ui.float(ctx.session_id, { "/bin/sh", ui.bin .. "/rex-pick", "projects" }, {
			label = "projects",
			bounds = { 0.2, 0.15, 0.6, 0.6 },
		})
	end,
})

rex.action({
	name = "project_list",
	title = "List Projects",
	category = "Projects",
	run = function()
		return projects.lines()
	end,
})

rex.action({
	name = "project_open",
	title = "Open Project by Name",
	category = "Projects",
	args = { type = "object", properties = { name = { type = "string" } }, required = { "name" } },
	run = function(ctx, args)
		return { session_id = projects.open(args.name, ctx.session_id) }
	end,
})

rex.action({
	name = "project_snippet",
	title = "Copy Session as Project",
	description = "This session's tabs as a projects.lua entry.",
	category = "Projects",
	run = function(ctx)
		assert(ctx.session_id, "project_snippet needs a session")
		return projects.snippet(ctx.session_id)
	end,
})

rex.action({
	name = "restore_save",
	title = "Save Restore Snapshot",
	category = "Restore",
	run = function()
		return { saved = restore.save() }
	end,
})

-- Called by `rex-pick restore` with the sessions the user kept selected.
rex.action({
	name = "restore_selected",
	title = "Resume Selected Sessions",
	category = "Restore",
	args = { type = "object", properties = { ids = { type = "string" } }, required = { "ids" } },
	run = function(_, args)
		local keep = {}
		for id in args.ids:gmatch("[^,]+") do keep[id] = true end
		local pending = util.read_json(util.state_dir .. "/pending.json") or {}
		local chosen = {}
		for _, e in ipairs(pending) do
			if keep[e.session_id] then table.insert(chosen, e) end
		end
		local done = restore.apply(chosen)
		local snap = restore.unresumed()
		if snap then restore.consume(snap) end
		return { resumed = done }
	end,
})

rex.action({
	name = "restore_skip",
	title = "Skip Restore",
	category = "Restore",
	run = function()
		local snap = restore.unresumed()
		if snap then restore.consume(snap) end
		return { skipped = snap ~= nil }
	end,
})

-- Resumes the last snapshot's panes that still sit at an idle shell, e.g.
-- after skipping the prompt.
rex.action({
	name = "restore_last",
	title = "Resume Last Snapshot",
	category = "Restore",
	run = function()
		local snap = restore.unresumed() or util.read_json(restore.last_path)
		if not snap then return { resumed = 0 } end
		local done = restore.apply(restore.pending(snap))
		if not snap.resumed then restore.consume(snap) end
		return { resumed = done }
	end,
})

rex.bind("ctrl+a>f", "project_pick")

-- Worktree sessions (lua/rexkit/worktrees.lua, bin/agent-worktree): a git
-- worktree of this session's project, opened as session <project>:<name>.
local worktrees = require("rexkit.worktrees")

rex.action({
	name = "worktree_pick",
	title = "Open Worktree",
	description = "Pick or name a git worktree of this project and open it as its own session.",
	category = "Projects",
	keywords = "git worktree branch",
	run = function(ctx)
		assert(ctx.session_id, "worktree_pick needs a session")
		local project = worktrees.project_of(ctx.session_id)
		assert(project, "this session is not in a git repository")
		ui.float(ctx.session_id, { "/bin/sh", ui.bin .. "/rex-pick", "worktree" }, {
			label = "worktrees",
			bounds = { 0.25, 0.2, 0.5, 0.5 },
			cwd = project.root,
		})
	end,
})

rex.action({
	name = "worktree_new",
	title = "New Worktree Session",
	category = "Projects",
	args = { type = "object", properties = { name = { type = "string" }, base = { type = "string" } }, required = { "name" } },
	run = function(ctx, args)
		assert(ctx.session_id, "worktree_new needs a session")
		return { session_id = worktrees.open(ctx.session_id, args.name, args.base) }
	end,
})

rex.action({
	name = "worktree_remove",
	title = "Remove This Worktree",
	description = "Remove this session's worktree and its branch, then close the session. Refuses uncommitted or unmerged work.",
	category = "Projects",
	keywords = "git worktree delete close",
	run = function(ctx)
		assert(ctx.session_id, "worktree_remove needs a session")
		return { removed = worktrees.remove(ctx.session_id, false) }
	end,
})

rex.bind("ctrl+a>w", "worktree_pick")

-- Floating and docking panes (lua/rexkit/dock.lua).
local dock = require("rexkit.dock")

rex.action({
	name = "pane_float_focused",
	title = "Float Pane",
	description = "Move the focused pane out of the layout into a floating pane.",
	category = "Panes",
	keywords = "float undock pop out",
	run = function(ctx)
		assert(ctx.session_id and ctx.block_id, "pane_float_focused needs a focused pane")
		return dock.float(ctx.session_id, ctx.block_id)
	end,
})

rex.action({
	name = "pane_dock_focused",
	title = "Dock Floating Pane",
	description = "Put the focused floating pane back in the layout, along the edge it is nearest.",
	category = "Panes",
	keywords = "dock tile unfloat",
	run = function(ctx)
		assert(ctx.session_id and ctx.block_id, "pane_dock_focused needs a focused pane")
		return dock.dock(ctx.session_id, ctx.block_id)
	end,
})

-- Used by Neovim's agent panel: puts a pane (tiled, floating or detached)
-- along one edge of a tab at its full height or width.
rex.action({
	name = "pane_dock_edge",
	title = "Dock Pane at Edge",
	category = "Panes",
	args = {
		block_id = "string",
		side = "string?",
		size = "number?",
		window_id = "string?",
		focus = "boolean?",
		session_id = "string?",
	},
	run = function(ctx, args)
		local session_id = args.session_id or ctx.session_id
		assert(session_id, "pane_dock_edge needs a session")
		return dock.edge(session_id, args.block_id, args)
	end,
})

rex.action({
	name = "pane_float_block",
	title = "Float Pane by ID",
	category = "Panes",
	args = { block_id = "string", bounds = "array?", session_id = "string?" },
	run = function(ctx, args)
		local session_id = args.session_id or ctx.session_id
		assert(session_id, "pane_float_block needs a session")
		return dock.float(session_id, args.block_id, args.bounds)
	end,
})

rex.bind("ctrl+a>shift+f", "pane_float_focused")
rex.bind("ctrl+a>shift+d", "pane_dock_focused")
