# VPS deployment preparation

For the initial domain-free test deployment, follow [IP and port testing](IP_TEST_DEPLOYMENT.md). It uses port 8080 for the website and a separate SSH tunnel for admin access. The steps below are for the later HTTPS deployment.

For automatic testing and deployment after pushes to `main`, follow [CI/CD setup](CI_CD_SETUP.md).

Prepared after reading `C:\Deployments\LawyerWebsite` as a reference. No SSH connection, DNS change, remote deployment or change to that site's files has been made.

## Isolation from the existing website

| Resource | Existing LawyerWebsite reference | Vedā |
| --- | --- | --- |
| Compose project | Existing project | `veda` |
| Frontend bind | `127.0.0.1:3000` | `127.0.0.1:3100` |
| Backend bind | `127.0.0.1:5000` | `127.0.0.1:5100` |
| Database | Existing database/volume | Separate PostgreSQL container and `veda_veda_postgres` volume |
| Nginx | Existing virtual host | New virtual host for a domain Rahul supplies |

The database has no published production port. Frontend and API bind only to loopback on the host. Nginx handles public HTTPS and routes `/api/` to Express. The frontend has an additional standard Next.js standalone build for this VPS, while the existing local Vinext workflow remains available. The former private Sites deployment does not run this Express backend.

## Prepare before deployment

Need the astrology domain, server access/deployment directory, owner notification email, support email, verified Resend sender and key, Razorpay test credentials and webhook secret. Do not put secrets in Git or chat. Fill `docker.env` on the server through a secure terminal. Choose a unique long random hexadecimal database password.

Publish business identity, consultation delivery arrangements, privacy/retention details and cancellation terms. Keep `BOOKING_ENABLED=false` until the end-to-end test flow has passed. Use test mode and a separate test database before switching to live credentials.

## Deployment commands for the later deployment task

Run in a separate checkout such as `/opt/veda`. Never run these commands in the LawyerWebsite directory. Inspect free memory/disk and ports first. Do not reuse its secrets, volume or Nginx file.

```sh
cp docker.env.example docker.env
chmod 600 docker.env
# Edit docker.env with the supplied domain and credentials.
docker compose --env-file docker.env config --quiet
docker compose --env-file docker.env build
docker compose --env-file docker.env up -d
docker compose --env-file docker.env ps
docker compose --env-file docker.env exec api node dist/scripts/admin.js your-admin-email@example.com
curl --fail http://127.0.0.1:5100/api/health
curl --head http://127.0.0.1:3100
```

The migration service runs append-only migrations before the API/worker start. The migration runner takes a PostgreSQL advisory lock. For later releases, take a backup and explicitly run the migration service after the new image is built, before restarting API/worker. Schema rollback is not the same as a code rollback.

Copy `deploy/nginx/veda.conf` to a new Nginx virtual host, replace only the example domain, run `nginx -t`, enable it, and obtain a TLS certificate with the server's established Certbot process. Production admin cookies require HTTPS. Preserve all existing Nginx sites. Verify the existing website still responds after any Nginx reload.

Configure the Razorpay webhook at `/api/webhooks/razorpay` with the separate signing secret and the events listed in `backend/README.md`. Enable automatic payment capture in Razorpay. Verify a test payment, browser-close recovery, duplicate webhook, reschedule email, cancellation/refund, Hindi client email and owner email. Confirm failed jobs are visible and the worker is running. Use a new live database/deployment when moving from test to live mode.

## Operations

```sh
docker compose --env-file docker.env logs --tail=100 api worker
docker compose --env-file docker.env exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > veda-backup.dump
```

Encrypt backups, restrict access, store a copy off the VPS and periodically restore into a separate temporary database. Keep timestamped backups before migrations. Do not run `docker compose down -v` on production. To close new bookings, set `BOOKING_ENABLED=false` and recreate API/worker with the env file; leave the worker active for outstanding jobs.

Monitor disk, memory, database backups, API health, worker logs, failed jobs and refund state. Connection pools default to ten per process. The database queue avoids a separate Redis service. One worker processes jobs sequentially with a one-second cadence to bound provider request load. This deployment has a single consultation resource; scaling the number of astrologers would require resource-specific availability.

Rollback application images only to a version compatible with the current schema. Investigate ambiguous provider operations using the existing order/refund/message IDs and idempotency keys, rather than creating new transactions.
