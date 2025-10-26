-- Enabled configs
vim.lsp.enable({
	"cssls",
	"html",
	"intelephense",
	"jsonls",
	"lua_ls",
	"nixd",
	"oxlint",
	"svelte",
	"ts_ls",
})

-- On attach autocmd
vim.api.nvim_create_autocmd("LspAttach", {
	callback = function(ev)
		-- LSP keymaps
		vim.keymap.set("n", "cd", function()
			vim.lsp.buf.rename()
		end, { desc = "Rename item under the cusor" })

		vim.keymap.set("n", "g.", function()
			vim.lsp.buf.code_action()
		end, { desc = "Code Actions" })

		vim.keymap.set("n", "K", function()
			vim.lsp.buf.hover()
		end, { desc = "Documentation hover floating window" })

		vim.keymap.set("n", "gl", function()
			vim.diagnostic.setloclist({})
		end, { desc = "Diagnostics in quickfix list" })

		vim.keymap.set("n", "gq", function()
			vim.diagnostic.setloclist({})
		end, { desc = "Diagnostics in quickfix list" })

		vim.keymap.set("n", "<leader>d", function()
			vim.diagnostic.open_float(nil, {
				border = "rounded",
			})
		end, { desc = "Open diagnostic float" })
	end,
})

-- Disable LSP features for files above 500kb
local disable_lsp_file_size_limit = 500 * 1024
vim.api.nvim_create_autocmd("BufReadPre", {
	callback = function()
		local size = vim.fn.getfsize(vim.fn.expand("%:p"))
		if size > disable_lsp_file_size_limit then
			-- Disable diagnostics for the buffer
			vim.diagnostic.enable(false, { bufnr = 0 })

			-- Detach LSP clients for this buffer
			local clients = vim.lsp.get_clients({ bufnr = 0 })
			for _, client in ipairs(clients) do
				vim.lsp.buf_detach_client(0, client.id)
			end
		end
	end,
})

-- Auto open diagnostic float
vim.api.nvim_create_autocmd({ "CursorHold", "CursorHoldI" }, {
	group = vim.api.nvim_create_augroup("float_diagnostic", { clear = true }),
	callback = function()
		vim.schedule(function()
			vim.diagnostic.open_float(nil, {
				focus = false,
				border = "rounded",
			})
		end)
	end,
})

local function restart_lsp(bufnr)
	bufnr = bufnr or vim.api.nvim_get_current_buf()
	local clients = vim.lsp.get_clients({ bufnr = bufnr })

	for _, client in ipairs(clients) do
		vim.lsp.stop_client(client.id)
	end

	vim.defer_fn(function()
		vim.cmd("edit")
	end, 100)
end

vim.api.nvim_create_user_command("LspRestart", function()
	restart_lsp()
end, {})

