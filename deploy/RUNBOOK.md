# MarkBrain VPS Operations Runbook

Day-2 operations for a MarkBrain server: update, manage users, back up, restore.
For the first install walk-through, see [DEPLOY.md](../DEPLOY.md) — this file
assumes the server is already running and explains how to keep it that way.

Throughout the file, `YOUR_VPS` is your server as SSH sees it
(`you@markbrain.yourdomain.com`), and `you@yourdomain.com` is the owner account.

---

## How a deployment is shaped

The playbook builds and ships the app, but it never touches your data. The
whole server state is one SQLite file; everything else can be rebuilt by
redeploying.

```text
/srv/markbrain/            app (dist/, server/, src/, scripts/, node_modules) — root-owned;
                           the markbrain user only reads it, so the app process can never
                           rewrite the code it serves
/var/lib/markbrain/        data (0700, markbrain:markbrain) — the only thing to back up
  markbrain.sqlite         the database: projects, threads, artifacts, encrypted API keys
  tts-cache/               TTS audio cache (regenerable, safe to delete)
/etc/markbrain/
  markbrain.env            service environment (root:markbrain 0640)
  secrets/                 root-only (0700)
    owner-password         owner password — EPHEMERAL (0600), deleted by the playbook
                           right after use; only the hash file below persists
    owner-password-hash    the password verifier the owner account is seeded from
/etc/caddy/conf.d/markbrain.caddy    HTTPS + routing (rendered from your inventory)
/etc/systemd/system/markbrain.service
```

Network flow:

```text
Browser --HTTPS--> Caddy --/api/*--> Node (127.0.0.1:3032)
                       +------------> static dist/ from disk (SPA)
```

Only `/api/*` reaches the Node process. A visitor who just opens the site and
stays in Local Workspace mode is served static files by Caddy and never touches
the database or the Node server at all.

---

## First bootstrap

(If you are installing for the first time, follow [DEPLOY.md](../DEPLOY.md) —
this is the short version.)

**The idea.** MarkBrain has no public sign-up. The owner account is created
during the first deploy from a *password verifier* — a `scrypt$salt$hash`
string that lets the server check a login but cannot log in itself and does not
reveal the password. You generate the verifier on your own machine, so the
plaintext password never crosses the network or lands in shell history.

The plaintext still matters, though. Your saved API keys live in a vault
encrypted with a key derived from the password you type at login — so:

- keep the plaintext password in a password manager; it is needed at every
  login and the vault cannot be re-keyed from the hash alone;
- knowing the hash does not let anyone log in — it is only an offline guess
  target, which is nothing against a strong password.

**The commands.** On your own machine:

```bash
# 1. generate the verifier — prompts on muted stdin, writes scrypt$salt$hash
node scripts/password-hash.cjs --out /tmp/owner-password-hash

# 2. upload ONLY the hash (it cannot be used to log in) and install it root-only
scp /tmp/owner-password-hash YOUR_VPS:/tmp/owner-password-hash
ssh YOUR_VPS 'sudo install -m 0600 /tmp/owner-password-hash /etc/markbrain/secrets/owner-password-hash && rm /tmp/owner-password-hash'
rm /tmp/owner-password-hash

# 3. deploy — the playbook seeds the owner account from the stored hash
cp deploy/ansible/inventory.ini.example deploy/ansible/inventory.ini   # edit domain + email
ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml
```

To pass the hash without a temporary file:

```bash
ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml \
  -e "markbrain_owner_password_hash=$(cat /path/to/owner-password-hash)"
```

Two other bootstrap paths exist and are deliberately less clean — know what you
are trading away if you use them:

- `-e "markbrain_owner_password=..."` — convenient, but the plaintext lands in
  your local shell history (`no_log` hides Ansible's output, not the
  invocation).
- writing the plaintext into `/etc/markbrain/secrets/owner-password` (0600) on
  the VPS — the playbook seeds from it and **deletes it immediately after**;
  the plaintext touches the server only for the duration of one playbook run.

Either way, the only persistent artifact on the server is the **hash** file —
never the plaintext.

---

## Routine update

```bash
ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml
```

