local M = {}

M.opts = {
	appearance = {
		use_nvim_cmp_as_default = false,
		nerd_font_variant = "mono",
	},
	signature = { enabled = true, window = { show_documentation = false, border = "rounded" } },
	sources = {
		default = { "copilot", "lazydev", "lsp", "path", "buffer", "snippets" },
		providers = {
			copilot = {
				name = "copilot",
				module = "blink-cmp-copilot",
				score_offset = 100,
				async = true,
			},
			lazydev = {
				name = "LazyDev",
				module = "lazydev.integrations.blink",
				-- make lazydev completions top priority (see `:h blink.cmp`)
				score_offset = 100,
			},
			lsp = {
				fallbacks = {},
			},
			avante = {
				module = "blink-cmp-avante",
				name = "Avante",
				opts = {},
			},
		},
		per_filetype = {
			codecompanion = { "codecompanion", "path", "buffer" },
		},
	},
	completion = {
		documentation = { window = { border = "single" } },
		menu = {
			draw = {
				columns = { { "kind_icon" }, { "label", gap = 1 } },
				components = {
					kind_icon = {
						ellipsis = false,
						text = function(ctx)
							local lspkind = require("lspkind")
							local icon = ctx.kind_icon

							if vim.tbl_contains({ "Path" }, ctx.source_name) then
								local dev_icon, _ = require("nvim-web-devicons").get_icon(ctx.label)
								if dev_icon then
									icon = dev_icon
								end
							elseif vim.tbl_contains({ "copilot" }, ctx.source_name) then
								icon = " "
							else
								icon = require("lspkind").symbolic(ctx.kind, {
									mode = "symbol",
								})
							end

							return icon .. ctx.icon_gap
						end,

						-- Optionally, use the highlight groups from nvim-web-devicons
						-- You can also add the same function for `kind.highlight` if you want to
						-- keep the highlight groups in sync with the icons.
						highlight = function(ctx)
							local hl = ctx.kind_hl
							if vim.tbl_contains({ "Path" }, ctx.source_name) then
								local dev_icon, dev_hl = require("nvim-web-devicons").get_icon(ctx.label)
								if dev_icon then
									hl = dev_hl
								end
							end
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
	},
}

return M
