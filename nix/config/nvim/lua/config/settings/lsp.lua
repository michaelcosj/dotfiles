-- Enabled configs
vim.lsp.enable({
	"biome",
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
		vim.print("󰅚 No LSP clients attached")
		return
	end

	vim.print("󰒋 LSP Status for buffer " .. bufnr .. ":")
	vim.print("─────────────────────────────────")

	for i, client in ipairs(clients) do
		vim.print(string.format("󰌘 Client %d: %s (ID: %d)", i, client.name, client.id))
		vim.print("  Root: " .. (client.config.root_dir or "N/A"))
		vim.print("  Filetypes: " .. table.concat(client.config.filetypes or {}, ", "))

		-- Check capabilities
		local caps = client.server_capabilities
		local features = {}
		if caps then
			if caps.completionProvider then
				table.insert(features, "completion")
			end
			if caps.hoverProvider then
				table.insert(features, "hover")
			end
			if caps.definitionProvider then
				table.insert(features, "definition")
			end
			if caps.referencesProvider then
				table.insert(features, "references")
			end
			if caps.renameProvider then
				table.insert(features, "rename")
			end
			if caps.codeActionProvider then
				table.insert(features, "code_action")
			end
			if caps.documentFormattingProvider then
				table.insert(features, "formatting")
			end
		end

		vim.print("  Features: " .. table.concat(features, ", "))
		vim.print("")
	end
end

vim.api.nvim_create_user_command("LspStatus", lsp_status, { desc = "Show detailed LSP status" })

local function check_lsp_capabilities()
	local bufnr = vim.api.nvim_get_current_buf()
	local clients = vim.lsp.get_clients({ bufnr = bufnr })

	if #clients == 0 then
		vim.print("No LSP clients attached")
		return
	end

	for _, client in ipairs(clients) do
		vim.print("Capabilities for " .. client.name .. ":")
		local caps = client.server_capabilities

		if caps then
			local capability_list = {
				{ "Completion", caps.completionProvider },
				{ "Hover", caps.hoverProvider },
				{ "Signature Help", caps.signatureHelpProvider },
				{ "Go to Definition", caps.definitionProvider },
				{ "Go to Declaration", caps.declarationProvider },
				{ "Go to Implementation", caps.implementationProvider },
				{ "Go to Type Definition", caps.typeDefinitionProvider },
				{ "Find References", caps.referencesProvider },
				{ "Document Highlight", caps.documentHighlightProvider },
				{ "Document Symbol", caps.documentSymbolProvider },
				{ "Workspace Symbol", caps.workspaceSymbolProvider },
				{ "Code Action", caps.codeActionProvider },
				{ "Code Lens", caps.codeLensProvider },
				{ "Document Formatting", caps.documentFormattingProvider },
				{ "Document Range Formatting", caps.documentRangeFormattingProvider },
				{ "Rename", caps.renameProvider },
				{ "Folding Range", caps.foldingRangeProvider },
				{ "Selection Range", caps.selectionRangeProvider },
			}

			for _, cap in ipairs(capability_list) do
				local status = cap[2] and "✓" or "✗"
				vim.print(string.format("  %s %s", status, cap[1]))
			end
			vim.print("")
		end
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

	vim.print("󰒡 Diagnostics for current buffer:")
	vim.print("  Errors: " .. counts.ERROR)
	vim.print("  Warnings: " .. counts.WARN)
	vim.print("  Info: " .. counts.INFO)
	vim.print("  Hints: " .. counts.HINT)
	vim.print("  Total: " .. #diagnostics)
end

vim.api.nvim_create_user_command("LspDiagnostics", lsp_diagnostics_info, { desc = "Show LSP diagnostics count" })

local function lsp_info()
	local bufnr = vim.api.nvim_get_current_buf()
	local clients = vim.lsp.get_clients({ bufnr = bufnr })

	vim.print(
		"═══════════════════════════════════"
	)
	vim.print("           LSP INFORMATION          ")
	vim.print(
		"═══════════════════════════════════"
	)
	vim.print("")

	-- Basic info
	vim.print("󰈙 Language client log: " .. vim.lsp.get_log_path())
	vim.print("󰈔 Detected filetype: " .. vim.bo.filetype)
	vim.print("󰈮 Buffer: " .. bufnr)
	vim.print("󰈔 Root directory: " .. (vim.fn.getcwd() or "N/A"))
	vim.print("")

	if #clients == 0 then
		vim.print("󰅚 No LSP clients attached to buffer " .. bufnr)
		vim.print("")
		vim.print("Possible reasons:")
		vim.print("  • No language server installed for " .. vim.bo.filetype)
		vim.print("  • Language server not configured")
		vim.print("  • Not in a project root directory")
		vim.print("  • File type not recognized")
		return
	end

	vim.print("󰒋 LSP clients attached to buffer " .. bufnr .. ":")
	vim.print("─────────────────────────────────")

	for i, client in ipairs(clients) do
		vim.print(string.format("󰌘 Client %d: %s", i, client.name))
		vim.print("  ID: " .. client.id)
		vim.print("  Root dir: " .. (client.config.root_dir or "Not set"))
		vim.print("  Command: " .. table.concat(client.config.cmd or {}, " "))
		vim.print("  Filetypes: " .. table.concat(client.config.filetypes or {}, ", "))

		-- Server status
		if client.is_stopped() then
			vim.print("  Status: 󰅚 Stopped")
		else
			vim.print("  Status: 󰄬 Running")
		end

		-- Workspace folders
		if client.workspace_folders and #client.workspace_folders > 0 then
			vim.print("  Workspace folders:")
			for _, folder in ipairs(client.workspace_folders) do
				vim.print("    • " .. folder.name)
			end
		end

		-- Attached buffers count
		local attached_buffers = {}
		for buf, _ in pairs(client.attached_buffers or {}) do
			table.insert(attached_buffers, buf)
		end
		vim.print("  Attached buffers: " .. #attached_buffers)

		-- Key capabilities
		local caps = client.server_capabilities
		local key_features = {}
		if caps.completionProvider then
			table.insert(key_features, "completion")
		end
		if caps.hoverProvider then
			table.insert(key_features, "hover")
		end
		if caps.definitionProvider then
			table.insert(key_features, "definition")
		end
		if caps.documentFormattingProvider then
			table.insert(key_features, "formatting")
		end
		if caps.codeActionProvider then
			table.insert(key_features, "code_action")
		end

		if #key_features > 0 then
			vim.print("  Key features: " .. table.concat(key_features, ", "))
		end

		vim.print("")
	end

	-- Diagnostics summary
	local diagnostics = vim.diagnostic.get(bufnr)
	if #diagnostics > 0 then
		vim.print("󰒡 Diagnostics Summary:")
		local counts = { ERROR = 0, WARN = 0, INFO = 0, HINT = 0 }

		for _, diagnostic in ipairs(diagnostics) do
			local severity = vim.diagnostic.severity[diagnostic.severity]
			counts[severity] = counts[severity] + 1
		end

		vim.print("  󰅚 Errors: " .. counts.ERROR)
		vim.print("  󰀪 Warnings: " .. counts.WARN)
		vim.print("  󰋽 Info: " .. counts.INFO)
		vim.print("  󰌶 Hints: " .. counts.HINT)
		vim.print("  Total: " .. #diagnostics)
	else
		vim.print("󰄬 No diagnostics")
	end

	vim.print("")
	vim.print("Use :LspLog to view detailed logs")
	vim.print("Use :LspCapabilities for full capability list")
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
