# Run MTM UI Pilot From Folder

Folder:

```text
C:\Users\kaniampurath\mytradingmind.ai\mtm_ui
```

## Windows

1. Open `run-mtm-ui.bat`.
2. Replace:
   - `CHANGE_ME_DB_PASSWORD`
   - default admin password is already set to `admin123`
3. Save the file.
4. Double-click `run-mtm-ui.bat`, or run:

```powershell
cd C:\Users\kaniampurath\mytradingmind.ai\mtm_ui
.\run-mtm-ui.bat
```

5. Open:

```text
http://127.0.0.1:4173/
```

## Ubuntu / macOS

1. Open `run-mtm-ui.sh`.
2. Replace:
   - `CHANGE_ME_DB_PASSWORD`
   - default admin password is already set to `admin123`
3. Save the file.
4. Run:

```bash
cd /path/to/mtm_ui
chmod +x ./run-mtm-ui.sh
./run-mtm-ui.sh
```

5. Open:

```text
http://127.0.0.1:4173/
```

## First Login

Use username:

```text
admin
```

Use the one-time admin password `admin123`. The app will force a password change before opening the workspace.

After changing the password, the one-time bootstrap password no longer works.

