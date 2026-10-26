# MarkBrain VPS Operations Runbook

Status: active runbook for the current single-server deployment.

MarkBrain is a
single-user, single-compatible-client app, so there is deliberately **no**
versioned-release library, no channels, no protocol-hash dance. One app
directory, one SQLite database, one systemd unit, Caddy in front.

---

## Layout on the VPS

```text
/srv/markbrain/            app (dist/, server/, src/, scripts/, node_modules) — root-owned; the markbrain user only reads it
/var/lib/markbrain/        data (0700, markbrain:markbrain)
  markbrain.sqlite         the database — back this up
  tts-cache/               TTS audio cache
/etc/markbrain/
  markbrain.env            service environment (root:markbrain 0640)
  secrets/                 root-only (0700)
    owner-password         owner account password — EPHEMERAL (0600, deleted by the
                       playbook right after use; only the hash file persists)
/etc/caddy/conf.d/markbrain.caddy
/etc/systemd/system/markbrain.service
```

Network flow:

```text
Browser --HTTPS--> Caddy --/api/*--> Node (127.0.0.1:3032)
                       +------------> static dist/ from disk (SPA)
```

Random visitors in Local Workspace mode never touch the Node process.

---

## First Bootstrap

Preferred (the plaintext password never leaves your machine):

```bash
# 1. generate the hash locally — prompts on muted stdin, prints scrypt$salt$hash
node scripts/password-hash.cjs --out /tmp/owner-password-hash

# 2. upload ONLY the hash to the VPS (the hash cannot be used to log in)
scp /tmp/owner-password-hash YOUR_VPS:/tmp/owner-password-hash
ssh YOUR_VPS 'sudo install -m 0600 /tmp/owner-password-hash /etc/markbrain/secrets/owner-password-hash && rm /tmp/owner-password-hash'
rm /tmp/owner-password-hash

# 3. deploy — the playbook seeds the owner account from the stored hash
cp deploy/ansible/inventory.ini.example deploy/ansible/inventory.ini   # edit email
ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml
```

The hash is `scrypt$salt$hash` — the exact verifier the server stores. It is
NOT a login credential and knowing it does not reveal the password; it is only
an offline dictionary target, which means nothing against a strong password.
The server generates its own vault salt, so the vault works normally: at login
the vault key derives from the password you type. KEEP THE PLAINTEXT
SOMEWHERE SAFE — it is needed at every login, and the vault cannot be
re-keyed from the hash alone.

To pass the hash without a file (e.g. from a local .env reference):

```bash
ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml \
  -e "markbrain_owner_password_hash=$(cat /path/to/owner-password-hash)"
```

Alternative bootstrap paths (less clean, documented for completeness):

- Plaintext via stdin over SSH into `/etc/markbrain/secrets/owner-password`
  (0600) — playbook seeds from it and **deletes it immediately after**. The
  plaintext touches the VPS disk only for the duration of one playbook run
  (0600, root-only), then exists only in RAM during seed/rotation.
- `-e "markbrain_owner_password=..."` — convenience; lands in your local
  shell history. `no_log` hides Ansible output, not the invocation.

Either way the persistent artifact on the VPS is at most the **hash** file —
never the plaintext.

## Routine Update

```bash
ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml
```

The playbook builds locally, rsyncs the app, `npm install`s on the VPS (dev
deps are required — `tsx` runs the server at runtime; there is no
package-lock.json, bun.lock is canonical on dev machines), restarts the
service only if the unit changed, and blocks until `/api/health` answers 200.

Note: `npm install` re-resolves from package.json each deploy. If a deploy
ever breaks because upstream published a bad version, pin the version in
package.json and redeploy.

## Rotate Owner Password

The rotation path needs the PLAINTEXT (the vault must be re-encrypted under
the new password; a hash alone cannot do that, and rotating from a hash would
drop all saved API keys):

```bash
ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml \
  -e "markbrain_owner_password=<new> rotate_owner_password=true"
```

(Or overwrite `/etc/markbrain/secrets/owner-password` by hand and run
`sudo npx tsx scripts/user-admin.ts passwd <email> --password-file
/etc/markbrain/secrets/owner-password` in /srv/markbrain — then delete the
file. The plaintext exists on the VPS only in that 0600 file for the duration
of the change, and in Node's RAM while the vault is re-keyed.)

## Operations and Verification

Health check (from the VPS):

```bash
curl -s http://127.0.0.1:3032/api/health
```

From outside:

```bash
curl -s https://markbrain.unhaunter.com/api/health
```

Service logs:

```bash
sudo journalctl -u markbrain.service -f
```

Caddy logs:

```bash
sudo journalctl -u caddy -f
```

Database backup (do it before risky operations):

```bash
sudo sqlite3 /var/lib/markbrain/markbrain.sqlite ".backup '/var/lib/markbrain/backup-$(date +%F).sqlite'"
```

## Troubleshooting

- **Service won't start after deploy** — `journalctl -u markbrain.service -n 100`.
  Most common cause: an `npm install` resolution drift; pin the offending
  package and redeploy.
- **502 from Caddy** — Node is down or not listening on 127.0.0.1:3032;
  check `systemctl status markbrain`.
- **SSE chat streams buffer / never flush** — the Caddyfile must keep
  `flush_interval -1` on the `/api/*` proxy block.
- **Vault locked after a restart** — expected: the derived key lives in tab
  RAM only. Unlock with the password in the composer popup; it re-arms
  automatically while a tab still holds the key.