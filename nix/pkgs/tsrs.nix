# tsrs, a Rust port of the TypeScript 7 compiler and language server
# (`tsrs --lsp --stdio`), https://github.com/oxc-project/tsrs. Not in nixpkgs.
#
# The binary reads the bundled lib.*.d.ts files next to its real path, so the
# whole npm package is kept and bin/ only has symlinks.
#
# Version and hashes are in npm-pins.json. To update: run
# `update-npm-binary tsrs`, then nix-rebuild.
{ callPackage, lib }:
let
  pin = (lib.importJSON ./npm-pins.json).tsrs;
in
callPackage ./npm-binary.nix { } {
  pname = "tsrs";
  inherit (pin) version platforms;
  packagePrefix = pin.package;
  scoped = true;
  keepTree = true;
  binaries.tsrs = "tsrs";
  meta = {
    description = "Rust port of the TypeScript 7 compiler and language server";
    homepage = "https://github.com/oxc-project/tsrs";
    license = lib.licenses.asl20;
    mainProgram = "tsrs";
  };
}
