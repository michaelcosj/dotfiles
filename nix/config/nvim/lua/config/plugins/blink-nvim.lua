require("config.helpers").safeSetup("blink.cmp", {
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
							local kind_icon, _, _ = require("mini.icons").get("lsp", ctx.kind)
							return kind_icon
						end,
						highlight = function(ctx)
							local _, hl, _ = require("mini.icons").get("lsp", ctx.kind)
							return hl
						end,
					},
					label = {
						text = function(ctx)
							return require("colorful-menu").blink_components_text(ctx)
						end,
						highlight = function(ctx)
							return require("colorful-menu").blink_components_highlight(ctx)
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
