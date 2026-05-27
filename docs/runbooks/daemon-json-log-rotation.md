# Docker Daemon Log Rotation (W5.7)

A host-config step (not an in-repo file) — `/etc/docker/daemon.json` lives on
the Unraid host, not in the container image.

On the Unraid host:

1. SSH: `ssh unraid`
2. Edit `/etc/docker/daemon.json`. If it doesn't exist, create it. If it
   exists, MERGE keys (don't clobber existing config).
   ```json
   {
     "log-driver": "json-file",
     "log-opts": { "max-size": "50m", "max-file": "5" }
   }
   ```
3. Reload the daemon (Unraid pattern): restart Docker via the WebUI under
   Settings → Docker → Stop, then Start.
   - Alternative if the host supports it: `systemctl reload docker`.
4. Verify the RepOS container picked up the new logging policy:
   ```
   docker inspect RepOS --format '{{.HostConfig.LogConfig}}'
   ```
   Should show `max-size:50m max-file:5`.

**Why:** without rotation, a long-running container can fill
`/var/lib/docker/containers/*/` with multi-GB JSON log files, eventually
exhausting the host filesystem and bricking docker.

**Resource caps (per ABS-8):** the redeploy recipe in `reference_unraid_redeploy`
should run the container with `--memory=2g --cpus=2` so a runaway process (e.g.
a pathological pg_restore) can't starve the host. Flag for the
`reference_unraid_redeploy` memory amend.
