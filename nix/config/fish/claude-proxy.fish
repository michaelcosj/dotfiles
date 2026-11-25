# Read the same private, plain KEY=value file as systemd. Do not source it as code.
if test -r "$HOME/.config/claude-proxy.env"
    while read -l line
        set -l pair (string split -m 1 '=' -- "$line")
        if test (count $pair) -eq 2
            switch $pair[1]
                case ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN
                    set -gx $pair[1] "$pair[2]"
            end
        end
    end < "$HOME/.config/claude-proxy.env"
end
