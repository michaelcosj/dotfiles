# Git, delta, and lazygit.
{ lib, pkgs, ... }:
{
  programs.git = {
    enable = true;
    settings = {
      core.editor = "nvim";
      color.ui = true;
      pull.ff = "only";
      init.defaultBranch = "main";
      # Pi writes per-machine state into config/pi/agent/settings.json, which
      # every machine links (see .gitattributes). deviceId must stay unique
      # per installation; the changelog versions change on every update.
      filter.pi-settings.clean = "${lib.getExe pkgs.jq} 'del(.deviceId, .lastChangelogVersion, .extensionChangelogVersions)'";
      aliases = {
        sw = "switch";
        ci = "commit";
        st = "status";
        br = "branch";
        df = "diff";
        lg = "log --graph --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset' --abbrev-commit";
      };
    };
    ignores = [
      ".DS_Store"
      "node_modules"
      "*.pyc"
    ];
  };

  programs.delta = {
    enable = true;
    enableGitIntegration = true;
    options = {
      navigate = true;
      line-numbers = true;
    };
  };

  programs.lazygit = {
    enable = true;
    settings = {
      gui = {
        # The Files panel gets 40% of the width, and grows taller while focused.
        sidePanelWidth = 0.4;
        expandFocusedSidePanel = true;
        showFileTree = true;
        mainPanelSplitMode = "flexible";
      };
      # Open files in the Neovim that started lazygit (Neovim's <leader>gl
      # float), else in a new nvim.
      os = {
        edit = "lazygit-nvim-edit {{filename}}";
        editAtLine = "lazygit-nvim-edit {{filename}} {{line}}";
        editAtLineAndWait = "nvim +{{line}} -- {{filename}}";
        openDirInEditor = "lazygit-nvim-edit {{dir}}";
        editInTerminal = true;
      };
    };
  };
}
