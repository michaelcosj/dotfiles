# Official prebuilt npm release (the platform is a version suffix, e.g.
# @openai/codex@0.167.0-linux-x64). Version and hash are in npm-pins.json.
# To update: run `update-npm-binary codex`, then nix-rebuild.
{
  lib,
  stdenvNoCC,
  fetchurl,
}:
let
  pin = (lib.importJSON ./npm-pins.json).codex;
  platform = pin.platforms.x86_64-linux;
in
stdenvNoCC.mkDerivation rec {
  pname = "codex-bin";
  inherit (pin) version;

  src = fetchurl {
    url = "https://registry.npmjs.org/@openai/codex/-/codex-${version}-${platform.suffix}.tgz";
    inherit (platform) hash;
  };

  dontConfigure = true;
  dontBuild = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall
    # Keep upstream's manifest, helper binaries, and resources beside the CLI.
    mkdir -p "$out/libexec/codex" "$out/bin"
    cp -a vendor/x86_64-unknown-linux-musl/. "$out/libexec/codex/"
    ln -s ../libexec/codex/bin/codex "$out/bin/codex"
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    "$out/bin/codex" --version | grep -F "codex-cli $version"
    "$out/bin/codex" --help >/dev/null
    runHook postInstallCheck
  '';

  meta = {
    description = "OpenAI Codex CLI (official prebuilt release)";
    homepage = "https://github.com/openai/codex";
    license = lib.licenses.asl20;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    platforms = [ "x86_64-linux" ];
    mainProgram = "codex";
  };
}
