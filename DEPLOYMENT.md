# Habitat Deployment Record

## Deployed commit

The checkout used for deployment is intended to run commit:

```text
b344728b7046a6f236f5bb3c24042e6a9b3c372e
```

The OpenClaw server should report the same value from:

```bash
git rev-parse HEAD
```

## Verification evidence

- API from inside the OpenClaw LXC: **To be confirmed during deployment** with `curl http://127.0.0.1:8787/registration`.
- Laptop Habitat CLI reaching the LXC through Tailscale: **To be confirmed during deployment** with `habitat status` after setting `HABITAT_API_BASE_URL` in the ignored local `.env` file.
- Request logs observed on the OpenClaw server when the laptop ran `habitat status`: **To be recorded during deployment**. Expected entries include lines similar to:

  ```text
  [habitat-api] GET /registration -> 200
  [habitat-api] GET /status -> 200
  ```

- Connection failure after stopping the manual server: **Observed behavior to record during deployment**. Expected result: the laptop CLI reports that it cannot connect because no process is listening on port 8787.

## Why the server binds to `0.0.0.0`

`127.0.0.1` accepts connections only from the same machine. The Habitat backend binds to `0.0.0.0` so it can accept connections through the server's private Tailscale interface. The lab still uses Tailscale access and does not require exposing port 8787 publicly.

## Why `.env` and `habitat.sqlite` are ignored

`.env` contains configuration and credentials, and `habitat.sqlite` contains local Habitat state that may include registration information. They remain in the deployment checkout because the running backend needs them, but Git ignores them so they are not committed or published accidentally.

