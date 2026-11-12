local mini_pairs_ok, mini_pairs = pcall(require, "mini.pairs")

if not mini_pairs_ok then
	return
end

mini_pairs.setup({})
local mini_surround_ok, mini_surround = pcall(require, "mini.surround")

if not mini_surround_ok then
	return
end

mini_surround.setup({ n_lines = 100 })

local icons_ok, icons = pcall(require, "mini.icons")

if not icons_ok then
	return
end

icons.setup({})
icons.mock_nvim_web_devicons()

-- mini.diff draws the agent review's inline layout (agent-bridge/changes.lua)
-- only; gitsigns handles git hunks. The "none" source sets no reference
-- text, so buffers show nothing until the review sets one with
-- MiniDiff.set_ref_text(). Its global keys are off.
local diff_ok, diff = pcall(require, "mini.diff")

if diff_ok then
	diff.setup({
		source = diff.gen_source.none(),
		mappings = { apply = "", reset = "", textobject = "", goto_first = "", goto_prev = "", goto_next = "", goto_last = "" },
	})
end
