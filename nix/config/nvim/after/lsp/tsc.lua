-- Merged over nvim-lspconfig's `tsc` config: the same TypeScript 7 LSP
-- protocol, served by tsrs (Rust port, nix/pkgs/tsrs.nix) instead of tsgo.
-- lspconfig's root_dir still requires a TS 7+ `tsc`/`tsgo` to attach; the
-- Nix `typescript` package provides one. Delete this file to go back to tsgo.
---@type vim.lsp.Config
return {
	cmd = { "tsrs", "--lsp", "--stdio" },
}
