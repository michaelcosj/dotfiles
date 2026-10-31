# Client-side aliases. OpenSSH selects the normal local identity files.
{ ... }:
{
  programs.ssh = {
    enable = true;
    enableDefaultConfig = false;
    settings = {
      devbox = {
        HostName = "DEVBOX_IP_REMOVED";
        User = "m";
      };
      devbox-work = {
        HostName = "DEVBOX_IP_REMOVED";
        User = "work";
      };
      devbox-admin = {
        HostName = "DEVBOX_IP_REMOVED";
        User = "DEVBOX_ADMIN_REMOVED";
      };
    };
  };
}
