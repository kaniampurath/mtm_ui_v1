# Portable MTM UI Config

The pilot reads runtime settings from:

```text
config/mtm-ui.config.json
```

This file is OS-agnostic. It does not contain Windows paths, Ubuntu paths, or plaintext passwords.

## Config

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 4173
  },
  "database": {
    "client": "mysql",
    "name": "myts",
    "user": "tradeuser",
    "ssl": false,
    "stateTable": "mtm_ui_workspace_state"
  },
  "auth": {
    "adminUsername": "admin",
    "defaultAdminPasswordEnv": "MTM_DEFAULT_ADMIN_PASSWORD",
    "forcePasswordChangeOnFirstLogin": true,
    "minPasswordLength": 10
  }
}
```

## Bootstrap Admin Flow

The config names the environment variable that supplies the bootstrap password. The password itself is not stored in the config file.

On first successful login:

1. The server creates an admin auth record in `mtm_ui_workspace_state` under `__system__ / admin_auth`.
2. Only a salted password hash is stored in MariaDB.
3. The UI forces a password change before the workspace opens.
4. After the change, the bootstrap password no longer works.

## Launch

Install MariaDB/MySQL client so `mysql` is available on `PATH`.

Windows PowerShell:

```powershell
mysql --version
$env:MTM_DB_PASSWORD='<db password from password manager>'
$env:MTM_DEFAULT_ADMIN_PASSWORD='<one-time bootstrap admin password>'
npm start
```

Ubuntu shell:

```bash
mysql --version
export MTM_DB_PASSWORD='<db password from password manager>'
export MTM_DEFAULT_ADMIN_PASSWORD='<one-time bootstrap admin password>'
npm start
```

## Overrides

Environment variables override the config file:

| Variable | Purpose |
|---|---|
| `PORT` | Server port |
| `HOST` | Server host |
| `MTM_UI_CONFIG` | Alternate config file path |
| `MTM_DB_USER` | DB user |
| `MTM_DB_NAME` | DB schema/database |
| `MTM_DB_PASSWORD` | DB password |
| `MTM_MYSQL_CLIENT` | MySQL/MariaDB client command if not `mysql` |
| `MTM_DB_SSL` | `true` or `false` |
| `MTM_DB_STATE_TABLE` | Pilot state table name |
| `MTM_ADMIN_USERNAME` | Bootstrap/admin username override |
| `MTM_DEFAULT_ADMIN_PASSWORD` | One-time bootstrap password |

Do not store plaintext passwords in config, code, docs, or launch scripts.
