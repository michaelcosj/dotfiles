require("config.settings")
require("config.plugins")

require("config.extensions.generate-conventional-commit").setup({
	agent = {
		cmd = "opencode",
		args = { "--pure", "-m", "opencode/big-pickle", "--variant", "none", "run" },
	},
})
