local M = {}

-- Configuration
local config = {
	cleanup_interval = 5 * 60 * 1000, -- 5 minutes
	retirement_minutes = 30,
	debounce_ms = 50,
	notify_cleanup = true,
}

-- State
local buffer_last_accessed = {}
local cleanup_timer = nil
local update_timer = nil
local augroup = nil

-- Safely get buffer option
local function get_buf_option(buf, option)
	local success, value = pcall(vim.api.nvim_get_option_value, option, { buf = buf })
	return success and value or nil
end

-- Check if buffer is valid and loaded
local function is_valid_buffer(buf)
	return vim.api.nvim_buf_is_valid(buf) and vim.api.nvim_buf_is_loaded(buf)
end

-- Update access time when entering a buffer
local function update_buffer_access_time()
	local buf = vim.api.nvim_get_current_buf()

	if not is_valid_buffer(buf) then
		return
	end

	local name = vim.api.nvim_buf_get_name(buf)
	local buftype = get_buf_option(buf, "buftype")
	local filetype = get_buf_option(buf, "filetype")

	-- Skip special buffers including snacks explorer
	if name ~= "" and buftype == "" and filetype and not filetype:match("snacks") then
		buffer_last_accessed[buf] = os.time()
	end
end

-- Clean up tracking for deleted buffer
local function remove_buffer_tracking(buf)
	if buffer_last_accessed[buf] then
		buffer_last_accessed[buf] = nil
	end
end

-- Check if buffer is visible in any window
local function is_buffer_visible(buf)
	local windows = vim.api.nvim_list_wins()
	for _, win in ipairs(windows) do
		if vim.api.nvim_win_is_valid(win) then
			local success, win_buf = pcall(vim.api.nvim_win_get_buf, win)
			if success and win_buf == buf then
				return true
			end
		end
	end
	return false
end

-- Check and close inactive buffers
local function cleanup_inactive_buffers()
	local current_time = os.time()
	local retirement_threshold = current_time - (config.retirement_minutes * 60)
	local current_buf = vim.api.nvim_get_current_buf()
	local cleaned_count = 0

	-- Clean up invalid buffer references first
	for buf, _ in pairs(buffer_last_accessed) do
		if not is_valid_buffer(buf) then
			buffer_last_accessed[buf] = nil
		end
	end

	local buffers = vim.api.nvim_list_bufs()

	for _, buf in ipairs(buffers) do
		if buf ~= current_buf and is_valid_buffer(buf) then
			-- Skip if buffer not in tracking table
			local last_accessed = buffer_last_accessed[buf]
			if not last_accessed then
				goto continue
			end

			-- Get buffer properties safely
			local listed = get_buf_option(buf, "buflisted")
			local modified = get_buf_option(buf, "modified")
			local buftype = get_buf_option(buf, "buftype")
			local name = vim.api.nvim_buf_get_name(buf)

			-- Skip if we couldn't get required options
			if listed == nil or modified == nil or buftype == nil then
				goto continue
			end

			-- Skip special buffers and modified files
			if listed and name ~= "" and not modified and buftype == "" then
				if last_accessed < retirement_threshold and not is_buffer_visible(buf) then
					-- Try to delete buffer safely
					local success, err = pcall(vim.api.nvim_buf_delete, buf, { force = false })
					if success then
						buffer_last_accessed[buf] = nil
						cleaned_count = cleaned_count + 1
					elseif config.notify_cleanup then
						vim.notify(
							string.format("Failed to delete buffer %d: %s", buf, err or "unknown error"),
							vim.log.levels.WARN
						)
					end
				end
			end
		end
		::continue::
	end

	-- Log the cleanup result
	if config.notify_cleanup then
		if cleaned_count > 0 then
			vim.notify(
				string.format("Buffer cleanup: %d inactive buffer(s) removed", cleaned_count),
				vim.log.levels.INFO
			)
		else
			vim.notify("Buffer cleanup: No inactive buffers to clean", vim.log.levels.INFO)
		end
	end
end

-- Debounced buffer access update
local function debounced_update_access_time()
	if update_timer then
		update_timer:stop()
		update_timer:close()
		update_timer = nil
	end

	update_timer = vim.defer_fn(function()
		update_buffer_access_time()
		update_timer = nil
	end, config.debounce_ms)
end

-- Setup function
function M.setup(opts)
	-- Merge user config
	if opts then
		config = vim.tbl_deep_extend("force", config, opts)
	end

	-- Clean up existing setup
	M.cleanup()

	-- Create autocommand group
	augroup = vim.api.nvim_create_augroup("BufferCleanup", { clear = true })

	-- Track buffer access
	vim.api.nvim_create_autocmd("BufEnter", {
		group = augroup,
		callback = debounced_update_access_time,
		desc = "Update buffer access time when entering a buffer",
	})

	-- Clean up tracking when buffers are deleted
	vim.api.nvim_create_autocmd("BufDelete", {
		group = augroup,
		callback = function(args)
			remove_buffer_tracking(args.buf)
		end,
		desc = "Remove buffer from access tracking when deleted",
	})

	-- Stop timers on exit
	vim.api.nvim_create_autocmd("VimLeavePre", {
		group = augroup,
		callback = M.cleanup,
		desc = "Clean up timers and resources on exit",
	})

	-- Set up cleanup timer
	if cleanup_timer then
		cleanup_timer:stop()
		cleanup_timer:close()
	end

	cleanup_timer = vim.loop.new_timer()
	if cleanup_timer then
		cleanup_timer:start(
			config.cleanup_interval,
			config.cleanup_interval,
			vim.schedule_wrap(cleanup_inactive_buffers)
		)
	end

	-- Create user command
	vim.api.nvim_create_user_command("CleanupInactiveBuffers", cleanup_inactive_buffers, {
		desc = string.format("Clean up buffers that haven't been accessed in %d minutes", config.retirement_minutes),
	})

	return M
end

-- Cleanup function
function M.cleanup()
	-- Stop and close timers
	if cleanup_timer then
		cleanup_timer:stop()
		cleanup_timer:close()
		cleanup_timer = nil
	end

	if update_timer then
		update_timer:stop()
		update_timer = nil
	end

	-- Clear autocommands
	if augroup then
		vim.api.nvim_del_augroup_by_id(augroup)
		augroup = nil
	end

	-- Clear tracking data
	buffer_last_accessed = {}
end

-- Manual cleanup function
function M.cleanup_now()
	cleanup_inactive_buffers()
end

-- Get status information
function M.status()
	local tracked_buffers = 0
	local valid_buffers = 0

	for buf, time in pairs(buffer_last_accessed) do
		tracked_buffers = tracked_buffers + 1
		if is_valid_buffer(buf) then
			valid_buffers = valid_buffers + 1
		end
	end

	return {
		tracked_buffers = tracked_buffers,
		valid_buffers = valid_buffers,
		config = config,
	}
end

-- Auto-setup with default config if called directly
if not pcall(debug.getlocal, 4, 1) then
	M.setup()
end

return M
