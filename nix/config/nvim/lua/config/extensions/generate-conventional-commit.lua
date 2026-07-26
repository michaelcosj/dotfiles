local defaults = {
	agent = {
		cmd = "opencode",
		args = { "run" },
	},

	git = {
		log_args = { "--no-pager", "log", "-n", "10" },
		diff_args = { "--no-pager", "diff", "--cached" },
	},

	max_subject_length = 72,
	prompt = [[
    Generate a Conventional Commit message for the following staged git diff.

    Rules:
    - Output only the commit message.
    - Use Conventional Commits format.
    - Prefer one concise subject line.
    - Add a body only if it helps explain the change.
    - Use types like feat, fix, refactor, chore, docs, test, perf, build, ci.
  ]],
}

local M = {}

local config = vim.deepcopy(defaults)

local function get_git_diff()
	local cmd = vim.list_extend({ "git" }, config.git.diff_args)

	local result = vim.system(cmd, { text = true }):wait()

	if result.code ~= 0 then
		error("Failed to get git diff: " .. result.stderr)
	end

	return result.stdout
end

local function get_git_log()
	local cmd = vim.list_extend({ "git" }, config.git.log_args)

	local result = vim.system(cmd, { text = true }):wait()

	if result.code ~= 0 then
		error("Failed to get git logs: " .. result.stderr)
	end

	return result.stdout
end

local function generate_commit_message()
	local logs = get_git_log()
	local diff = get_git_diff()

	if diff == nil or diff == "" then
		vim.notify("No staged changes found. Stage files first.", vim.log.levels.WARN)
		return
	end

	local prompt = table.concat({
		"Here is the the recent git logs for context:",
		logs,
		"",
		config.prompt,
		"- Keep the subject under " .. config.max_subject_length .. " characters.",
		"",
		"Diff:",
		diff,
	}, "\n")

	vim.notify("Generating commit message...", vim.log.levels.INFO)

	local cmd = vim.list_extend(vim.list_extend({ config.agent.cmd }, config.agent.args), { prompt })

	vim.system(cmd, { text = true }, function(result)
		vim.schedule(function()
			if result.code ~= 0 then
				vim.notify("OpenCode failed: " .. (result.stderr or ""), vim.log.levels.ERROR)
				return
			end

			local message = vim.trim(result.stdout or "")

			if message == "" then
				vim.notify("OpenCode returned an empty message.", vim.log.levels.WARN)
				return
			end

			vim.api.nvim_buf_set_lines(0, 0, 0, false, vim.split(message, "\n"))

			vim.notify("Commit message generated.", vim.log.levels.INFO)
		end)
	end)
end

function M.setup(opts)
	config = vim.tbl_deep_extend("force", vim.deepcopy(defaults), opts or {})

	vim.api.nvim_create_autocmd("FileType", {
		pattern = "gitcommit",
		callback = function(args)
			vim.api.nvim_buf_create_user_command(args.buf, "GenerateConventionCommit", generate_commit_message, {})
		end,
	})
end

return M
