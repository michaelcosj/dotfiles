local M = {}

M.defaults = {
	prompt = "Pi: ",
	spawn_timeout_ms = 30000,
	prompts = {
		diagnostics = "Fix the diagnostics in @this",
		document = "Document @this",
		explain = "Explain @this",
		fix = "Fix @this",
		implement = "Implement @this",
		optimize = "Optimize @this",
		review = "Review @this for correctness, security, and maintainability",
		test = "Write tests for @this",
	},
}

M.values = vim.deepcopy(M.defaults)

function M.setup(opts)
	M.values = vim.tbl_deep_extend("force", vim.deepcopy(M.defaults), opts or {})
end

return M
