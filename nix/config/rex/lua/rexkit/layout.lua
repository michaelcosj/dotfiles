-- Layout helpers for projects.lua.
--
--   L.pane{ cmd = "nvim" }            runs nvim in a shell (the shell stays when nvim quits)
--   L.pane{ input = "make deploy" }   types the command but doesn't run it
--   L.pane{ cwd = "web", label = "dev" }  cwd is relative to the project root
--   L.row(a, b, 0.6)                  a left of b, a gets 60%
--   L.col(a, b, 0.3)                  a above b, a gets 30%
local util = require("rexkit.util")

local M = {}

function M.pane(opts)
	return { pane = opts or {} }
end

function M.row(a, b, ratio)
	return { split = { direction = "horizontal", ratio = ratio, before = a, after = b } }
end

function M.col(a, b, ratio)
	return { split = { direction = "vertical", ratio = ratio, before = a, after = b } }
end

local function label_of(p)
	if p.label then return p.label end
	local cmd = p.cmd or p.input
	return cmd and cmd:match("^(%S+)") or nil
end

-- A layout node as session.create / new_layer take it.
function M.to_api(node, root)
	node = node or M.pane()
	if node.split then
		local s = node.split
		return {
			split = {
				direction = s.direction,
				ratio = s.ratio,
				before = M.to_api(s.before, root),
				after = M.to_api(s.after, root),
			},
		}
	end
	local p = node.pane or {}
	local options = { cwd = util.join(root, p.cwd) }
	if p.cmd then
		options.initial_input = p.cmd .. "\r"
	elseif p.input then
		options.initial_input = p.input
	end
	return { block = { flavor = "com.superlogical.terminal.shell", label = label_of(p), options = options } }
end

-- A session.view layout as projects.lua code, for project_snippet.
function M.to_lua(node, panes, indent)
	indent = indent or "\t\t\t"
	if node.split then
		local s = node.split
		local fn = s.direction == "horizontal" and "L.row" or "L.col"
		return string.format(
			"%s(\n%s\t%s,\n%s\t%s,\n%s\t%.2f\n%s)",
			fn,
			indent, M.to_lua(s.before, panes, indent .. "\t"),
			indent, M.to_lua(s.after, panes, indent .. "\t"),
			indent, s.ratio or 0.5,
			indent
		)
	end
	local p = panes[node.block_id] or {}
	local fields = {}
	if p.cmd then table.insert(fields, "cmd = " .. string.format("%q", p.cmd)) end
	if p.cwd then table.insert(fields, "cwd = " .. string.format("%q", p.cwd)) end
	return "L.pane{ " .. table.concat(fields, ", ") .. (#fields > 0 and " " or "") .. "}"
end

return M
