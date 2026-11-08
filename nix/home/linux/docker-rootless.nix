# Docker is owned by Nix; Ubuntu supplies privileged UID mapping and AppArmor policy.
{
  lib,
  pkgs,
  ...
}:
{
  home.packages = with pkgs; [
    docker
    docker-compose
    rootlesskit
  ];

  systemd.user.services.docker = {
    Unit = {
      Description = "Rootless Docker (Nix)";
      After = [ "network.target" ];
      # Run nix/scripts/setup-rootless-docker once as an administrator first.
      ConditionFileIsExecutable = [
        "/usr/bin/newuidmap"
        "/usr/bin/newgidmap"
      ];
      ConditionPathExists = "/etc/apparmor.d/docker-rootless-nix";
      StartLimitIntervalSec = 60;
      StartLimitBurst = 3;
    };
    Service = {
      Type = "notify";
      ExecStart = "${pkgs.docker}/bin/dockerd-rootless --host=unix://%t/docker.sock";
      Environment = [
        "PATH=/usr/bin:/bin:${
          lib.makeBinPath [
            pkgs.coreutils
            pkgs.gnugrep
          ]
        }"
      ];
      Restart = "on-failure";
      RestartSec = 5;
      TimeoutStartSec = 0;
      TimeoutStopSec = 120;
      Delegate = true;
      NotifyAccess = "all";
      KillMode = "mixed";
      LimitNOFILE = "infinity";
      LimitNPROC = "infinity";
      LimitCORE = "infinity";
    };
    Install.WantedBy = [ "default.target" ];
  };

  home.activation.configureRootlessDocker = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    docker=${pkgs.docker}/bin/docker
    if ! "$docker" context inspect nix-rootless >/dev/null 2>&1; then
      run "$docker" context create nix-rootless \
        --description "Nix-managed rootless Docker" \
        --docker "host=unix:///run/user/$(id -u)/docker.sock"
    fi
    # Preserve an explicitly selected remote/desktop context.
    if [ "$("$docker" context show)" = default ]; then
      run "$docker" context use nix-rootless
    fi
  '';
}
