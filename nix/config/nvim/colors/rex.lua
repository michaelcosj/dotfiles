-- Colors from the Rex terminal's theme; see lua/config/rex-theme.lua.
local rex = require("config.rex-theme")
rex.load()
if rex.in_rex() then rex.setup() end
