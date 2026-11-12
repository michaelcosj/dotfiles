local M = {}

M.defaults = {
	prompt = "Pi: ",
	spawn_timeout_ms = 30000,
	-- Connect to a pi running in this project without waiting for a prompt,
	-- so pi can ask for reviews and see ambient context.
	auto_connect = true,
	-- Send the current file, cursor and selection to pi as you move.
	ambient = true,
	-- Autofollow: show each file pi reads or edits, at the line it's working
	-- on, without leaving the agent pane. Toggle with <leader>aw or :AgentFollow.
	follow = false,
	-- Review everything pi changed since you last reviewed (<leader>ad or
	-- :AgentChanges), against the file as it was before pi touched it.
	changes = {
		-- "inline": one window, the agent's changes drawn over the file
		-- (needs mini.diff). "side-by-side": before | after. <leader>rt
		-- switches while reviewing.
		layout = "inline",
		-- Only list files under Neovim's working directory.
		cwd_only = true,
		-- Say how many files pi changed when it finishes a turn.
		notify = true,
	},
	review = {
		-- Review each edit in a diff before it lands: "always", "open" (files
		-- open in Neovim) or "off". Off by default; review afterwards with
		-- <leader>ad instead.
		edits = "off",
		-- Open plans pi submits with submit_plan for review.
		plans = true,
		-- Switch to Neovim (and hide a floating agent panel) for each review.
		focus = true,
	},
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
