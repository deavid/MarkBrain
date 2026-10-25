# 21G — Phase 7: Production Deployment — Caddy, Systemd & Ansible (`markbrain.unhaunter.com`)

> **Phase:** 7 of 7
> **Goal:** Create the production deployment templates (`deploy/Caddyfile`, `deploy/markbrain.service`, `deploy/ansible/playbook.yml`, `deploy/ansible/inventory.ini.example`) so David can deploy local changes to `https://markbrain.unhaunter.com` with a single Ansible command, and update `INSTALL.md`, `README.md`, and `SECURITY.md` to reflect the finished Two-Mode Architecture.
> **Prerequisite:** Phase 6 committed and green.

---

## 1. Create `deploy/Caddyfile`

Create `deploy/Caddyfile` configured for `markbrain.unhaunter.com`:

```caddyfile
markbrain.unhaunter.com {
    encode zstd gzip

    # Only /api/* wakes up the Node + SQLite daemon on 127.0.0.1:3032.
    # flush_interval -1 ensures SSE chat streams (/api/jobs/*/stream) never buffer.
    handle /api/* {
        reverse_proxy 127.0.0.1:3032 {
            flush_interval -1
        }
    }

    # All static assets and SPA routes are served directly by Caddy from disk.
    # Random visitors in Local Workspace mode never touch the Node process.
    handle {
        root * /srv/markbrain/dist
        try_files {path} /index.html
        file_server
    }

    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
```

---

## 2. Create `deploy/markbrain.service` (Systemd Unit)

Create `deploy/markbrain.service`:

```ini
[Unit]
Description=MarkBrain VPS Backend (SQLite + Jobs + Indexer + TTS Cache)
After=network.target

[Service]
Type=simple
User=markbrain
Group=markbrain
WorkingDirectory=/srv/markbrain
EnvironmentFile=/etc/markbrain/markbrain.env
Environment=NODE_ENV=production
Environment=PORT=3032
Environment=MARKBRAIN_DB_PATH=/var/lib/markbrain/markbrain.sqlite
Environment=MARKBRAIN_TTS_CACHE_DIR=/var/lib/markbrain/tts-cache
ExecStart=/usr/bin/npx tsx server.ts
Restart=on-failure
RestartSec=3

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/markbrain

[Install]
WantedBy=multi-user.target
```

---

## 3. Create the Ansible Playbook (`deploy/ansible/`)

Create `deploy/ansible/inventory.ini.example`:

```ini
[markbrain_vps]
markbrain.unhaunter.com ansible_user=root

[markbrain_vps:vars]
markbrain_domain=markbrain.unhaunter.com
markbrain_port=3032
markbrain_owner_email=deavidsedice@gmail.com
# Pass initial owner password only on first bootstrap via:
# ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/playbook.yml -e "markbrain_owner_password=..."
markbrain_owner_password=""
```

Create `deploy/ansible/playbook.yml` that performs the full build-and-deploy loop from the developer machine:

