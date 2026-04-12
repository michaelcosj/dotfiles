local M = {}

---@param module string
---@param opts table?
M.safeSetup = function(module, opts)
	local ok, plugin = pcall(require, module)
	if ok and plugin.setup then
		plugin.setup(opts)
	end
end

return M
