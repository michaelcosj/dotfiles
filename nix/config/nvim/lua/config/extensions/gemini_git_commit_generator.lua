local defaults = {
	api = {
		url = "https://generativelanguage.googleapis.com/v1beta/interactions",
		model = "gemini-3.7-flash",
		api_key_var = "GEMINI_COMMIT_HELPER_API_KEY",
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

--- Extract the generated text from the Gemini Interactions API response.
local function extract_text(body)
	local ok, data = pcall(vim.json.decode, body)

	if not ok or type(data) ~= "table" then
		return nil, "Failed to parse API response."
	end

	if data.error then
		return nil, data.error.message or vim.json.encode(data.error)
	end

	-- Response shape: { output = { { type = "message", content = { { type = "text", text = "..." } } } } }
	for _, item in ipairs(data.output or {}) do
		if item.type == "message" and type(item.content) == "table" then
			local texts = {}

			for _, part in ipairs(item.content) do
				if part.type == "text" and part.text and part.text ~= "" then
					table.insert(texts, part.text)
				end
			end

			if #texts > 0 then
				return table.concat(texts, "\n")
			end
		end
	end

	-- Fallbacks for alternate response shapes.
	if type(data.response) == "string" and data.response ~= "" then
		return data.response
	end

	if type(data.output_text) == "string" and data.output_text ~= "" then
		return data.output_text
	end

	return nil, "No text found in API response."
end

local function generate_commit_message()
	local api_key = vim.env[config.api.api_key_var]

	if api_key == nil or api_key == "" then
		vim.notify(config.api.api_key_var .. " is not set.", vim.log.levels.ERROR)
		return
	end

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

	local payload = vim.json.encode({
		model = config.api.model,
		input = prompt,
	})

	local args = {
		"curl",
		"--silent",
		"--show-error",
		"--fail",
		"--location",
		"--max-time",
		"120",
		"-X",
		"POST",
		config.api.url,
		"-H",
		"x-goog-api-key: " .. api_key,
		"-H",
		"Content-Type: application/json",
		"-d",
		payload,
	}

	vim.system(args, { text = true }, function(result)
		vim.schedule(function()
			local function finish(icon, level, msg)
				vim.notify(msg, level, {
					id = notification_id,
					icon = icon,
					timeout = 3000,
				})
			end

			if result.code ~= 0 then
				finish("", vim.log.levels.ERROR, "Gemini request failed: " .. (result.stderr or ""))
				return
			end

			local message, err = extract_text(result.stdout or "")

			if message == nil then
				finish("", vim.log.levels.ERROR, "Gemini: " .. err)
				return
			end

			message = vim.trim(message)

			if message == "" then
				finish("", vim.log.levels.WARN, "Gemini returned an empty message.")
				return
			end

			vim.api.nvim_buf_set_lines(0, 0, 0, false, vim.split(message, "\n"))

			finish("", vim.log.levels.INFO, "Commit message generated.")
		end)
	end)
end

function M.setup(opts)
	config = vim.tbl_deep_extend("force", vim.deepcopy(defaults), opts or {})

	vim.api.nvim_create_autocmd("FileType", {
		pattern = "gitcommit",
		callback = function(args)
			vim.api.nvim_buf_create_user_command(args.buf, "GenerateCommitMessage", generate_commit_message, {})

			vim.keymap.set("n", "<leader>cc", generate_commit_message, { noremap = true, silent = true })
		end,
	})
end

return M