local function lsp_status()
	local bufnr = vim.api.nvim_get_current_buf()
	local clients = vim.lsp.get_clients({ bufnr = bufnr })

	if #clients == 0 then
		vim.notify("󰅚 No LSP clients attached", vim.log.levels.WARN)
		return
	end

	local width = math.max(60, math.min(80, vim.o.columns - 10))
	local lines = {}

	local header = {
		"╭─────────────────────────────────────────────────────────────╮",
		"│                       LSP Status                            │",
		"╰─────────────────────────────────────────────────────────────╯",
	}

	for _, line in ipairs(header) do
		local line_width = vim.fn.strdisplaywidth(line)
		local header_padding = math.floor((width - line_width) / 2)
		table.insert(lines, string.rep(" ", header_padding) .. line .. string.rep(" ", header_padding))
	end

	table.insert(lines, "")
	table.insert(lines, string.format("Buffer: %d | Filetype: %s", bufnr, vim.bo.filetype))
	table.insert(lines, string.format("Total Clients: %d", #clients))
	table.insert(lines, "")

	for i, client in ipairs(clients) do
		table.insert(lines, string.format("┌─ Client %d: %s", i, client.name))
		table.insert(lines, string.format("│   ID: %d", client.id))
		table.insert(lines, string.format("│   Root: %s", client.config.root_dir or "N/A"))
		table.insert(lines, string.format("│   Status: %s", client.is_stopped() and "󰅚 Stopped" or "󰄬 Running"))

		-- Check capabilities with icons
		local caps = client.server_capabilities
		local features = {}
		if caps then
			if caps.completionProvider then
				table.insert(features, "󰅳 completion")
			end
			if caps.hoverProvider then
				table.insert(features, "󰋽 hover")
			end
			if caps.definitionProvider then
				table.insert(features, "󰘦 definition")
			end
			if caps.referencesProvider then
				table.insert(features, "󰈻 references")
			end
			if caps.renameProvider then
				table.insert(features, "󰑕 rename")
			end
			if caps.codeActionProvider then
				table.insert(features, "󰌵 code_action")
			end
			if caps.documentFormattingProvider then
				table.insert(features, "󰉶 formatting")
			end
		end

		if #features > 0 then
			table.insert(lines, string.format("│   Features: %s", table.concat(features, ", ")))
		end
		table.insert(lines, "└─")
		table.insert(lines, "")
	end

	-- Display in a floating window
	local buf = vim.api.nvim_create_buf(false, true)

	vim.api.nvim_set_option_value("buftype", "nofile", { buf = buf })
	vim.api.nvim_set_option_value("bufhidden", "wipe", { buf = buf })
	vim.api.nvim_set_option_value("swapfile", false, { buf = buf })
	vim.api.nvim_set_option_value("modeline", false, { buf = buf })

	vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)

	-- TODO: fix this
	vim.api.nvim_set_option_value("modifiable", false, { buf = buf })
	vim.api.nvim_set_option_value("readonly", true, { buf = buf })

	local height = #lines
	local win = vim.api.nvim_open_win(buf, true, {
		relative = "editor",
		row = math.floor((vim.o.lines - height) / 2),
		col = math.floor((vim.o.columns - width) / 2),
		width = width,
		height = height,
		style = "minimal",
		border = "rounded",
		title = " LSP Status ",
		title_pos = "center",
	})

	-- Window-local options: use win=
	vim.api.nvim_set_option_value("wrap", false, { win = win })
	vim.api.nvim_set_option_value("cursorline", true, { win = win })

	-- Set keymaps to close
	local opts = { noremap = true, silent = true, buffer = buf }
	vim.keymap.set("n", "q", "<cmd>close<cr>", opts)
	vim.keymap.set("n", "<Esc>", "<cmd>close<cr>", opts)

	vim.api.nvim_create_autocmd({ "BufWinEnter", "FileType" }, {
		buffer = buf,
		callback = function(ev)
			vim.api.nvim_set_option_value("modifiable", false, { buf = ev.buf })
			vim.api.nvim_set_option_value("readonly", true, { buf = ev.buf })
		end,
	})

	print("modifiable=", vim.api.nvim_get_option_value("modifiable", { buf = buf }))
end

vim.api.nvim_create_user_command("LspStatus", lsp_status, { desc = "Show detailed LSP status" })

local function check_lsp_capabilities()
	local bufnr = vim.api.nvim_get_current_buf()
	local clients = vim.lsp.get_clients({ bufnr = bufnr })

	if #clients == 0 then
		vim.notify("󰅚 No LSP clients attached", vim.log.levels.WARN)
		return
	end

	for _, client in ipairs(clients) do
		local lines = {
			"╭─────────────────────────────────────────────────────────────╮",
			string.format("│              Capabilities: %s                      │", client.name),
			"╰─────────────────────────────────────────────────────────────╯",
			"",
		}

		local caps = client.server_capabilities

		if caps then
			local capability_list = {
				{ "󰅳 Completion", caps.completionProvider },
				{ "󰋽 Hover", caps.hoverProvider },
				{ "󰊕 Signature Help", caps.signatureHelpProvider },
				{ "󰘦 Go to Definition", caps.definitionProvider },
				{ "󰘧 Go to Declaration", caps.declarationProvider },
				{ "󰘭 Go to Implementation", caps.implementationProvider },
				{ "󰘪 Go to Type Definition", caps.typeDefinitionProvider },
				{ "󰈻 Find References", caps.referencesProvider },
				{ "󰑑 Document Highlight", caps.documentHighlightProvider },
				{ "󰈭 Document Symbol", caps.documentSymbolProvider },
				{ "󰈮 Workspace Symbol", caps.workspaceSymbolProvider },
				{ "󰌵 Code Action", caps.codeActionProvider },
				{ "󰎖 Code Lens", caps.codeLensProvider },
				{ "󰉶 Document Formatting", caps.documentFormattingProvider },
				{ "󰉵 Document Range Formatting", caps.documentRangeFormattingProvider },
				{ "󰑕 Rename", caps.renameProvider },
				{ "󰏂 Folding Range", caps.foldingRangeProvider },
				{ "󰯂 Selection Range", caps.selectionRangeProvider },
			}

			-- Group capabilities by status
			local enabled, disabled = {}, {}
			for _, cap in ipairs(capability_list) do
				if cap[2] then
					table.insert(enabled, cap[1])
				else
					table.insert(disabled, cap[1])
				end
			end

			if #enabled > 0 then
				table.insert(lines, "🟢 Enabled Capabilities:")
				for _, cap in ipairs(enabled) do
					table.insert(lines, "  ✓ " .. cap)
				end
				table.insert(lines, "")
			end

			if #disabled > 0 then
				table.insert(lines, "🔴 Disabled Capabilities:")
				for _, cap in ipairs(disabled) do
					table.insert(lines, "  ✗ " .. cap)
				end
				table.insert(lines, "")
			end
		else
			table.insert(lines, "⚠️  No capabilities information available")
		end

		-- Display in a floating window
		local buf = vim.api.nvim_create_buf(false, true)
		vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)

		local width = math.max(50, math.min(70, vim.o.columns - 10))
		local height = #lines

		local win = vim.api.nvim_open_win(buf, true, {
			relative = "editor",
			row = math.floor((vim.o.lines - height) / 2),
			col = math.floor((vim.o.columns - width) / 2),
			width = width,
			height = height,
			style = "minimal",
			border = "rounded",
			title = " LSP Capabilities ",
			title_pos = "center",
		})

		vim.wo[win].wrap = false
		vim.wo[win].cursorline = true

		-- Set keymaps to close
		local opts = { noremap = true, silent = true, buffer = buf }
		vim.keymap.set("n", "q", "<cmd>close<cr>", opts)
		vim.keymap.set("n", "<Esc>", "<cmd>close<cr>", opts)
	end
