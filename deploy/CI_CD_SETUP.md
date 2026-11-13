# GitHub Actions CI/CD for AstroSite

The workflow is `.github/workflows/ci-deploy.yml`. Pull requests and pushes to `main` run backend tests against disposable PostgreSQL, compile the backend, build the frontend, and test deployment orchestration. After checks pass, a `main` push can deploy the exact tested commit to `/opt/veda` over SSH. Manual runs are available in Actions.

Deployment stays skipped until the repository variable `DEPLOY_ENABLED` is set to `true`. This lets you finish the one-time setup first. No SSH or provider secrets are committed. `docker.env` remains only on your VPS.

## 1. Prepare a dedicated deployment account — VPS root terminal

Run these commands yourself. They affect only Vedā's checkout and the new automation account. Docker group membership gives this trusted account control of the Docker daemon.

```bash
if ! id veda-deploy >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash veda-deploy
fi
usermod -aG docker veda-deploy
```

Confirm the checkout path before changing its ownership:

```bash
readlink -f /opt/veda
```

It must be `/opt/veda`. Then:

```bash
chown -R veda-deploy:veda-deploy /opt/veda
chmod 600 /opt/veda/docker.env
install -d -o veda-deploy -g veda-deploy -m 700 /home/veda-deploy/.ssh
```

Do not change the ownership of `/opt/lawyerwebsite` or its deployment account.

## 2. Generate a dedicated automation key — Windows PowerShell

Run one command at a time. This key is separate from your personal login key and the LawyerWebsite automation key. If the named file already exists, use it or choose a new filename instead of overwriting it.

```powershell
ssh-keygen -t ed25519 -C "github-actions-astrosite" -f "$env:USERPROFILE\.ssh\github_actions_astrosite"
```

Press Enter twice for an empty passphrase so Actions can use the key non-interactively. Upload only its **public** key using your working root SSH login:

```powershell
scp -i "$env:USERPROFILE\.ssh\cloudonfire_root" "$env:USERPROFILE\.ssh\github_actions_astrosite.pub" root@151.242.187.95:/tmp/github_actions_astrosite.pub
```

If you use another personal SSH key, substitute that path in the upload command.

## 3. Authorize the automation key — VPS root terminal

```bash
touch /home/veda-deploy/.ssh/authorized_keys
cat /tmp/github_actions_astrosite.pub >> /home/veda-deploy/.ssh/authorized_keys
chown veda-deploy:veda-deploy /home/veda-deploy/.ssh/authorized_keys
chmod 600 /home/veda-deploy/.ssh/authorized_keys
```

Print the server's public host key for GitHub's known-hosts secret:

```bash
printf '151.242.187.95 %s\n' "$(cat /etc/ssh/ssh_host_ed25519_key.pub)"
```

Copy the entire output line. This is a public host key; the private server host key must never be copied.

## 4. Verify access — Windows PowerShell

```powershell
ssh -o BatchMode=yes -i "$env:USERPROFILE\.ssh\github_actions_astrosite" veda-deploy@151.242.187.95 "whoami && docker compose version && cd /opt/veda && git status --short --branch"
```

Expected: `veda-deploy`, the Docker Compose version, and the repository status. Resolve any errors before enabling deployment. If GitHub access is private, configure a separate read-only GitHub deploy key on the VPS so `git fetch origin main` works as `veda-deploy`.

## 5. Configure GitHub repository secrets

In **Rahul2749/AstroSite → Settings → Secrets and variables → Actions → Secrets**, add:

| Secret | Value |
| --- | --- |
| `DEPLOY_HOST` | `151.242.187.95` |
| `DEPLOY_USER` | `veda-deploy` |
| `DEPLOY_SSH_KEY` | Full private key generated in step 2 |
| `DEPLOY_KNOWN_HOSTS` | Entire public host-key line printed in step 3 |

Copy the private automation key directly to your clipboard for the GitHub secret form:

```powershell
Get-Content -Raw "$env:USERPROFILE\.ssh\github_actions_astrosite" | Set-Clipboard
```

Paste it only into GitHub's `DEPLOY_SSH_KEY` form. Do not paste it into chat or commit it. Razorpay and Resend keys do not belong in this workflow; they stay in `/opt/veda/docker.env`.

## 6. Enable and run

In **Settings → Secrets and variables → Actions → Variables**, add this repository variable:

```text
Name: DEPLOY_ENABLED
Value: true
```

Then open **Actions → CI and deploy test site → Run workflow → main**. The first deployment after enabling runs checks, builds images on the VPS, backs up the Vedā database, applies migrations and restarts the app. Watch for `Deployment is healthy: <commit>`.

Subsequent pushes to `main` deploy automatically after checks pass. Pull requests only run checks. Failed tests or builds prevent deployment. New commits supersede older queued releases. Deployments are serialized and already-running deployments are not cancelled.

## Deployment behavior and recovery

- The server must have a clean source checkout. Ignored `docker.env` is preserved. The workflow fetches and fast-forwards `main` to the tested SHA; it never resets or discards local changes.
- Only the `veda` Compose project and the IP-testing files are used. This workflow does not edit host Nginx or the existing website.
- A database dump is stored before migrations under `/opt/veda/.deployment/backups/`, with restrictive permissions. This directory is excluded from Git and Docker builds. Monitor disk usage and copy backups to secure off-server storage. Dumps are not automatically deleted.
- Migration failure stops the rollout. Health checks cover the API, homepage, public admin blocking, private admin page, and running services. The gateway is recreated to refresh Docker service addresses.
- Last successful commit is recorded in `.deployment/last-deployed-commit`.
- There is no blind automatic database rollback. If a rollout fails after migrations, inspect logs and confirm schema compatibility before restoring an older release. Do not delete the database volume to recover.

For a failed run, these commands are read-only and may be run as `veda-deploy`:

```bash
cd /opt/veda
docker compose --env-file docker.env -f compose.yaml -f compose.ip-test.yaml ps -a
docker compose --env-file docker.env -f compose.yaml -f compose.ip-test.yaml logs --tail=100 api worker frontend gateway
cat .deployment/last-deployed-commit
```

To pause automatic deployment, set `DEPLOY_ENABLED=false`. Checks still run. Environment-file changes require recreating API/worker and can be applied by a manual workflow run. For the later HTTPS deployment, update this IP-specific workflow/script to the intended Compose files and health URLs before enabling it for live mode.
