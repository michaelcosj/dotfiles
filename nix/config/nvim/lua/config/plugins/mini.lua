require("config.helpers").safeSetup("mini.comment", {})
require("config.helpers").safeSetup("mini.pairs", {})
require("config.helpers").safeSetup("mini.surround", { n_lines = 100 })

require("config.helpers").safeSetup("mini.icons", {})
require("mini.icons").mock_nvim_web_devicons()
