# Deploy the test site by server IP and port

Run the server commands yourself. This guide uses the VPS IP from your existing deployment reference, `151.242.187.95`. Change it if necessary. No domain or certificate is required for this test setup.

- Public test website: `http://151.242.187.95:8080`
- Private admin, through SSH tunnel: `http://127.0.0.1:8081/admin`
- Razorpay: test mode only. Use sample personal details throughout HTTP testing.
- Host ports 3000/5000 and the existing Nginx site are not changed.

## 1. Connect and clone the GitHub repository

Open Windows PowerShell and use your working SSH login. Replace `SSH_USER` and `KEY_PATH`:

```powershell
ssh -i "KEY_PATH" SSH_USER@151.242.187.95
```

The remaining commands in this section run on the VPS. Use a separate checkout at `/opt/veda`. Stop if that directory already exists and inspect it before continuing. For a fresh deployment:

```sh
if [ -e /opt/veda ]; then
    echo 'STOP: /opt/veda already exists. Inspect it before continuing.'
else
    sudo mkdir /opt/veda &&
    sudo chown "$(id -un):$(id -gn)" /opt/veda &&
    git clone --branch main https://github.com/Rahul2749/AstroSite.git /opt/veda
fi
```

Continue only after cloning succeeds:

```sh
cd /opt/veda
git log -1 --oneline
```

If the GitHub repository is private, authenticate using your usual GitHub credential method or a repository-scoped read-only deploy key. Do not put tokens in clone URLs. Use a login that can run Docker, or prefix Docker commands with `sudo`.

## 2. Check ports and fill the environment file

```sh
ss -ltn | grep -E ':(8080|8081|3100|5100)\b' || true
free -m
df -h /
```

Ports 8080, 8081, 3100 and 5100 must be free. If there is a conflict, stop and choose other ports before starting containers.

```sh
umask 077
cp docker.ip-test.env.example docker.env
openssl rand -hex 32
nano docker.env
```

Copy the generated hex string into `POSTGRES_PASSWORD`. Fill these values in the editor, without pasting credentials into shell commands or committing the file:

```dotenv
APP_ORIGIN=http://151.242.187.95:8080
ADMIN_ORIGIN=http://127.0.0.1:8081
ALLOW_HTTP_TESTING=true
PAYMENT_MODE=test
BOOKING_ENABLED=true
RAZORPAY_KEY_ID=YOUR_RAZORPAY_TEST_KEY_ID
RAZORPAY_KEY_SECRET=YOUR_RAZORPAY_TEST_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
RESEND_API_KEY=YOUR_RESEND_KEY
EMAIL_FROM=Vedā Test <onboarding@resend.dev>
BOOKING_NOTIFY_EMAIL=YOUR_RESEND_ACCOUNT_EMAIL
SUPPORT_EMAIL=YOUR_SUPPORT_EMAIL
```

The Razorpay fields map to the three values in your screenshot. Leave `PRIVACY_URL` and `TERMS_URL` empty for testing. The app uses its built-in pre-launch policy page. You can start with `BOOKING_ENABLED=false` if you want to check the homepage before filling integration details.

