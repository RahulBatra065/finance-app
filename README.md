# Finance App

A self-hosted personal finance web app for tracking expenses and investments, designed to run on a Mac Mini and accessed over Tailscale.

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python 3.11+) |
| Frontend | React 18 + Vite |
| Database | SQLite via SQLAlchemy |
| AI | Anthropic Claude (`claude-sonnet-4-20250514`) |
| Scheduler | APScheduler |
| File storage | Local filesystem |
| Auth | JWT (python-jose) |

---

## First-Run Setup

### 1. Install system dependencies

```bash
# macOS — poppler is required by pdf2image to render PDF pages
brew install poppler
```

### 2. Set up the Python backend

```bash
cd /Users/rahulbatra/Desktop/finance-app/backend

# Create a virtual environment
python3 -m venv venv
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in every value:

| Variable | Description |
|---|---|
| `ADMIN_USERNAME` | Login username for the dashboard |
| `ADMIN_PASSWORD` | Login password for the dashboard |
| `JWT_SECRET` | Long random string — used to sign tokens. Generate with: `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `JWT_EXPIRY_DAYS` | How long login sessions last (default: 7) |
| `WEBHOOK_SECRET` | Secret token for the iPhone Shortcut webhook. Generate with: `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `ANTHROPIC_API_KEY` | Your Anthropic API key (`sk-ant-...`) |
| `STORAGE_PATH` | Where invoice files are stored (default: `~/finance-app/storage`) |
| `DATABASE_URL` | SQLite path (default: `sqlite:///./finance.db`) |

### 4. Build the React frontend

```bash
cd /Users/rahulbatra/Desktop/finance-app/frontend
npm install
npm run build
# Outputs to frontend/dist/ — FastAPI serves it automatically
```

### 5. Start the server

```bash
cd /Users/rahulbatra/Desktop/finance-app/backend
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000` in your browser. On first run the Setup Wizard will guide you through creating categories, vendor mappings, and your webhook secret.

---

## Auto-start with launchd (macOS)

The `com.financeapp.plist` file in the project root is a launchd agent that starts the app at login and restarts it if it crashes.

### Install

```bash
# 1. Create the log directory
mkdir -p ~/finance-app/logs

# 2. Copy the plist to the LaunchAgents folder
cp /Users/rahulbatra/Desktop/finance-app/com.financeapp.plist \
   ~/Library/LaunchAgents/com.financeapp.plist

# 3. Load it (starts immediately and on every login)
launchctl load ~/Library/LaunchAgents/com.financeapp.plist
```

### Verify it is running

```bash
launchctl list | grep financeapp
# Should show a PID (non-zero = running)
```

### View logs

```bash
tail -f ~/finance-app/logs/uvicorn.log
tail -f ~/finance-app/logs/uvicorn-error.log
tail -f ~/finance-app/logs/scheduler.log
tail -f ~/finance-app/logs/cleanup.log
```

### Stop / unload

```bash
launchctl unload ~/Library/LaunchAgents/com.financeapp.plist
```

---

## Accessing over Tailscale

1. Install Tailscale on your Mac Mini and your iPhone.
2. Find your Mac Mini's Tailscale IP: `tailscale ip -4` (looks like `100.x.x.x`).
3. Access the app at `http://100.x.x.x:8000` from any device on your Tailnet.

---

## iPhone Shortcut — Webhook Upload

The `/webhook/upload` endpoint accepts files or UPI SMS text without requiring a login token. It is secured instead by a shared secret in the `X-Webhook-Secret` header.

### Create the Shortcut

1. Open the **Shortcuts** app on iPhone.
2. Tap **+** to create a new Shortcut.
3. Add the action **"Receive"** input — set it to accept **Images, PDFs, and Text**.
4. Add the action **"Get Contents of URL"**:
   - **URL**: `http://<TAILSCALE_IP>:8000/webhook/upload`
   - **Method**: `POST`
   - **Headers**: Add `X-Webhook-Secret` → paste your `WEBHOOK_SECRET` value from `.env`
   - **Request Body**: `Form`
     - Add field **`file`** → set value to **Shortcut Input** (for images/PDFs)
     - — OR —
     - Add field **`text`** → set value to **Shortcut Input** (for SMS text)
5. Add an **"If"** action: check if `Contents of URL` → `budget_warning` → `is` → `true`
   - If true: add **"Show Notification"** → "Budget alert! Check the Finance app."
6. Name the Shortcut **"Log Expense"** and add it to the Share Sheet.

### Usage

- **UPI SMS**: Copy the SMS text → tap Share → "Log Expense"
- **Invoice / receipt photo**: Open the photo → Share → "Log Expense"
- **Invoice PDF**: Open the PDF → Share → "Log Expense"

---

## Background Jobs

| Job | Schedule | Log |
|---|---|---|
| Investment price refresh | Every 4 hours | `~/finance-app/logs/scheduler.log` |
| Old file cleanup (>12 months) | Daily at 2:00 AM | `~/finance-app/logs/cleanup.log` |

---

## API Documentation

Interactive Swagger UI is available at `http://localhost:8000/api/docs` when running in development.

---

## Project Structure

```
finance-app/
├── backend/
│   ├── main.py                  # FastAPI app + startup
│   ├── models.py                # SQLAlchemy models
│   ├── database.py              # Engine + session
│   ├── requirements.txt
│   ├── .env.example
│   ├── routers/
│   │   ├── auth.py              # POST /auth/login, GET /auth/verify
│   │   ├── webhook.py           # POST /webhook/upload  (unauthenticated)
│   │   ├── expenses.py          # Transactions, categories, dashboard, analytics
│   │   ├── investments.py       # Holdings, portfolio dashboard, price refresh
│   │   └── setup.py             # Setup wizard endpoints
│   └── services/
│       ├── ai_extraction.py     # Claude API calls
│       ├── compression.py       # Pillow + pypdf compression
│       ├── price_fetcher.py     # mfapi.in + yfinance
│       └── scheduler.py         # APScheduler jobs
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── api.js               # Axios client with JWT interceptor
│   │   ├── index.css            # Design tokens + utility classes
│   │   ├── components/
│   │   │   └── Layout.jsx       # Sidebar + header
│   │   └── pages/
│   │       ├── Login.jsx
│   │       ├── Setup.jsx        # First-run wizard
│   │       ├── Dashboard.jsx    # Expense overview + charts
│   │       ├── Investments.jsx  # Portfolio tracker
│   │       ├── Transactions.jsx # Transaction log + filters
│   │       └── Settings.jsx     # Categories + vendor mappings
│   ├── package.json
│   └── vite.config.js
├── com.financeapp.plist         # launchd agent
└── README.md
```
