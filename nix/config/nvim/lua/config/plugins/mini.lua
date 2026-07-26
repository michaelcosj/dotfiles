local mini_comment_ok, mini_comment = pcall(require, "mini.comment")

if not mini_comment_ok then
	return
end

mini_comment.setup({})
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
