-- Agent status for lualine, and the settings pi shows in its own footer.
--
--   󰚩 π ○             idle (dim)
--   󰚩 π ●             working (blue)
--   󰚩 π ◐ 2           pi idle, 2 subagents or background jobs running (cyan)
--   󰚩 π ● 2           working, and 2 subagents or jobs running (blue)
--   󰚩 π ⏳ plan        waiting on you (yellow); click to open the review
--   󰁌                 follow is on; click to toggle
--   Δ3                3 files pi changed to review; click to review
--
-- Clicking the agent toggles the agent panel.
local config = require("config.agent-bridge.config")
local events = require("config.agent-bridge.events")

local M = { count = 0 }

-- Tells pi our follow and review settings (and to recount changes), for
-- its footer.
function M.sync(changes_updated)
	local bridge = require("config.agent-bridge.bridge")
	if not bridge.pipe then return end
	bridge.request("set_prefs", {
		follow = config.values.follow,
		review = config.values.review.edits,
		changes_updated = changes_updated or nil,
	}, function() end)
end

-- Recounts the files waiting for review in the background, and tells pi
-- and lualine when the count changed. The statusline only reads M.count.
function M.refresh()
	require("config.agent-bridge.changes").count_async(function(n)
		if n == M.count then return end
		M.count = n
		M.sync(true)
		pcall(function() require("lualine").refresh({ place = { "statusline" } }) end)
	end)
end

local function waiting()
	local req = require("config.agent-bridge.requests").active
	if req then return req.kind == "review_plan" and "plan" or "edit" end
	if events.state == "blocked" then
		local msg = events.message or ""
		if msg == "" then return "you" end
		if #msg <= 20 then return msg end
		-- cut at a word: "Questionnaire waiting for your answer" -> "Questionnaire…"
		return (msg:sub(1, 20):match("^(.*%S)%s") or msg:sub(1, 19)) .. "…"
	end
end

function M.agent()
	local w = waiting()
	if w then return "󰚩 π ⏳ " .. w end
	local busy = events.busy or 0
	local dot = events.state == "working" and "●" or busy > 0 and "◐" or "○"
	return "󰚩 π " .. dot .. (busy > 0 and " " .. busy or "")
end

function M.agent_color()
	if waiting() then return "DiagnosticWarn" end
	if events.state == "working" then return "DiagnosticInfo" end
	if (events.busy or 0) > 0 then return "DiagnosticHint" end
	return "Comment"
end

function M.agent_click()
	if waiting() then return require("config.agent-bridge.requests").resume() end
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
			on_click = function() require("config.agent-bridge.follow").toggle() end,
			cond = function() return config.values.follow end,
		},
		{
			function() return "Δ" .. M.count end,
			color = "DiagnosticWarn",
			on_click = function() require("config.agent-bridge.changes").open() end,
			cond = function() return M.count > 0 end,
		},
	}
end

function M.setup()
	local group = vim.api.nvim_create_augroup("agent_bridge_statusline", { clear = true })
	vim.api.nvim_create_autocmd("User", {
		group = group,
		pattern = "AgentEvent:connected",
		callback = function()
			M.sync(false)
			M.refresh()
		end,
	})
	vim.api.nvim_create_autocmd("User", {
		group = group,
		pattern = { "AgentEvent:file_edited", "AgentEvent:agent_settled" },
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
