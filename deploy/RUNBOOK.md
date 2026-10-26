# MarkBrain VPS Operations Runbook

Status: active runbook for the current single-server deployment.

Borrowed from the unhaunter hosting model where it made sense; MarkBrain is a
single-user, single-compatible-client app, so there is deliberately **no**
versioned-release library, no channels, no protocol-hash dance. One app
directory, one SQLite database, one systemd unit, Caddy in front.

---

## Layout on the VPS

```text
/srv/markbrain/            app (dist/, server/, src/, scripts/, node_modules)
/var/lib/markbrain/        data (0700, markbrain:markbrain)
  markbrain.sqlite         the database — back this up
  tts-cache/               TTS audio cache
/etc/markbrain/
  markbrain.env            service environment (root:markbrain 0640)
  secrets/                 root-only (0700)
    owner-password         owner account password, root 0600
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

Preferred (password never touches a command line or shell history):

```bash
# on the VPS — paste the password, then Ctrl-D
ssh YOUR_VPS 'sudo install -m 0600 /dev/stdin /etc/markbrain/secrets/owner-password'

# from the dev machine
cp deploy/ansible/inventory.ini.example deploy/ansible/inventory.ini   # edit email
ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml
```

Alternative (convenience, lands in your local shell history):

```bash
ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml \
  -e "markbrain_owner_password=..."
```

Either way the playbook stores the password at
`/etc/markbrain/secrets/owner-password` (0600) and seeds the owner account from
that file — subsequent deploys read the stored file, so you pass nothing.

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

```bash
ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml \
  -e "markbrain_owner_password=<new> rotate_owner_password=true"
```

(Or overwrite `/etc/markbrain/secrets/owner-password` by hand and run
`sudo npx tsx scripts/user-admin.ts passwd <email> --password-file
/etc/markbrain/secrets/owner-password` in /srv/markbrain.)

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