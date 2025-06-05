return {
	name = "rector",
	builder = function()
		return {
			cmd = { "./vendor/bin/rector" },
			args = { "process" },
			cwd = vim.fn.getcwd(),
			components = {
				"default",
				-- {
				-- 	"restart_on_save",
				-- 	paths = {
				-- 		"./app",
				-- 		"./bootstrap",
				-- 		"./config",
				-- 		"./public",
				-- 		"./resources",
				-- 		"./routes",
				-- 		"./tests",
				-- 	},
				-- },
			},
		}
	end,
	condition = {
		filetype = { "php" },
		callback = function()
			return vim.fn.executable("./vendor/bin/rector") == 1
		end,
	},
	desc = "Run Rector PHP refactoring tool with file watching",
}
