# Run the Habitat API with systemd

This unit runs the API from `~/habitat-cli` on port `8787`, bound to all
interfaces so a dashboard on the host can reach it.

Install it as the same Linux user that owns `~/habitat-cli`:

```sh
mkdir -p ~/.config/systemd/user
cp ~/habitat-cli/deploy/habitat-api.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now habitat-api.service
```

Check the service and follow its logs:

```sh
systemctl --user status habitat-api.service
journalctl --user -u habitat-api.service -f
curl http://127.0.0.1:8787/health
```

The unit expects Bun at `~/.bun/bin/bun`, which is the path installed by the
standard Bun installer. If Bun is elsewhere, update `ExecStart` in the copied
unit to the absolute path returned by `command -v bun`.

For the service to keep running after logout, enable user lingering once:

```sh
loginctl enable-linger "$USER"
```

To stop or disable it:

```sh
systemctl --user disable --now habitat-api.service
```