Without a verified Resend sending domain, use **your Resend account email as the client email during every booking test**, and as `BOOKING_NOTIFY_EMAIL`. That tests the two notification paths to the same inbox. Arbitrary client recipients require a verified sending domain. See [Resend's restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

```sh
chmod 600 docker.env
```

## 3. Build and start

Run each command and stop on failure:

```sh
cd /opt/veda
docker compose --env-file docker.env -f compose.yaml -f compose.ip-test.yaml config --quiet
docker compose --env-file docker.env -f compose.yaml -f compose.ip-test.yaml build
docker compose --env-file docker.env -f compose.yaml -f compose.ip-test.yaml up -d
docker compose --env-file docker.env -f compose.yaml -f compose.ip-test.yaml ps
curl --fail http://127.0.0.1:5100/api/health
curl --fail http://127.0.0.1:8080/api/health
curl -I http://127.0.0.1:8080/
curl -I http://127.0.0.1:8080/admin
```

Health endpoints should return `{"status":"ok"}`. The public `/admin` URL should return **403**. The public site uses port 8080; the database has no public port. The API and frontend host ports bind only to loopback.

If UFW is already active and port 8080 is blocked, allow that port. Do not enable or reset UFW as part of this deployment:

```sh
sudo ufw status
# Only if already active and you want public test access:
sudo ufw allow 8080/tcp comment 'Veda test site'
```

If the VPS provider has a separate firewall, allow TCP 8080 there too. Keep port 8081 private. Open `http://151.242.187.95:8080` in your browser.

## 4. Create your admin and open its SSH tunnel

On the VPS:

```sh
docker compose --env-file docker.env -f compose.yaml -f compose.ip-test.yaml exec api node dist/scripts/admin.js YOUR_ADMIN_EMAIL
```

Enter a password of at least 14 characters when prompted. Input is hidden. There is no default admin password.

In a **second Windows PowerShell window**, keep this command running:

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8081:127.0.0.1:8081 -i "KEY_PATH" SSH_USER@151.242.187.95
```

Open `http://127.0.0.1:8081/admin` on Windows and sign in. Use this exact address, rather than `localhost`. The tunnel encrypts traffic to the server and provides the admin origin expected by the API. The public gateway blocks `/admin` and `/api/admin`.

## 5. Test booking and payment

1. Use the public website on port 8080. Pick a service and time, use sample personal details, and enter your Resend account email.
2. Confirm Razorpay displays **test mode**. Complete a test payment using Razorpay's [official test instructions](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/).
3. The app must show a verified test booking. Check that it appears in the private admin panel and that both test emails reach your inbox.
4. Test rescheduling, adding a meeting link, cancellation, and a full **test refund**. Check email and refund status in the admin panel.
5. Check Hindi booking and email. Close a checkout midway and reopen it to check payment recovery.

The browser callback and background reconciliation verify test payments even before the public webhook is configured. Do not mark a booking confirmed just because the checkout window closes.

## 6. Configure the Razorpay test webhook

In the Razorpay test dashboard, create a webhook with the same secret stored in `RAZORPAY_WEBHOOK_SECRET`. Select `payment.captured`, `order.paid`, `refund.processed` and `refund.failed`. Enable automatic capture of payments.

Try the public endpoint `http://151.242.187.95:8080/api/webhooks/razorpay` only if the dashboard accepts that port. Some Razorpay configurations restrict webhook ports to 80/443. If port 8080 is rejected, use the optional IP-specific port 80 virtual host below. The website can continue using port 8080.

On the VPS, inspect your existing Nginx configuration before adding it. This file matches the IP hostname only. It must not replace the existing domain's configuration:

```sh
cd /opt/veda
sudo cp deploy/nginx/ip-webhook.conf /etc/nginx/sites-available/veda-ip-webhook
sudo ln -s /etc/nginx/sites-available/veda-ip-webhook /etc/nginx/sites-enabled/veda-ip-webhook
sudo nginx -t
# Reload only after nginx -t succeeds:
sudo systemctl reload nginx
```

Use `http://151.242.187.95/api/webhooks/razorpay` for the test webhook. Confirm your existing domain still responds after the reload. If Nginx reports a conflicting server name, stop and inspect the conflict before making changes. Razorpay recommends HTTPS for webhooks; this is a temporary test-only route. See [Razorpay webhook setup](https://razorpay.com/docs/webhooks/setup-edit-payments/).

## Troubleshooting and later updates

```sh
cd /opt/veda
docker compose --env-file docker.env -f compose.yaml -f compose.ip-test.yaml logs --tail=100 api worker gateway
```

After editing `docker.env`, recreate services to load changed values:

```sh
docker compose --env-file docker.env -f compose.yaml -f compose.ip-test.yaml up -d --force-recreate api worker
```

After changing source or migrations, rebuild, run the migration service explicitly and then restart services:

```sh
docker compose --env-file docker.env -f compose.yaml -f compose.ip-test.yaml build
docker compose --env-file docker.env -f compose.yaml -f compose.ip-test.yaml run --rm migrate
docker compose --env-file docker.env -f compose.yaml -f compose.ip-test.yaml up -d
```

For live deployment later, switch to HTTPS, remove `ALLOW_HTTP_TESTING`, use a fresh live database and live Razorpay credentials, configure the verified sender and policies, and use the normal domain deployment guide. Never enable live payments in the HTTP test setup.
