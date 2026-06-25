# RBAC User Management

The pilot stores RBAC users in MariaDB through the isolated `mtm_ui_workspace_state` table. Existing MTM tables are not modified.

## Roles

| Role | App Visibility | App Launch | Workspace Persistence | User Management |
|---|---|---|---|---|
| admin | All apps | All apps | Read/write | Yes |
| power_user | All apps visible | Only apps subscribed by admin, and only when subscription is `active` | Read/write when active | No |
| guest | Minimum basic apps only | Minimum basic apps only | Read-only | No |

## Minimum Guest Services

Guests are limited to:

| App ID | App |
|---|---|
| `screener` | Screener |
| `watchlist` | Watchlist |
| `market-brief` | Market Brief |

## App Subscription Rule

Only administrators can enable app subscriptions for users. In the admin `Users` modal, use the app subscription multi-select to assign apps to power users.

Power users can see the full marketplace, but unsubscribed apps are locked and cannot be launched. Guests do not see premium marketplace apps.

## Subscription Status Rule

| subscriptionStatus | Power User Result |
|---|---|
| active | Can launch admin-subscribed apps and persist workspace state. |
| trial | Apps remain visible, but launch/write access is blocked in this pilot. |
| inactive | Apps remain visible, but launch/write access is blocked. |
| expired | Apps remain visible, but launch/write access is blocked. |

## Admin UI

When logged in as an administrator, the top bar shows a `Users` button. It opens a split-panel User Management modal: a user list and quick-create form on the left, and the selected user detail editor on the right. It supports:

- Creating users
- Assigning role: `admin`, `power_user`, `guest`
- Setting subscription status
- Enabling/disabling accounts
- Assigning app subscriptions through category-grouped checkboxes
- Resetting temporary passwords

New users are created with `mustChangePassword` enabled by default.

## Verification

| Test | Result |
|---|---:|
| Admin can list users | PASS |
| Admin owns all app subscriptions via `*` | PASS |
| Admin can assign app subscriptions to power user | PASS |
| Power user receives assigned app subscriptions | PASS |
| Active power user can write workspace state | PASS, HTTP 200 |
| Guest cannot open user API | PASS, HTTP 403 |
| Guest cannot write workspace state | PASS, HTTP 403 |
| Disabled test users cannot log in | PASS, HTTP 401 |

## Typography Pass

The UI font scale was tightened for a denser trading workspace:

- Base text: 13px
- Widget headers: 12.5px
- Main workspace heading: 20px
- Modal/auth headings: 18px
- Metrics: 18px

This keeps widget surfaces compact while preserving scan readability.

## UX Update

The User Management modal was redesigned from a dense row/table editor into a split-panel admin console:

| Surface | Purpose |
|---|---|
| Left pane | Add users quickly and select an existing user. |
| User list | Shows avatar initials, display name, username, and role badge. |
| Right pane | Edits profile, role, subscription, status, password reset, and app entitlements. |
| Entitlements | Apps are grouped by category and shown as checkboxes instead of a multi-select list. |

This reduces accidental edits and makes admin-controlled subscriptions easier to understand.
