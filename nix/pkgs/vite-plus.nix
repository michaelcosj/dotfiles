# Vite+ global CLI (`vp`), https://viteplus.dev. Not in nixpkgs.
#
# This is the prebuilt binary the official `curl https://vite.plus | bash` installer
# downloads. On first run `vp` fetches its own Node runtime and JS package into
# ~/.local/share/vite-plus. `vp upgrade` can't update this copy.
#
# To update: run `update-npm-binary vite-plus`, then nix-rebuild.
{ callPackage, lib }:
callPackage ./npm-binary.nix { } {
  pname = "vite-plus";
  version = "1.1.0";
  packagePrefix = "@voidzero-dev/vite-plus-cli";
  platforms = {
    x86_64-linux = {
      suffix = "linux-x64-gnu";
      hash = "sha512-lNnY8ULsZ1AdO1DiSDqHWfxq1kT91aUroMFFq2ROSG3SyP1cmmNkCvMdOiYlNPh1P8DamBYG2q2JoqUJlA4kMQ==";
    };
    x86_64-darwin = {
      suffix = "darwin-x64";
      hash = "sha512-fjkt6aSsgfVZlc4EmLrAazA0PeFzsdSnRfGbh7fWn5UWGQJLiz0LDvCUyLcfmGoZQqDjhwkwBun2YkK1leNTnQ==";
    };
  };
  binaries.vp = "vp";
  meta = {
    description = "Vite+, the unified toolchain for the web";
    homepage = "https://viteplus.dev";
    license = lib.licenses.mit;
    mainProgram = "vp";
  };
}
