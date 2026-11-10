# Official prebuilt npm release. Update the version, URL, and hash together.
{ lib, stdenvNoCC, fetchurl }:
stdenvNoCC.mkDerivation {
  pname = "codex-bin";
  version = "0.167.0";

  src = fetchurl {
    url = "https://registry.npmjs.org/@openai/codex/-/codex-0.167.0-linux-x64.tgz";
    hash = "sha256-Lcmqhxq7UTw1OdINAl9wH68ZdMRu6Qa9o6Hh9QJtRDQ=";
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
