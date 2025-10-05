-- buffer_cleanup.lua
local buffer_last_accessed = {}
local cleanup_interval = 5 * 60 * 1000 -- 5 minutes
local retirement_minutes = 30

-- Update access time when entering a buffer
local function update_buffer_access_time()
	local buf = vim.api.nvim_get_current_buf()
	local name = vim.api.nvim_buf_get_name(buf)
	local buftype = vim.api.nvim_get_option_value("buftype", { buf = buf })
	local filetype = vim.api.nvim_get_option_value("filetype", { buf = buf })
	
	-- Skip special buffers including snacks explorer
	if name ~= "" and buftype == "" and not filetype:match("snacks") then
		buffer_last_accessed[buf] = os.time()
	end
end

-- Check and close inactive buffers with current APIs
local function cleanup_inactive_buffers()
	local current_time = os.time()
	local retirement_threshold = current_time - (retirement_minutes * 60)
	local current_buf = vim.api.nvim_get_current_buf()
	local cleaned_count = 0 -- Counter for cleaned buffers

	local buffers = vim.api.nvim_list_bufs()

	for _, buf in ipairs(buffers) do
		if buf ~= current_buf then
			-- Skip if buffer not in tracking table
			if not buffer_last_accessed[buf] then
				goto continue
			end

			-- Use the new API for getting buffer options
			local listed = vim.api.nvim_get_option_value("buflisted", { buf = buf })
			local name = vim.api.nvim_buf_get_name(buf)
			local modified = vim.api.nvim_get_option_value("modified", { buf = buf })
			local buftype = vim.api.nvim_get_option_value("buftype", { buf = buf })

			-- Skip special buffers and modified files
			if listed and name ~= "" and not modified and buftype == "" then
				local last_accessed = buffer_last_accessed[buf]

				if last_accessed and last_accessed < retirement_threshold then
					-- Check if buffer is visible in any window
					local is_visible = false
					local windows = vim.api.nvim_list_wins()

					for _, win in ipairs(windows) do
						if vim.api.nvim_win_get_buf(win) == buf then
							is_visible = true
							break
						end
					end

					-- Close buffer if it's not visible
					if not is_visible then
						vim.api.nvim_buf_delete(buf, { force = false })
						buffer_last_accessed[buf] = nil
						cleaned_count = cleaned_count + 1 -- Increment counter
					end
				end
			end
		end
		::continue::
	end

	-- Log the cleanup result
	if cleaned_count > 0 then
		vim.notify(string.format("Buffer cleanup: %d inactive buffer(s) removed", cleaned_count), vim.log.levels.INFO)
	else
		vim.notify("Buffer cleanup: No inactive buffers to clean", vim.log.levels.INFO)
	end
end

-- Debounce timer to prevent race conditions
local update_timer = nil

-- Set up autocommands
local buffer_tracking_group = vim.api.nvim_create_augroup("BufferTracking", { clear = true })
vim.api.nvim_create_autocmd("BufEnter", {
	group = buffer_tracking_group,
	callback = function()
		if update_timer then
			update_timer:stop()
		end
		update_timer = vim.defer_fn(update_buffer_access_time, 50)
	end,
	desc = "Update buffer access time when entering a buffer",
})

-- Set up timer
local timer = vim.loop.new_timer()
timer:start(cleanup_interval, cleanup_interval, vim.schedule_wrap(cleanup_inactive_buffers))

-- Create a user command to manually trigger cleanup
vim.api.nvim_create_user_command("CleanupInactiveBuffers", cleanup_inactive_buffers, {
	desc = "Clean up buffers that haven't been accessed in 30 minutes",
})
