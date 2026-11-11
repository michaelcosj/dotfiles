-- Backend-neutral agent selection for agent-bridge. The backends (herdr.lua,
-- rex.lua) find and start pi panes; this decides which ones match the
-- current directory, how to rank them, and which one to use.
local M = {}

-- Absolute path without a trailing slash, with symlinks resolved when it exists.
function M.canonical(path)
	if not path or path == "" then return nil end
	local real = vim.uv.fs_realpath(path)
	return (real or vim.fs.normalize(path)):gsub("/$", "")
end

-- True when one directory contains the other (or they are the same).
function M.overlaps(a, b)
	a, b = M.canonical(a), M.canonical(b)
	if not a or not b then return false end
	return a == b or a:sub(1, #b + 1) == b .. "/" or b:sub(1, #a + 1) == a .. "/"
end

local function score(agent_cwd, cwd)
	agent_cwd, cwd = M.canonical(agent_cwd), M.canonical(cwd)
	if agent_cwd == cwd then return 100000 end
	return math.min(#(agent_cwd or ""), #(cwd or ""))
end

-- A picker for one backend. cwd_of(agent) gives an agent's directory;
-- label(agent, last_used) its line in the selection menu.
function M.picker(opts)
	local P = { last_used = nil }

	-- Sorts in place: the last used pane first, then the closest directory.
	function P.rank(candidates, cwd)
		table.sort(candidates, function(a, b)
			local a_last, b_last = a.pane_id == P.last_used, b.pane_id == P.last_used
			if a_last ~= b_last then return a_last end
			return score(opts.cwd_of(a), cwd) > score(opts.cwd_of(b), cwd)
		end)
		return candidates
	end

	function P.select(candidates, callback)
		if #candidates == 1 then return callback(candidates[1]) end
		vim.ui.select(candidates, {
			prompt = "Select Pi",
			format_item = function(agent) return opts.label(agent, agent.pane_id == P.last_used) end,
		}, callback)
	end

	-- Uses the one matching agent, asks when there are several, and starts
	-- one with spawn(callback) when there are none. Remembers the choice.
	function P.ensure(discover, spawn, callback)
		local function use(agent, err)
			if agent then P.last_used = agent.pane_id end
			callback(agent, err)
		end
		discover(function(candidates, err)
			if not candidates then
				use(nil, err)
			elseif #candidates == 0 then
				spawn(use)
			else
				P.select(candidates, function(agent)
					use(agent, agent == nil and "Pi selection cancelled" or nil)
				end)
			end
		end)
	end

	return P
end

return M