```yaml
---
- name: Build and verify clean static bundle locally, then deploy to VPS
  hosts: markbrain_vps
  gather_facts: true
  vars:
    app_dir: /srv/markbrain
    data_dir: /var/lib/markbrain
    config_dir: /etc/markbrain

  tasks:
    - name: 1. Run local production build + secret guard on dev machine
      delegate_to: localhost
      become: false
      command: npm run build
      args:
        chdir: "{{ playbook_dir }}/../.."

    - name: 2. Ensure required system packages exist on VPS (ffmpeg, sqlite3, rsync)
      apt:
        name:
          - ffmpeg
          - sqlite3
          - rsync
        state: present
        update_cache: true

    - name: 3. Ensure dedicated markbrain system user exists
      user:
        name: markbrain
        system: true
        shell: /usr/sbin/nologin
        home: "{{ data_dir }}"
        create_home: false

    - name: 4. Ensure application, data, and config directories exist
      file:
        path: "{{ item.path }}"
        state: directory
        owner: "{{ item.owner }}"
        group: "{{ item.group }}"
        mode: "{{ item.mode }}"
      loop:
        - { path: "{{ app_dir }}", owner: "markbrain", group: "markbrain", mode: "0755" }
        - { path: "{{ data_dir }}", owner: "markbrain", group: "markbrain", mode: "0700" }
        - { path: "{{ data_dir }}/tts-cache", owner: "markbrain", group: "markbrain", mode: "0700" }
        - { path: "{{ config_dir }}", owner: "root", group: "markbrain", mode: "0750" }

    - name: 5. Create /etc/markbrain/markbrain.env if missing
      copy:
        dest: "{{ config_dir }}/markbrain.env"
        owner: root
        group: markbrain
        mode: "0640"
        force: false
        content: |
          NODE_ENV=production
          PORT={{ markbrain_port }}
          MARKBRAIN_DB_PATH={{ data_dir }}/markbrain.sqlite
          MARKBRAIN_TTS_CACHE_DIR={{ data_dir }}/tts-cache
          MARKBRAIN_OWNER_EMAIL={{ markbrain_owner_email }}

    - name: 6. Sync dist/, server/, src/, scripts/, and package files to VPS
      synchronize:
        src: "{{ playbook_dir }}/../../"
        dest: "{{ app_dir }}/"
        delete: true
        rsync_opts:
          - "--include=/dist/***"
          - "--include=/server/***"
          - "--include=/src/***"
          - "--include=/scripts/***"
          - "--include=/package.json"
          - "--include=/package-lock.json"
          - "--include=/server.ts"
          - "--include=/tsconfig.json"
          - "--exclude=*"

    - name: 7. Install production Node dependencies on VPS
      command: npm ci
      args:
        chdir: "{{ app_dir }}"

    - name: 8. Seed Owner Account #1 if markbrain_owner_password was supplied
      when: markbrain_owner_password | length > 0
      command: >
        npx tsx scripts/user-admin.ts create {{ markbrain_owner_email }}
        --password {{ markbrain_owner_password | quote }} --owner
      args:
        chdir: "{{ app_dir }}"
      environment:
        MARKBRAIN_DB_PATH: "{{ data_dir }}/markbrain.sqlite"
      register: seed_owner
      failed_when: seed_owner.rc != 0 and ('already exists' not in seed_owner.stderr)
      no_log: true

    - name: 9. Fix ownership of application and SQLite files
      file:
        path: "{{ item }}"
        owner: markbrain
        group: markbrain
        recurse: true
      loop:
        - "{{ app_dir }}"
        - "{{ data_dir }}"

    - name: 10. Install systemd unit
      copy:
        src: "{{ playbook_dir }}/../markbrain.service"
        dest: /etc/systemd/system/markbrain.service
        owner: root
        group: root
        mode: "0644"
      notify: Restart markbrain

    - name: 11. Install Caddy site config
      copy:
        src: "{{ playbook_dir }}/../Caddyfile"
        dest: /etc/caddy/conf.d/markbrain.caddy
        owner: root
        group: root
        mode: "0644"
      notify: Reload caddy

    - name: 12. Ensure markbrain service is enabled and running
      systemd:
        name: markbrain
        daemon_reload: true
        enabled: true
        state: started

    - name: 13. Wait for health check on 127.0.0.1:{{ markbrain_port }}/api/health
      uri:
        url: "http://127.0.0.1:{{ markbrain_port }}/api/health"
        status_code: 200
      register: health_res
      retries: 10
      delay: 1
      until: health_res.status == 200

  handlers:
    - name: Restart markbrain
      systemd:
        name: markbrain
        daemon_reload: true
        state: restarted

    - name: Reload caddy
      systemd:
        name: caddy
        state: reloaded
```

*(Also add `deploy/ansible/inventory.ini` to `.gitignore` so personal host/password overrides are never committed; only `inventory.ini.example` is tracked.)*

---

## 4. Update Documentation (`INSTALL.md`, `SECURITY.md`, `README.md`)

1. **`INSTALL.md`:**
   - Replace all Firebase / Google Cloud / OAuth setup steps with:
     - **Local Development:** `npm install && npm run dev` (works immediately in Local Workspace mode with zero cloud accounts).
     - **VPS / Self-Hosted Mode:** How to bootstrap Account #1 (`npm run user -- create <email> --password <pw> --owner`) and deploy via `deploy/ansible/playbook.yml` + `deploy/Caddyfile`.
2. **`SECURITY.md`:**
   - Document the Two-Mode security boundary:
     - Mode 1 (Local Workspace): PBKDF2 (600,000 iterations) + AES-256-GCM passphrase vault in `localStorage`, decrypted strictly in browser RAM closure; direct browser-to-provider HTTPS calls; zero data sent to the hosting server.
     - Mode 2 (Connected VPS Workspace): `scrypt` password verification, `AES-256-GCM` encryption at rest in `user_secrets` SQLite table, unlocked `vaultKey` held strictly in server RAM during active session; unauthenticated `/api/*` requests rejected with `401`; Owner Account #1 (`id = 1`) cannot be disabled or deleted; build-time secret scanner (`scripts/verify-clean-dist.cjs`).
3. **`README.md`:**
   - Update architecture summary to describe the Two-Mode design (Local Workspace vs Connected VPS Server) and remove any mention of Firebase or Google Drive.

---

## 5. Phase 7 Verification Gate

```bash
npm run lint
npm test
npm run build
```

Commit Phase 7:
```bash
git add -A
git commit -m "Phase 7: Caddyfile, systemd service, Ansible deploy playbook for markbrain.unhaunter.com, and docs"
```
