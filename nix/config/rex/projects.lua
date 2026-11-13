-- Projects for the sessioniser (Ctrl+A f). Each project opens as a Rex
-- session named after its folder, with the tabs below.
--   hosts      the project list for each server. The server uses the entry
--              for its short hostname (`hostname -s`, lower case), else for
--              its OS (macos, linux, ...), else `default`. Name a host's
--              entry only when its folders differ from its OS's.
--   default    layout for any project without its own
--   groups     every folder directly inside `dir` is a project
--   ordered    list groups in the order above (open sessions first);
--              else all projects sort by name
--   projects   named projects: with `root` anywhere, or without to override
--              a group's folder of the same name
-- `rex do project_snippet` prints the current session as a projects entry.
local L = require("rexkit.layout")

-- nvim on the left (60%), pi on the right (40%).
local main = {
	name = "main",
	layout = L.row(L.pane({ cmd = "nvim" }), L.pane({ cmd = "pi" }), 0.6),
}

return {
	hosts = {
		macos = {
			default = { tabs = { main } },
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
		},
		default = {
			default = { tabs = { main } },
			ordered = true,
			groups = {
				{ dir = "~/Projects", exclude = { "oss" } },
				{ dir = "~/Projects/oss" },
			},
			-- named projects come before every group
			projects = {
				dotfiles = { root = "~/.dotfiles" },
			},
		},
	},
}
