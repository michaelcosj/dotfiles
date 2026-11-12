# opencode v2 CLI (npm: @opencode/cli), https://opencode.ai. nixpkgs only has v1.
#
# A Bun-compiled single binary. Self-updating is disabled via
# OPENCODE_DISABLE_AUTOUPDATE in home/common.nix, since Nix owns this copy.
#
# Version and hashes are in npm-pins.json. To update: run
# `update-npm-binary opencode`, then nix-rebuild.
{ callPackage, lib }:
let
  pin = (lib.importJSON ./npm-pins.json).opencode;
in
callPackage ./npm-binary.nix { } {
  pname = "opencode";
  inherit (pin) version platforms;
  packagePrefix = pin.package;
  binaries.opencode = "bin/opencode";
  meta = {
    description = "AI coding agent for the terminal";
    homepage = "https://opencode.ai";
    license = lib.licenses.mit;
    mainProgram = "opencode";
  };
}
