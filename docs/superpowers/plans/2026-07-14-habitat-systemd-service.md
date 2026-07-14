# Habitat systemd User Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the Habitat API on OpenClaw as an enabled, persistent systemd user service.

**Architecture:** Keep one portable service-unit source in the repository, then copy it into user systemd's unit directory on the server. Systemd supervises the existing Bun `server` script and journald supplies persistent service logs; no application code changes are required.

**Tech Stack:** Bun, TypeScript, systemd user services, OpenSSH, Git, journald.

## Global Constraints

- The tracked unit must be exactly `deploy/habitat-api.service`.
- The deployed checkout is `/home/ok/habitat-cli` and the unit must use `%h/habitat-cli`.
- The unit must execute `/usr/local/bin/bun run server`.
- Do not use `sudo`.
- Do not commit `~/.config/systemd/user/habitat-api.service`.
- Preserve the existing machine-readable `habitat --json` interface.

---

### Task 1: Add the version-controlled service unit

**Files:**
- Create: `deploy/habitat-api.service`
- Test: `deploy/habitat-api.service` inspected with `systemd-analyze verify` on OpenClaw

**Interfaces:**
- Consumes: OpenClaw user home (`%h`) and deployed checkout (`~/habitat-cli`).
- Produces: a unit named `habitat-api.service` that user systemd can load.

- [ ] **Step 1: Create the unit with the approved contents**

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

- [ ] **Step 2: Check the tracked file before committing**

Run: `git diff --check && git diff -- deploy/habitat-api.service`

Expected: no whitespace errors; the diff contains only the approved unit.

- [ ] **Step 3: Commit and push the source unit**

Run: `git add deploy/habitat-api.service && git commit -m "deploy: add Habitat systemd service" && git push origin main`

Expected: the commit succeeds and the remote `main` branch contains `deploy/habitat-api.service`.

### Task 2: Deploy and supervise the unit on OpenClaw

**Files:**
- Source: `deploy/habitat-api.service`
- Create on OpenClaw only: `~/.config/systemd/user/habitat-api.service`

**Interfaces:**
- Consumes: the pushed repository source unit and `systemctl --user` for user `ok`.
- Produces: an enabled, active `habitat-api.service` serving the API on port 8787.

- [ ] **Step 1: Update dependencies and confirm the pulled unit on OpenClaw**

Run on OpenClaw:

```bash
cd ~/habitat-cli
git pull
/usr/local/bin/bun install
ls -l deploy/habitat-api.service
```

Expected: Git fast-forwards or reports already up to date; Bun installs from the lockfile; `ls` displays the tracked service file.

- [ ] **Step 2: Install and validate the user unit**

Run on OpenClaw:

```bash
mkdir -p ~/.config/systemd/user
cp ~/habitat-cli/deploy/habitat-api.service ~/.config/systemd/user/habitat-api.service
systemd-analyze --user verify ~/.config/systemd/user/habitat-api.service
systemctl --user daemon-reload
```

Expected: `systemd-analyze` prints no unit syntax error; daemon reload exits successfully.

- [ ] **Step 3: Enable and start the API**

Run on OpenClaw: `systemctl --user enable --now habitat-api.service`

Expected: systemd creates the enablement link and starts the unit. If it reports port 8787 in use, identify and stop the manually launched `bun run server` process, then run `systemctl --user restart habitat-api.service`.

- [ ] **Step 4: Verify supervisor state and API behavior**

Run on OpenClaw:

```bash
systemctl --user is-enabled habitat-api.service
systemctl --user is-active habitat-api.service
systemctl --user --no-pager status habitat-api.service
curl --fail http://127.0.0.1:8787/registration
/usr/local/bin/bun run src/index.ts status
```

Expected: `enabled`, `active`, status with `Active: active (running)` and `/usr/local/bin/bun run server`; the registration request and CLI status both succeed.

### Task 3: Verify logging, laptop access, and logout persistence

**Files:**
- No repository files changed.

**Interfaces:**
- Consumes: active unit, laptop `habitat` CLI configured for OpenClaw, `journalctl`, and `loginctl`.
- Produces: evidence that systemd owns the backend independently of SSH sessions.

- [ ] **Step 1: Inspect startup logs**

Run on OpenClaw: `journalctl --user -u habitat-api.service -n 30 --no-pager`

Expected: recent server-startup and request log entries are printed directly to the terminal.

- [ ] **Step 2: Correlate a laptop status request with journald**

Run on OpenClaw: `journalctl --user -u habitat-api.service -f`

Then run on the laptop: `habitat status`

Expected: the laptop command succeeds; the follow output includes a new `/status` request and its associated Kepler request. Stop only the log follower with Ctrl+C.

- [ ] **Step 3: Verify user lingering and post-logout availability**

Run on OpenClaw: `loginctl show-user "$USER" -p Linger`

Expected: `Linger=yes`.

Close every OpenClaw SSH session. Then run on the laptop: `habitat status`

Expected: the command succeeds without an open SSH terminal.

- [ ] **Step 4: Practice the repeatable deployment restart check**

Run on OpenClaw:

```bash
cd ~/habitat-cli
git pull
/usr/local/bin/bun install
systemctl --user restart habitat-api.service
systemctl --user is-active habitat-api.service
systemctl --user --no-pager status habitat-api.service
journalctl --user -u habitat-api.service -n 20 --no-pager
```

Expected: `active`, a running main PID, and new journal entries from the restart.

- [ ] **Step 5: Record the deliverable**

Provide the public GitHub repository URL and evidence for active/enabled state, lingering, journal correlation, and post-logout laptop status.
