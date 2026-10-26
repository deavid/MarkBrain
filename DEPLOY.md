# Deploying MarkBrain to Your Own Server (with Ansible)

This guide walks you through putting MarkBrain on a Linux VPS so you can use it
from your phone, your laptop, and anywhere else — with your projects synced to
your own database, under your own domain, behind HTTPS.

No Kubernetes, no Docker required on the server, no cloud lock-in. Just a small
Linux box, Caddy for HTTPS, SQLite for storage, and one Ansible command when you
want to update.

---

## First: what actually gets installed?

Before running anything, it helps to know what is going to live on your server
and why. There are only three moving parts:

```text
Your browser / phone
        │
        │  HTTPS (automatic via Let's Encrypt)
        ▼
     [ Caddy ]  ──► serves the compiled frontend directly from disk (/srv/markbrain/dist)
        │
        │  only /api/* requests go further
        ▼
  [ Node server ]  (127.0.0.1:3032, managed by systemd as the `markbrain` user)
        │
        ▼
  [ SQLite file ]  (/var/lib/markbrain/markbrain.sqlite — one file, easy to back up)
```

A nice side effect of this layout: **anyone who just opens the site without
logging in never even touches the Node process.** Caddy hands them the static
files from disk and they stay in Local Workspace mode in their own browser.
Only `/api/*` wakes up the backend.

On disk, everything goes into three tidy places:

- `/srv/markbrain/` — the application code and compiled frontend
- `/var/lib/markbrain/` — your SQLite database and TTS audio cache (`0700`, owned by the `markbrain` system user — nobody else on the machine can read it)
- `/etc/markbrain/` — configuration and the `/etc/markbrain/secrets/` folder (`0700`, root-only)

---

## What you need before starting

**On the server (your VPS):**

1. **A Debian or Ubuntu Linux machine** you can SSH into as `root` (or a user with `sudo`). Even a tiny 1 GB RAM VPS is plenty.
2. **A domain or subdomain pointing to the server's IP** — for example `markbrain.yourdomain.com` with an `A` (and optionally `AAAA`) DNS record.
3. **Ports 80 and 443 open** in your firewall so Caddy can get a Let's Encrypt certificate and serve HTTPS.
4. **Node.js 22.12+ (22 LTS or 24 LTS) and Caddy installed** on the server.
   - To check: `ssh root@your-server 'node -v && caddy version'`
   - Make sure `/etc/caddy/Caddyfile` includes `import /etc/caddy/conf.d/*.caddy` (or `/etc/caddy/conf.d/*`), because that is where the playbook drops `markbrain.caddy`. That way it never steps on any other sites you already host on the same machine.

**On your own machine (where you run the deploy from):**

1. This repository cloned locally, with dependencies installed (`bun install`, or `npm install --legacy-peer-deps` — see [INSTALL.md](./INSTALL.md)).
2. `ansible` and `rsync` installed (`sudo apt install ansible rsync` on Debian/Ubuntu).
3. SSH key access to your server so Ansible can connect without asking for a password at every step.

---

## Step 1 — Point the config at your domain and server

Two files contain the domain `markbrain.unhaunter.com` as the default. Replace
it with yours:

**1. Create your Ansible inventory from the example:**

```bash
cp deploy/ansible/inventory.ini.example deploy/ansible/inventory.ini
```

Open `deploy/ansible/inventory.ini` in your editor and set your host, domain,
and owner email:

```ini
[markbrain_vps]
markbrain.yourdomain.com ansible_user=root

[markbrain_vps:vars]
markbrain_domain=markbrain.yourdomain.com
markbrain_port=3032
markbrain_owner_email=you@yourdomain.com
markbrain_owner_password=""
ansible_ssh_common_args="-o ControlMaster=auto -o ControlPersist=60s"
```

(Leave `markbrain_owner_password=""` empty — we will handle the password
properly in Step 2 so it never sits in a config file or in your bash history.)

**2. Update the domain at the top of `deploy/Caddyfile`:**

Open `deploy/Caddyfile` and change the first line from `markbrain.unhaunter.com {`
to your domain:

```caddyfile
markbrain.yourdomain.com {
    encode zstd gzip
    ...
```

---

## Step 2 — Create your owner password hash (without exposing the password)

MarkBrain is a single-tenant personal server: there is no public sign-up page.
Account #1 is the **owner account**, created during the first deploy.

Now, a small security detail worth taking thirty seconds to understand:

If you pass a password on the command line (like `-e "password=..."`), it gets
recorded in your local `~/.bash_history`, and anyone running `ps` while the
command executes can see it. We don't want that.

Instead, we generate the **password hash** locally on your machine. The script
prompts you on a muted input (nothing is echoed to the screen, nothing goes into
shell history) and writes out `scrypt$<salt>$<hash>` — the exact verification
string the server stores in SQLite.

Run this on your machine:

```bash
node scripts/password-hash.cjs --out /tmp/owner-password-hash
```

Type your chosen password (at least 8 characters) and press Enter.

> **Keep that password safe in your password manager.**
> Two things happen when you log in to MarkBrain: the server checks your
> password against this hash, and it also uses the password you type to derive
> the encryption key for your saved API keys (your vault).
>
> That means:
> - **Knowing the hash does not let anyone log in** — it is just a verifier.
> - **The server never stores your plaintext password** — not on disk, not in
>   the database.
> - **Your API keys are encrypted with a key derived from your password**, so
>   you will need that password whenever you log in or unlock the vault after a
>   server restart.

