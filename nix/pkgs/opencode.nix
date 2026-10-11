# opencode v2 CLI (npm: @opencode/cli), https://opencode.ai. nixpkgs only has v1.
#
# A Bun-compiled single binary. Self-updating is disabled via
# OPENCODE_DISABLE_AUTOUPDATE in home/common.nix, since Nix owns this copy.
#
# To update: run `update-npm-binary opencode`, then nix-rebuild.
{ callPackage, lib }:
callPackage ./npm-binary.nix { } {
  pname = "opencode";
  version = "2.0.26";
  packagePrefix = "@opencode/cli";
  platforms = {
    x86_64-linux = {
      suffix = "linux-x64";
      hash = "sha512-UIA2/1Ik8HaN54C4xp7H+OHgRfq995XUixrX+kLmFs8EPn1fAcmn3OoiN+3c3Vc3jEV/LHmj0Cy1SL6nW4wdGw==";
    };
    x86_64-darwin = {
      suffix = "darwin-x64";
      hash = "sha512-051fIryTH4FK4Ml63TH+IP3s7Mi+jYfVyEXSBh9aGDJUS2VZfD+AwNJ9Ew9nBPTBKYvhMGhqHcudHagRL8SBbQ==";
    };
  };
  binaries.opencode = "bin/opencode";
  meta = {
    description = "AI coding agent for the terminal";
    homepage = "https://opencode.ai";
    license = lib.licenses.mit;
    mainProgram = "opencode";
  };
}
