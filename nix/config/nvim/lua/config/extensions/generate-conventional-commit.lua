local defaults = {
	agent = {
		cmd = "pi",
		args = {
			"-p",
			"-ne",
			"-ns",
			"--no-session",
			"--mode",
			"text",
			"--model",
			"opencode-go/mimo-v2.5",
			"--thinking",
			"off",
		},
	},

	git = {
		log_args = { "--no-pager", "log", "-n", "10" },
		diff_args = { "--no-pager", "diff", "--cached" },
	},

	max_subject_length = 72,
	prompt = [[
    Generate a Conventional Commit message for the following staged git diff.

    Rules:
    - Output ONLY the commit message.
    - Do not wrap the commit message in a Markdown code block or backticks.
    - Use Conventional Commits format.
    - Prefer one concise subject line
    - Include a brief body explaining the change only when necessary.
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

	local spinner = { "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏" }

	local notification_id = vim.notify("Generating commit message...", vim.log.levels.INFO, {
		timeout = false,
		title = "Generate Commit",
		opts = function(notification)
			notification.icon = spinner[math.floor(vim.uv.hrtime() / (1e6 * 80)) % #spinner + 1]
		end,
	})

	local cmd = vim.list_extend(vim.list_extend({ config.agent.cmd }, config.agent.args), { prompt })

	vim.system(cmd, { text = true }, function(result)
		vim.schedule(function()
			if result.code ~= 0 then
				vim.notify(config.agent.cmd .. " failed: " .. (result.stderr or ""), vim.log.levels.ERROR, {
					id = notification_id,
					icon = "",
					timeout = 3000,
				})
				return
			end

			local message = vim.trim(result.stdout or "")

			if message == "" then
				vim.notify(config.agent.cmd .. " returned an empty message.", vim.log.levels.WARN, {
					id = notification_id,
					icon = "",
					timeout = 3000,
				})
				return
			end

			vim.api.nvim_buf_set_lines(0, 0, 0, false, vim.split(message, "\n"))

			vim.notify("Commit message generated.", vim.log.levels.INFO, {
				id = notification_id,
				icon = "",
				timeout = 3000,
			})
		end)
	end)
end

function M.setup(opts)
	config = vim.tbl_deep_extend("force", vim.deepcopy(defaults), opts or {})

	vim.api.nvim_create_autocmd("FileType", {
		pattern = "gitcommit",
		callback = function(args)
			vim.api.nvim_buf_create_user_command(args.buf, "GenerateCommit", generate_commit_message, {})

			vim.keymap.set("n", "<leader>cc", generate_commit_message, { noremap = true, silent = true })
		end,
	})
end

return M