end

vim.api.nvim_create_user_command("LspCapabilities", check_lsp_capabilities, { desc = "Show LSP capabilities" })

local function lsp_diagnostics_info()
	local bufnr = vim.api.nvim_get_current_buf()
	local diagnostics = vim.diagnostic.get(bufnr)

	local counts = { ERROR = 0, WARN = 0, INFO = 0, HINT = 0 }

	for _, diagnostic in ipairs(diagnostics) do
		local severity = vim.diagnostic.severity[diagnostic.severity]
		counts[severity] = counts[severity] + 1
	end

	local lines = {
		"╭─────────────────────────────────────────────────────────────╮",
		"│                   Diagnostics Summary                       │",
		"╰─────────────────────────────────────────────────────────────╯",
		"",
		string.format("Buffer: %d | File: %s", bufnr, vim.fn.fnamemodify(vim.api.nvim_buf_get_name(bufnr), ":t")),
		"",
	}

	if #diagnostics == 0 then
		table.insert(lines, "🎉 No diagnostics found!")
	else
		table.insert(lines, "📊 Diagnostic Counts:")
		table.insert(lines, string.format("  󰅚 Errors:    %d", counts.ERROR))
		table.insert(lines, string.format("  󰀪 Warnings:  %d", counts.WARN))
		table.insert(lines, string.format("  󰋽 Info:      %d", counts.INFO))
		table.insert(lines, string.format("  󰌶 Hints:     %d", counts.HINT))
		table.insert(lines, "")
		table.insert(lines, string.format("📈 Total Issues: %d", #diagnostics))

		-- Show recent diagnostics
		table.insert(lines, "")
		table.insert(lines, "📍 Recent Issues:")
		local shown = 0
		for i, diag in ipairs(diagnostics) do
			if shown >= 5 then
				break
			end
			local severity_icon = diag.severity == 1 and "󰅚"
				or diag.severity == 2 and "󰀪"
				or diag.severity == 3 and "󰋽"
				or "󰌶"
			local line_num = diag.lnum + 1
			local message = diag.message:gsub("\n", " ")
			if #message > 50 then
				message = message:sub(1, 47) .. "..."
			end
			table.insert(lines, string.format("  %s L%d: %s", severity_icon, line_num, message))
			shown = shown + 1
		end
	end

	-- Display in a floating window
	local buf = vim.api.nvim_create_buf(false, true)
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)

	local width = math.max(60, math.min(80, vim.o.columns - 10))
	local height = #lines

	local win = vim.api.nvim_open_win(buf, true, {
		relative = "editor",
		row = math.floor((vim.o.lines - height) / 2),
		col = math.floor((vim.o.columns - width) / 2),
		width = width,
		height = height,
		style = "minimal",
		border = "rounded",
		title = " Diagnostics Summary ",
		title_pos = "center",
	})

	vim.wo[win].wrap = false
	vim.wo[win].cursorline = true

	-- Set keymaps to close and navigate
	local opts = { noremap = true, silent = true, buffer = buf }
	vim.keymap.set("n", "q", "<cmd>close<cr>", opts)
	vim.keymap.set("n", "<Esc>", "<cmd>close<cr>", opts)

	-- Add jump to diagnostic functionality
	vim.keymap.set("n", "<CR>", function()
		vim.cmd("close")
		vim.diagnostic.goto_next()
	end, opts)
end

vim.api.nvim_create_user_command("LspDiagnostics", lsp_diagnostics_info, { desc = "Show LSP diagnostics count" })

local function lsp_info()
	local bufnr = vim.api.nvim_get_current_buf()
	local clients = vim.lsp.get_clients({ bufnr = bufnr })

	local lines = {
		"╭─────────────────────────────────────────────────────────────╮",
		"│                    LSP Information                          │",
		"╰─────────────────────────────────────────────────────────────╯",
		"",
		string.format("󰈙 Language client log: %s", vim.lsp.get_log_path()),
		string.format("󰈔 Detected filetype: %s", vim.bo.filetype),
		string.format("󰈮 Buffer: %d", bufnr),
		string.format("󰈔 Root directory: %s", vim.fn.getcwd() or "N/A"),
		"",
	}

	if #clients == 0 then
		table.insert(lines, "󰅚 No LSP clients attached to buffer " .. bufnr)
		table.insert(lines, "")
		table.insert(lines, "Possible reasons:")
		table.insert(lines, "  • No language server installed for " .. vim.bo.filetype)
		table.insert(lines, "  • Language server not configured")
		table.insert(lines, "  • Not in a project root directory")
		table.insert(lines, "  • File type not recognized")
	else
		table.insert(lines, "󰒋 LSP clients attached to buffer " .. bufnr .. ":")
		table.insert(
			lines,
			"─────────────────────────────────"
		)
		table.insert(lines, "")

		for i, client in ipairs(clients) do
			table.insert(lines, string.format("󰌘 Client %d: %s", i, client.name))
			table.insert(lines, string.format("  ID: %d", client.id))
			table.insert(lines, string.format("  Root dir: %s", client.config.root_dir or "Not set"))
			local cmd = client.config.cmd
			if type(cmd) == "table" then
				cmd = table.concat(cmd, " ")
			elseif type(cmd) == "function" then
				cmd = "<function>"
			else
				cmd = tostring(cmd or "N/A")
			end
			table.insert(lines, string.format("  Command: %s", cmd))
			table.insert(lines, string.format("  Filetypes: %s", table.concat(client.config.filetypes or {}, ", ")))

			-- Server status
			if client.is_stopped() then
				table.insert(lines, "  Status: 󰅚 Stopped")
			else
				table.insert(lines, "  Status: 󰄬 Running")
			end

			-- Workspace folders
			if client.workspace_folders and #client.workspace_folders > 0 then
				table.insert(lines, "  Workspace folders:")
				for _, folder in ipairs(client.workspace_folders) do
					table.insert(lines, "    • " .. folder.name)
				end
			end

			-- Attached buffers count
			local attached_buffers = {}
			for buf, _ in pairs(client.attached_buffers or {}) do
				table.insert(attached_buffers, buf)
			end
			table.insert(lines, string.format("  Attached buffers: %d", #attached_buffers))

			-- Key capabilities
			local caps = client.server_capabilities
			local key_features = {}
			if caps and caps.completionProvider then
				table.insert(key_features, "completion")
			end
			if caps and caps.hoverProvider then
				table.insert(key_features, "hover")
			end
			if caps and caps.definitionProvider then
				table.insert(key_features, "definition")
			end
			if caps and caps.documentFormattingProvider then
				table.insert(key_features, "formatting")
			end
			if caps and caps.codeActionProvider then
				table.insert(key_features, "code_action")
			end

			if #key_features > 0 then
				table.insert(lines, string.format("  Key features: %s", table.concat(key_features, ", ")))
			end

			table.insert(lines, "")
		end

		-- Diagnostics summary
		local diagnostics = vim.diagnostic.get(bufnr)
		if #diagnostics > 0 then
			table.insert(lines, "󰒡 Diagnostics Summary:")
			local counts = { ERROR = 0, WARN = 0, INFO = 0, HINT = 0 }

			for _, diagnostic in ipairs(diagnostics) do
				local severity = vim.diagnostic.severity[diagnostic.severity]
				counts[severity] = counts[severity] + 1
			end

			table.insert(lines, string.format("  󰅚 Errors: %d", counts.ERROR))
			table.insert(lines, string.format("  󰀪 Warnings: %d", counts.WARN))
			table.insert(lines, string.format("  󰋽 Info: %d", counts.INFO))
			table.insert(lines, string.format("  󰌶 Hints: %d", counts.HINT))
			table.insert(lines, string.format("  Total: %d", #diagnostics))
		else
			table.insert(lines, "󰄬 No diagnostics")
		end

		table.insert(lines, "")
		table.insert(lines, "Use :LspLog to view detailed logs")
		table.insert(lines, "Use :LspCapabilities for full capability list")
	end

	-- Display in a floating window
	local buf = vim.api.nvim_create_buf(false, true)
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)

	local width = math.max(70, math.min(90, vim.o.columns - 10))
	local height = #lines

	local win = vim.api.nvim_open_win(buf, true, {
		relative = "editor",
		row = math.floor((vim.o.lines - height) / 2),
		col = math.floor((vim.o.columns - width) / 2),
		width = width,
		height = height,
		style = "minimal",
		border = "rounded",
		title = " LSP Information ",
		title_pos = "center",
	})

	vim.wo[win].wrap = false
	vim.wo[win].cursorline = true

	-- Set keymaps to close
	local opts = { noremap = true, silent = true, buffer = buf }
	vim.keymap.set("n", "q", "<cmd>close<cr>", opts)
	vim.keymap.set("n", "<Esc>", "<cmd>close<cr>", opts)
end

-- Create command
vim.api.nvim_create_user_command("LspInfo", lsp_info, { desc = "Show comprehensive LSP information" })

local function lsp_status_short()
	local bufnr = vim.api.nvim_get_current_buf()
	local clients = vim.lsp.get_clients({ bufnr = bufnr })

	if #clients == 0 then
		return "" -- Return empty string when no LSP
	end

	local names = {}
	for _, client in ipairs(clients) do
		table.insert(names, client.name)
	end

	return "󰒋 " .. table.concat(names, ",")
end