Safe to run at any time, as often as you like. What it does, in order: builds
the app locally (with a guard against secrets leaking into the bundle), rsyncs
it to `/srv/markbrain/`, installs Node dependencies on the server, seeds the
owner account if it does not exist yet, installs the systemd unit and Caddy
config, restarts the service, and blocks until `/api/health` answers 200. Your
data in `/var/lib/markbrain/` is never touched.

The restart is unconditional and not optional: rsynced files only take effect
at process startup, so without it the old process would keep answering `/api/*`
from memory while Caddy serves the fresh `dist/` from disk — client and server
drift apart and half the app behaves like the previous version. After the
restart the vault starts locked; an open tab re-arms silently from its saved
re-arm key, otherwise you type the password once.

Note on dependencies: the repo has no `package-lock.json`, so `npm install`
re-resolves from `package.json` on every deploy (this is also why dev
dependencies are installed on the server — `tsx` runs the server at runtime).
If a deploy ever breaks because upstream published a bad version, pin that
version in `package.json` and redeploy.

---

## Rotate owner password

**The idea.** Two very different situations:

**You know the current password** — change it in the app: **Model Settings →
Keys → Password**. You type the current and the new password; the server
verifies the old one and re-keys the vault, so your saved API keys carry over.
This works for any account, not just the owner — prefer it over everything
below.

**You lost the password** — no app can help you: the vault is encrypted under
the lost password, so the saved API keys are gone no matter what. Rotate via
the playbook (it needs the new password on the command line, because the vault
must be re-keyed under it — a hash alone cannot do that) and plan to re-enter
your API keys afterwards:

```bash
ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml \
  -e "markbrain_owner_password=<new>" rotate_owner_password=true
```

Or by hand on the server — write the new password into the ephemeral secrets
file, rotate, delete the file (same `MARKBRAIN_DB_PATH` rule as in *Manage
users*):

```bash
# type the new password into the file (0600, root-only), then:
cd /srv/markbrain && sudo env MARKBRAIN_DB_PATH=/var/lib/markbrain/markbrain.sqlite \
  npx tsx scripts/user-admin.ts passwd you@yourdomain.com \
  --password-file /etc/markbrain/secrets/owner-password \
  && sudo rm /etc/markbrain/secrets/owner-password
```

The plaintext exists on the server only inside that 0600 file for the duration
of the change, and in Node's memory while the change is applied.

---

## Manage users

**The idea.** Accounts are managed by a CLI on the server; there is no web UI
for it. The CLI talks to the same SQLite file as the service — it reads
`MARKBRAIN_DB_PATH`, so point it at `/var/lib/markbrain/markbrain.sqlite` or it
will look at `./data/markbrain.sqlite` (a dev-machine default) and find nothing.

```bash
cd /srv/markbrain && sudo -u markbrain env MARKBRAIN_DB_PATH=/var/lib/markbrain/markbrain.sqlite \
  npm run user -- list

# same prefix for: enable <email> · disable <email>
# create <email> --password-hash <scrypt$...> --owner   (the bootstrap path above)
# passwd needs the new password — see "Rotate owner password" above, it shows
# both the playbook way and the by-hand way
```

---

## Health and logs

```bash
curl -s http://127.0.0.1:3032/api/health      # from the server
curl -s https://markbrain.yourdomain.com/api/health   # from outside, through Caddy

sudo journalctl -u markbrain.service -f       # app logs
sudo journalctl -u caddy -f                   # HTTPS / proxy logs
```

---

## Backups & Restore

**The idea.** `/var/lib/markbrain/markbrain.sqlite` is the entire server state.
Two things you might want from it:

1. **A binary snapshot** — a consistent copy of the database, for when the
   server dies. This is what you restore from.
2. **A plaintext tree export** — one user's projects as `.md` + `.json` files,
   for browsing, diffing, or keeping in Git.

### Binary snapshot

`npm run backup-sqlite` uses SQLite's online backup API: consistent even while
the server is running, never locks the source. The copy has the temporary 7-day
`api_call_logs` debug table stripped so it stays small (pass `--keep-call-logs`
to keep it).

The script opens the database at `MARKBRAIN_DB_PATH` — on the server that is
`/var/lib/markbrain/markbrain.sqlite`, not the dev-machine default, so the
variable below is part of the command, not decoration:

