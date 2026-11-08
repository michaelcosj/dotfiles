-- Agent status for lualine, and the settings pi shows in its own footer.
--
--   󰚩 pi ○            idle (dim)
--   󰚩 pi ●            working (blue)
--   󰚩 pi ⏳ plan       waiting on you (yellow); click to open the review
--   󰁌                 follow is on; click to toggle
--   Δ3                3 files pi changed to review; click to review
--
-- Clicking the agent toggles the agent panel.
local config = require("config.pi-bridge.config")
local events = require("config.pi-bridge.events")

local M = { count = 0 }

-- Tells pi our follow and review settings (and to recount changes), for
-- its footer.
function M.sync(changes_updated)
	local bridge = require("config.pi-bridge.bridge")
	if not bridge.pipe then return end
	bridge.request("set_prefs", {
		follow = config.values.follow,
		review = config.values.review.edits,
		changes_updated = changes_updated or nil,
	}, function() end)
end

-- Recounts the files waiting for review, and tells pi when it changed.
function M.refresh()
	local n = #require("config.pi-bridge.changes").list()
	local changed = n ~= M.count
	M.count = n
	if changed then
		M.sync(true)
		pcall(function() require("lualine").refresh({ place = { "statusline" } }) end)
	end
end

local function waiting()
	local req = require("config.pi-bridge.requests").active
	if req then return req.kind == "review_plan" and "plan" or "edit" end
	if events.state == "blocked" then return events.message and events.message:sub(1, 20) or "you" end
end

function M.agent()
	local name = "pi"
	local w = waiting()
	if w then return "󰚩 " .. name .. " ⏳ " .. w end
	return "󰚩 " .. name .. (events.state == "working" and " ●" or " ○")
end

function M.agent_color()
	if waiting() then return "DiagnosticWarn" end
	if events.state == "working" then return "DiagnosticInfo" end
	return "Comment"
end

function M.agent_click()
	if waiting() then return require("config.pi-bridge.requests").resume() end
	require("config.agent-panel").toggle()
end

-- lualine components, in order.
function M.components()
	local in_mux = function() return vim.env.HERDR_WORKSPACE_ID ~= nil or vim.env.REX_SESSION ~= nil end
	return {
		{
			M.agent,
			color = M.agent_color,
			on_click = M.agent_click,
			cond = function() return in_mux() and events.state ~= "disconnected" end,
		},
		{
			function() return "󰁌" end,
			color = "DiagnosticInfo",
			on_click = function() require("config.pi-bridge.follow").toggle() end,
			cond = function() return config.values.follow end,
		},
		{
			function() return "Δ" .. M.count end,
			color = "DiagnosticWarn",
			on_click = function() require("config.pi-bridge.changes").open() end,
			cond = function() return M.count > 0 end,
		},
	}
end

function M.setup()
	local group = vim.api.nvim_create_augroup("pi_bridge_statusline", { clear = true })
	vim.api.nvim_create_autocmd("User", {
		group = group,
		pattern = "PiEvent:connected",
		callback = function()
			M.sync(false)
			M.refresh()
		end,
	})
	vim.api.nvim_create_autocmd("User", {
		group = group,
		pattern = { "PiEvent:file_edited", "PiEvent:agent_settled" },
		callback = function() vim.defer_fn(M.refresh, 100) end,
	})
	-- you might revert a file yourself, or switch branches
	vim.api.nvim_create_autocmd({ "BufWritePost", "FocusGained" }, {
		group = group,
		callback = function() M.refresh() end,
	})
	-- committing counts as reviewing (see committed() in changes.lua)
	vim.api.nvim_create_autocmd("User", {
		group = group,
		pattern = { "NeogitCommitComplete", "NeogitRebase", "NeogitReset", "NeogitBranchCheckout", "NeogitPullComplete" },
		callback = function() vim.defer_fn(M.refresh, 100) end,
	})
	vim.schedule(M.refresh)
end

return M
