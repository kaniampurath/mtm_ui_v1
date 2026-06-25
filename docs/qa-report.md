# MTM UI Pilot QA Report

Date: 2026-05-31
Target: http://127.0.0.1:4173/
Scope: isolated `mtm_ui` pilot only.

## Latest DB-Only Persistence Result

| Area | Test | Result | Evidence |
|---|---|---:|---|
| Persistence | Storage backend | PASS | State now persists only in MariaDB table `mtm_ui_workspace_state`. |
| Persistence | Existing tables untouched | PASS | No existing table was altered. One isolated pilot table was created. |
| Recovery | Dashboard reload recovery | PASS | Widget count changed to 8 and recovered as 8 after reload. |
| Recovery | Profile/layout DB rows | PASS | DB rows present for `dashboard`, `layout`, and `profile`. |
| Technical | File-state dependency removed | PASS | Old `data/pilot-state.json` removed; server no longer reads/writes it. |

DB verification:

| state_name | JSON length | Updated |
|---|---:|---|
| dashboard | 1153 | 2026-05-31 16:51:45 |
| layout | 575 | 2026-05-31 16:51:46 |
| profile | 177 | 2026-05-31 16:51:46 |

## Full Test Results

| Area | Test | Result | Evidence |
|---|---|---:|---|
| Functional | Initial dashboard loads | PASS | 6 pilot widgets load on clean launch. |
| Functional | Core pilot widgets present | PASS | Screener, Heat Map, Market Brief, Industry Ranks, Market Breadth, Stage Analysis. |
| Functional | Add Apps drawer opens | PASS | Drawer opened from top-bar Add Apps button. |
| Functional | Dynamic widget add | PASS | Added Chart widget and recovered it after reload. |
| Functional | Marketplace filter | PASS | Agent filter returned 5 agent capabilities. |
| Functional | Context/link sync | PASS | Selecting AVGO in Screener updated Heat Map selected symbol to AVGO. |
| Profile | User preference persistence | PASS | Profile row persisted in MariaDB. |
| Boundary | Max widget limit | PASS | Stress run reached 20 widgets and reload preserved 20. |
| Recovery | Dashboard crash/reload recovery | PASS | Dashboard restored from MariaDB after browser reload. |
| Recovery | Profile crash/reload recovery | PASS | Saved profile restored from MariaDB after reload. |
| Performance | DOM size | PASS | 527 DOM nodes after stress path, below 1,500 budget. |
| Performance | Theme click interaction | WARN | Browser-driven average measured about 427 ms; optimize before production. |
| Technical | Browser console | PASS | 0 app warnings/errors captured in final pass. |

## DB Objects

Created isolated pilot table:

```sql
CREATE TABLE IF NOT EXISTS mtm_ui_workspace_state (
  user_id VARCHAR(128) NOT NULL,
  state_name VARCHAR(64) NOT NULL,
  state_json LONGTEXT NOT NULL CHECK (JSON_VALID(state_json)),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, state_name)
);
```

Existing MTM tables were not altered.

## Independent Launch Notes

Run from the isolated pilot folder with DB credentials in environment variables:

```powershell
cd C:\Users\kaniampurath\mytradingmind.ai\mtm_ui
$env:MTM_DB_USER='tradeuser'
$env:MTM_DB_NAME='myts'
$env:MTM_DB_PASSWORD='<password from password manager>'
npm start
```

Then open:

```text
http://127.0.0.1:4173/
```

## Admin Password Sharing Approach

Do not hard-code or commit admin/database passwords. For independent launch:

| Need | Recommended Approach |
|---|---|
| Local launch | Set `MTM_DB_PASSWORD` as an environment variable before `npm start`. |
| Sharing credentials | Use a password manager or secure one-time secret link. |
| Code/docs | Never store plaintext passwords in repo files, reports, or launch scripts. |
| DB access | Use least-privileged runtime credentials for the pilot table. |
| Rotation | Rotate after sharing or first bootstrap. |