```bash
cd /srv/markbrain && sudo -u markbrain env MARKBRAIN_DB_PATH=/var/lib/markbrain/markbrain.sqlite \
  npm run backup-sqlite -- --out /var/lib/markbrain/snapshots/markbrain-$(date +%F).sqlite
```

**Daily scheduled backup** — the idea is three steps: snapshot on the server
over SSH, copy the file to your own machine, delete local copies older than 7
days. Save this as `~/bin/markbrain-backup.sh` on whatever machine should hold
the backups (cron runs it; you can also run it by hand after a big change):

```bash
#!/bin/sh
# Snapshot the MarkBrain database on the server, pull it here, keep 7 days.
set -e
D=$(date +%F)
S=markbrain-$D.sqlite
DEST=$HOME/backups/markbrain

mkdir -p "$DEST"

# 1. snapshot the live database (safe while the server runs)
ssh YOUR_VPS "cd /srv/markbrain && sudo -u markbrain env \
  MARKBRAIN_DB_PATH=/var/lib/markbrain/markbrain.sqlite \
  npm run backup-sqlite -- --out /var/lib/markbrain/snapshots/$S"

# 2. copy today's snapshot down
scp YOUR_VPS:/var/lib/markbrain/snapshots/$S "$DEST/"

# 3. keep only the newest 7 local snapshots
ls -1t "$DEST"/markbrain-*.sqlite | tail -n +8 | xargs -r rm --
```

Then schedule it (`crontab -e`):

```cron
0 4 * * * /home/you/bin/markbrain-backup.sh >> /home/you/backups/markbrain/backup.log 2>&1
```

The date is computed once at the top on purpose: a version that computes it
separately on each side can disagree around midnight and copy nothing. If a
step fails, `set -e` stops the run and the reason lands in `backup.log` — a
silent gap is worse than a failed backup you can see.

### Restore

```bash
ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml \
  -e restore_db=$HOME/backups/markbrain/markbrain-YYYY-MM-DD.sqlite
```

The playbook stops the service, removes any stale `-wal`/`-shm` files (SQLite
sidecars holding recent writes — leaving them next to a restored file would mix
old data into your snapshot), uploads the snapshot with `markbrain:markbrain`
0600 ownership, and starts the service again.

### Plaintext tree export / import

For Git or hand-browsing, a user's projects can round-trip through plain files.
Same `MARKBRAIN_DB_PATH` rule as above:

```bash
# all projects for a user, into a directory of .md + .json files:
cd /srv/markbrain && sudo -u markbrain env MARKBRAIN_DB_PATH=/var/lib/markbrain/markbrain.sqlite \
  npm run export-plaintext -- --user you@yourdomain.com --out /path/to/export-dir

# or a single project:
... npm run export-plaintext -- --user you@yourdomain.com --project <projectId> --out /path/to/export-dir

# import a plaintext tree back into the database:
... npm run import-plaintext -- --user you@yourdomain.com --in /path/to/export-dir
```

The export directory must be writable by the `markbrain` user. You can also run
these on your own machine against a pulled snapshot:

```bash
MARKBRAIN_DB_PATH=$HOME/backups/markbrain/markbrain-YYYY-MM-DD.sqlite \
  npm run export-plaintext -- --user you@yourdomain.com --out /path/to/export-dir
```

---

## Troubleshooting

- **Service won't start after deploy** — `journalctl -u markbrain.service -n 100`.
  Most common cause: an `npm install` resolution drift; pin the offending
  package and redeploy.
- **502 from Caddy** — Node is down or not listening on 127.0.0.1:3032;
  check `systemctl status markbrain`.
- **SSE chat streams buffer / never flush** — the Caddyfile must keep
  `flush_interval -1` on the `/api/*` proxy block.
- **A CLI command finds no database** — it reads `MARKBRAIN_DB_PATH` and falls
  back to `./data/markbrain.sqlite`; on the server the database lives at
  `/var/lib/markbrain/markbrain.sqlite` (see *Manage users* above).
- **Vault locked after a restart** — expected: the derived key lives in tab
  RAM only. Unlock with the password in the composer popup; it re-arms
  automatically while a tab still holds the key.
