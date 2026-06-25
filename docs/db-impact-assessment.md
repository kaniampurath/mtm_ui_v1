# DB Impact Assessment Report

Status: **No database changes implemented**

This pilot is isolated inside `mtm_ui` and uses an in-memory repository abstraction for dashboards and layouts. It does not create tables, alter tables, create indexes, run migrations, or modify authentication/authorization/session/profile behavior.

## Required Read-Only Discovery

The implementation requirement asks for read-only MariaDB discovery against schema/user `myts` before any DB-backed persistence is considered. No database credentials or connection details were present in this isolated folder, so discovery was not executed from this scaffold.

When credentials are available, run only read-only statements:

```sql
SHOW TABLES;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE();

SELECT
  table_name,
  column_name,
  data_type,
  column_key
FROM information_schema.columns
WHERE table_schema = DATABASE()
ORDER BY table_name, ordinal_position;
```

## Tables To Identify

- users
- profiles
- permissions
- roles
- settings
- dashboards
- layouts
- widgets
- sessions

## Persistence Proposal Only

If DB persistence is later approved, candidate tables could be proposed as:

- `mtm_dashboards`
- `mtm_dashboard_widgets`
- `mtm_capabilities`

No proposal should be executed without explicit approval.

## 2026-05-31 Read-Only Discovery Update

Read-only discovery completed against schema \\myts\\. Existing \\users\\ table found with columns \\id\\, \\profile_image\\, \\email\\, \\username\\, and \\password_hash\\. No dedicated roles, permissions, sessions, profile, dashboard, layout, or widget tables were found. No DB changes were executed.
