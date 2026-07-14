# Habitat systemd User Service Design

## Goal

Run the deployed Habitat API continuously on OpenClaw as user `ok`, start it automatically, restart it after exits, and retain its output in the user systemd journal.

## Scope

The version-controlled source unit will live at `deploy/habitat-api.service` in this repository. Its deployed copy will be installed only on OpenClaw at `~/.config/systemd/user/habitat-api.service` and will not be committed.

The service will run from `%h/habitat-cli`, which resolves to `/home/ok/habitat-cli` for the OpenClaw user. It will execute `/usr/local/bin/bun run server`, matching the repository's `server` package script. `Restart=always` and `RestartSec=3` will make systemd restart the backend three seconds after any process exit.

## Service Unit

```ini
[Unit]
Description=Habitat API

[Service]
Type=simple
WorkingDirectory=%h/habitat-cli
ExecStart=/usr/local/bin/bun run server
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
```

`Type=simple` means systemd directly supervises the Bun process. `WantedBy=default.target` allows `systemctl --user enable` to arrange startup with the user service manager's normal target. No `User=`, `sudo`, daemonization, or separate log file is needed because this is a user service and journald captures standard output and error.

## Deployment and Verification

After the unit is committed and pushed, deployment on OpenClaw will use the repeatable sequence: `git pull`, `bun install`, copy the tracked unit into `~/.config/systemd/user/`, run `systemctl --user daemon-reload`, and restart the service. The unit will be enabled and started without `sudo`.

Verification will check the installed unit, enabled and active states, detailed status, `Linger=yes`, local API and CLI access, request entries in `journalctl --user -u habitat-api.service`, and continued laptop CLI access after every SSH session is closed. The deployment will not be considered complete unless these checks succeed.

## Constraints

- Preserve the stable `--json` CLI interface; this work does not change CLI code.
- Do not commit the installed service copy under `~/.config/systemd/user/`.
- Do not use `sudo`.
- Keep the tracked unit exactly aligned with the lab specification.
