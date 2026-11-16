# Packages a prebuilt binary that's published to npm as one package per platform
# (`<packagePrefix>-<suffix>`, e.g. @opencode/cli-linux-x64, or with
# `scoped = true` `<packagePrefix>/<suffix>`, e.g. @tsrs/linux-x64-gnu). Used by the files
# next to this one. Their pins are in npm-pins.json; update them with
# `update-npm-binary <name>`.
{
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
}:
{
  pname,
  version,
  packagePrefix,
  # { <nix system> = { suffix = "<npm platform suffix>"; hash = "<dist.integrity>"; }; }
  platforms,
  # { <command name> = "<path inside the npm tarball>"; }
  binaries,
  # The platform package is `<packagePrefix>/<suffix>` (an npm scope of its own).
  scoped ? false,
  # Install the whole tarball to $out/lib/<pname> and symlink the binaries, for
  # binaries that read files next to their real path.
  keepTree ? false,
  meta ? { },
}:
let
  platform =
    platforms.${stdenv.hostPlatform.system}
      or (throw "${pname}: unsupported system ${stdenv.hostPlatform.system}");
  npmName = "${packagePrefix}${if scoped then "/" else "-"}${platform.suffix}";
  tarballName = lib.last (lib.splitString "/" npmName);
in
stdenv.mkDerivation {
  inherit pname version;

  src = fetchurl {
    url = "https://registry.npmjs.org/${npmName}/-/${tarballName}-${version}.tgz";
    inherit (platform) hash;
  };

  nativeBuildInputs = lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];

  dontConfigure = true;
  dontBuild = true;
  # Some of these (e.g. Bun-compiled CLIs) embed their app in the binary.
  dontStrip = true;

  installPhase = ''
    runHook preInstall
    ${lib.concatStringsSep "\n" (
      lib.optionals keepTree [
        "mkdir -p $out/lib $out/bin"
        "cp -r . $out/lib/${pname}"
      ]
      ++ lib.mapAttrsToList (
        name: path:
        if keepTree then
          "ln -s $out/lib/${pname}/${path} $out/bin/${name}"
        else
          "install -Dm755 ${path} $out/bin/${name}"
      ) binaries
    )}
    runHook postInstall
  '';

  meta = {
    platforms = builtins.attrNames platforms;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  }
  // meta;
}
