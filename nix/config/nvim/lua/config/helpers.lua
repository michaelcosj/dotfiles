local M = {}

---@param str string
M.gh = function(str)
	return "https://www.github.com/" .. str
end

---@param module string
---@param opts table?
M.safeSetup = function(module, opts)
	local ok, plugin = pcall(require, module)
	if not ok then
		vim.notify(("Failed to require %s: %s"):format(module, plugin), vim.log.levels.WARN)
		return nil
	end

	if plugin.setup then
		local setup_ok, err = pcall(plugin.setup, opts)
		if not setup_ok then
			vim.notify(("Failed to setup %s: %s"):format(module, err), vim.log.levels.WARN)
			return nil
		end
	end

	return plugin
end

return M