---

## Step 3 — Run the first deploy

Now run the playbook from the root of the repository, feeding it the hash file
you just generated:

```bash
ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml \
  -e "markbrain_owner_password_hash=$(cat /tmp/owner-password-hash)"

rm /tmp/owner-password-hash
```

What Ansible does for you, in order:

1. **Builds the production frontend locally** on your machine (`npm run build`), including a check that no secrets leaked into the bundle.
2. **Installs `ffmpeg`, `sqlite3`, and `rsync`** on the server if they aren't there yet (`ffmpeg` is used when you import audio files).
3. **Creates the `markbrain` system user** and the directories `/srv/markbrain`, `/var/lib/markbrain` (`0700`), and `/etc/markbrain`.
4. **Creates `/etc/markbrain/markbrain.env`** (only if it doesn't exist yet, so later deploys won't overwrite your edits).
5. **Syncs the built app** to `/srv/markbrain/` over `rsync` and installs the Node dependencies on the server.
6. **Seeds your owner account (#1)** from the hash in `/etc/markbrain/secrets/owner-password-hash` (`0600`). If the account already exists, this step quietly does nothing.
7. **Installs the systemd service and the Caddy config**, enables and starts `markbrain.service`, reloads Caddy.
8. **Waits until `http://127.0.0.1:3032/api/health` returns `200 OK`** before declaring success.

When it finishes, open `https://markbrain.yourdomain.com` in your browser, sign
in with your email and password, and add your Gemini / OpenRouter API keys in
**Model Settings → Keys**. They will be encrypted into your server vault.

---

## Updating later

Once the server is bootstrapped, your owner account and the hash file are
already in place. Every future update is just one command from the repository
root:

```bash
git pull
ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml
```

No passwords, no extra flags. Your SQLite database lives in `/var/lib/markbrain/`,
completely separate from `/srv/markbrain/`, so code updates never touch your
data.

---

## Everyday operations (the commands you'll actually use)

**Check that the backend is healthy:**

```bash
curl -s https://markbrain.yourdomain.com/api/health
```

**Watch the live server logs:**

```bash
ssh root@markbrain.yourdomain.com 'journalctl -u markbrain.service -f'
```

**Restart the server manually:**

```bash
ssh root@markbrain.yourdomain.com 'systemctl restart markbrain'
```

*(Note: restarting the Node process clears its RAM, which locks the API-key
vault. Next time you have MarkBrain open in a browser tab that was already
unlocked, it will silently re-arm the vault for you; otherwise the send button
shows a small padlock and asks for your password once.)*

**Back up your database:**

Your entire server state — projects, threads, artifacts, encrypted API keys — is
a single SQLite file. Back it up online-safely with SQLite's `.backup` command:

```bash
ssh root@markbrain.yourdomain.com \
  'sqlite3 /var/lib/markbrain/markbrain.sqlite ".backup /var/lib/markbrain/backup-$(date +%F).sqlite"'
```

And pull a copy to your own machine whenever you like:

```bash
scp root@markbrain.yourdomain.com:/var/lib/markbrain/backup-*.sqlite ./
```

**Change your password later:**

Why is changing a password slightly different from creating the account? Because
when you change your password, the server also has to **re-encrypt your saved
API keys** under the new password — and encryption requires the new password
itself (briefly, in RAM), not just its hash.

To rotate it without putting the password in your local shell history, pipe it
over SSH into the ephemeral file on the server, run the playbook with
`rotate_owner_password=true`, and the playbook deletes the plaintext file right
after re-keying:

```bash
# 1. type the new password on stdin, then press Enter and Ctrl-D
ssh root@markbrain.yourdomain.com \
  'install -m 0600 /dev/stdin /etc/markbrain/secrets/owner-password'

# 2. run the rotation (reads the file, re-encrypts the vault, deletes the file)
ssh root@markbrain.yourdomain.com \
  'cd /srv/markbrain && MARKBRAIN_DB_PATH=/var/lib/markbrain/markbrain.sqlite \
   npx tsx scripts/user-admin.ts passwd you@yourdomain.com \
   --password-file /etc/markbrain/secrets/owner-password && \
   rm -f /etc/markbrain/secrets/owner-password'
```

 The plaintext exists on the server for a few seconds inside a root-only `0600`
file and in Node's memory while it re-encrypts your keys, and then it is gone.

---

## If something goes wrong

- **Playbook fails at Step 7 (`npm install`)** — check `node -v` on the VPS. MarkBrain needs Node **22.12+** (or 24 LTS). Older Node 18/20 will fail dependency checks.
- **Browser shows 502 Bad Gateway** — Caddy is up, but Node isn't listening on `127.0.0.1:3032`. Run `systemctl status markbrain` and `journalctl -u markbrain.service -n 80` on the VPS to see why.
- **HTTPS certificate doesn't issue** — check that DNS for your domain actually points to the server's IP (`dig +short markbrain.yourdomain.com`) and that ports 80 and 443 are open, then check `journalctl -u caddy -n 80`.
- **Chat responses arrive all at once instead of streaming** — make sure `flush_interval -1` is present inside the `reverse_proxy` block in `/etc/caddy/conf.d/markbrain.caddy`.

For a terse quick-reference card when you already know the system, see
[`deploy/RUNBOOK.md`](./deploy/RUNBOOK.md).