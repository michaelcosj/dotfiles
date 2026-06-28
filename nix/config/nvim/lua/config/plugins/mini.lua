require("config.helpers").safeSetup("mini.comment", {})
require("config.helpers").safeSetup("mini.pairs", {})
require("config.helpers").safeSetup("mini.surround", { n_lines = 100 })

local icons = require("config.helpers").safeSetup("mini.icons", {})
if icons then
	icons.mock_nvim_web_devicons()
end
