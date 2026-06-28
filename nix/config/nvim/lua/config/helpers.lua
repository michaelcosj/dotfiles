local M = {}

---@param module string
---@param opts table?
M.safeSetup = function(module, opts)
	local ok, plugin = pcall(require, module)
	if not ok then
		vim.notify(("Failed to require %s: %s"):format(module, plugin), vim.log.levels.WARN)
		return
	end

	if plugin.setup then
		plugin.setup(opts)
	end
end

return M
