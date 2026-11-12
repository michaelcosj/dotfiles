# Vite+ global CLI (`vp`), https://viteplus.dev. Not in nixpkgs.
#
# This is the prebuilt binary the official `curl https://vite.plus | bash` installer
# downloads. On first run `vp` copies itself into ~/.vite-plus and installs its JS
# package and Node runtime there. Fish's hook is in home/programs/fish.nix.
# `vp upgrade` can't update this copy.
#
# Version and hashes are in npm-pins.json. To update: run
# `update-npm-binary vite-plus`, then nix-rebuild.
{ callPackage, lib }:
let
  pin = (lib.importJSON ./npm-pins.json).vite-plus;
in
callPackage ./npm-binary.nix { } {
  pname = "vite-plus";
  inherit (pin) version platforms;
  packagePrefix = pin.package;
  binaries.vp = "vp";
  meta = {
    description = "Vite+, the unified toolchain for the web";
    homepage = "https://viteplus.dev";
    license = lib.licenses.mit;
    mainProgram = "vp";
  };
}
