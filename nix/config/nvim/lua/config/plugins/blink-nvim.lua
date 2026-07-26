local mini_icons_ok, mini_icons = pcall(require, "mini.icons")

if not mini_icons_ok then
	return
end

mini_icons.setup({})
local colorful_menu_ok, colorful_menu = pcall(require, "colorful-menu")

if not colorful_menu_ok then
	return
end

colorful_menu.setup({})
-- add the following lines to your blink.cmp config

local blink_cmp_ok, blink_cmp = pcall(require, "blink.cmp")

if not blink_cmp_ok then
	return
end

blink_cmp.setup({
	appearance = {
		use_nvim_cmp_as_default = false,
		nerd_font_variant = "mono",
	},
	signature = {
		enabled = true,
		window = { show_documentation = false, border = "rounded" },
	},
	sources = {
		default = { "lazydev", "lsp", "path", "buffer", "snippets" },
		providers = {
			lazydev = {
				name = "LazyDev",
				module = "lazydev.integrations.blink",
				score_offset = 100,
				enabled = function()
					local ft = vim.bo.filetype
					if ft == "lua" then
						return true
					end

					return false
				end,
			},
		},
	},
	completion = {
		documentation = { window = { border = "single" } },
		ghost_text = {
			enabled = false,
			show_with_menu = true,
		},
		menu = {
			auto_show = true,
			draw = {
				columns = { { "kind_icon" }, { "label", gap = 1 } },
				components = {
					kind_icon = {
						ellipsis = false,
						text = function(ctx)
							if not mini_icons then
								return ""
							end

							local kind_icon, _, _ = mini_icons.get("lsp", ctx.kind)
							return kind_icon
						end,
						highlight = function(ctx)
							if not mini_icons then
								return nil
							end

							local _, hl, _ = mini_icons.get("lsp", ctx.kind)
							return hl
						end,
					},
					label = {
						text = function(ctx)
							if not colorful_menu then
								return ctx.label
							end

							return colorful_menu.blink_components_text(ctx)
						end,
						highlight = function(ctx)
							if not colorful_menu then
								return nil
							end

							return colorful_menu.blink_components_highlight(ctx)
						end,
					},
				},
			},
		},
		trigger = { prefetch_on_insert = false },
		list = {
			selection = {
				auto_insert = false,
			},
		},
	},
})
