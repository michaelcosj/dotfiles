-- Projects for the sessioniser (Ctrl+A f). Each project opens as a Rex
-- session named after its folder, with the tabs below.
--   default    layout for any project without its own
--   groups     every folder directly inside `dir` is a project
--   projects   named projects: with `root` anywhere, or without to override
--              a group's folder of the same name
-- `rex do project_snippet` prints the current session as a projects entry.
local L = require("rexkit.layout")

local edit = {
	name = "edit",
	layout = L.col(L.pane({ cmd = "nvim" }), L.pane(), 0.75),
}
local agent = { name = "agent", layout = L.pane({ cmd = "pi" }) }

return {
	default = { tabs = { edit, agent } },
	groups = {
		{ dir = "~/Projects/personal" },
		{ dir = "~/Projects/work" },
		{ dir = "~/Projects/oss" },
		{ dir = "~/Projects/research" },
		{ dir = "~/Projects/writing" },
	},
	projects = {
		dotfiles = { root = "~/.dotfiles" },
		["ally-api"] = { root = "~/Projects/ally-api" },
	},
}
