-- =============================================
-- CashFlow Turso Schema (SQLite / libSQL)
-- Converted from Supabase PostgreSQL schema
-- =============================================

-- =============================================
-- Better Auth Tables (Required by Better Auth)
-- =============================================

CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
  updatedAt INTEGER NOT NULL DEFAULT (unixepoch()),
  displayName TEXT,
  photoUrl TEXT,
  avatarUrl TEXT,
  googleId TEXT
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  expiresAt INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
  updatedAt INTEGER NOT NULL DEFAULT (unixepoch()),
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope TEXT,
  password TEXT,
  createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
  updatedAt INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER DEFAULT (unixepoch()),
  updatedAt INTEGER DEFAULT (unixepoch())
);

-- Users & Sessions (Legacy Compatibility)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'User',
  display_name TEXT NOT NULL DEFAULT 'User',
  photo_url TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  google_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Profiles
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'User',
  display_name TEXT NOT NULL DEFAULT 'User',
  email TEXT NOT NULL DEFAULT '',
  photo_url TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  icon TEXT NOT NULL DEFAULT 'MoreHorizontal',
  color TEXT NOT NULL DEFAULT '#6b7280',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, id)
);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer', 'refund')),
  amount REAL NOT NULL CHECK (amount > 0),
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  merchant TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT 'cash',
  note TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'gmail')),
  gmail_message_id TEXT,
  confidence_score REAL,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Budgets
CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  used_amount REAL NOT NULL DEFAULT 0,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  status TEXT NOT NULL DEFAULT 'safe' CHECK (status IN ('safe', 'warning', 'overbudget')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, category_id, month, year)
);

-- Recurring Transactions
CREATE TABLE IF NOT EXISTS recurring_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer', 'refund')),
  amount REAL NOT NULL CHECK (amount > 0),
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  merchant TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT 'cash',
  note TEXT NOT NULL DEFAULT '',
  interval_type TEXT NOT NULL CHECK (interval_type IN ('daily', 'weekly', 'monthly', 'yearly')),
  interval_day INTEGER NOT NULL CHECK (interval_day BETWEEN 0 AND 31),
  start_date TEXT NOT NULL,
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_processed_date TEXT,
  next_due_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Gmail Sync Logs
CREATE TABLE IF NOT EXISTS gmail_sync_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT 'No Subject',
  sender TEXT NOT NULL DEFAULT '',
  sender_domain TEXT DEFAULT '',
  email_date TEXT,
  prefilter_status TEXT,
  ai_called INTEGER DEFAULT 0,
  ai_parsed INTEGER DEFAULT 0,
  final_status TEXT,
  error_message TEXT,
  extracted_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN (
    'pending_review','approved','rejected','auto_rejected','skipped',
    'duplicate','failed','retry_later','paused_config_error',
    'auto_accepted','auto_skipped','needs_review','config_error','gmail_permission_required'
  )),
  confidence_score REAL,
  sync_run_id TEXT,
  error_code TEXT,
  fallback_used INTEGER DEFAULT 0,
  extracted_note TEXT,
  metadata TEXT DEFAULT '{}',
  scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, message_id)
);

-- Gmail Sync Settings
CREATE TABLE IF NOT EXISTS gmail_sync_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auto_sync_enabled INTEGER NOT NULL DEFAULT 0,
  sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
  max_emails_per_sync INTEGER NOT NULL DEFAULT 25,
  auto_approve_threshold REAL NOT NULL DEFAULT 0.88,
  last_sync_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Gmail Sync Runs
CREATE TABLE IF NOT EXISTS gmail_sync_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  total_emails INTEGER DEFAULT 0,
  processed INTEGER DEFAULT 0,
  accepted INTEGER DEFAULT 0,
  rejected INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  error_message TEXT,
  metadata TEXT DEFAULT '{}'
);

-- Wallet Accounts
CREATE TABLE IF NOT EXISTS wallet_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cash', 'bank', 'e-wallet', 'credit', 'investment', 'other')),
  institution TEXT NOT NULL DEFAULT '',
  balance REAL NOT NULL DEFAULT 0 CHECK (balance >= 0),
  color TEXT NOT NULL DEFAULT '#8b5cf6',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Saving Goals
CREATE TABLE IF NOT EXISTS saving_goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_amount REAL NOT NULL CHECK (target_amount > 0),
  current_amount REAL NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
  target_date TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#10b981',
  status TEXT NOT NULL DEFAULT 'on-track' CHECK (status IN ('on-track', 'behind', 'completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  cycle TEXT NOT NULL CHECK (cycle IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  next_billing_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  action_label TEXT,
  action_href TEXT,
  dedupe_key TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, dedupe_key)
);

-- Admin Metrics
CREATE TABLE IF NOT EXISTS admin_metrics (
  id TEXT PRIMARY KEY,
  metric_key TEXT NOT NULL,
  metric_value TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =============================================
-- Monitoring & Observability (CF-053)
-- Migrasi dari Supabase migration 20260622000000_create_monitoring_tables.sql
-- =============================================

-- AI Usage Metrics (per AI call: token, cost estimasi, status)
CREATE TABLE IF NOT EXISTS ai_usage_metrics (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  feature TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  estimated_cost_idr REAL NOT NULL DEFAULT 0,
  execution_time_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_feature_created ON ai_usage_metrics(feature, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON ai_usage_metrics(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_metrics(created_at DESC);

-- System Metrics (event counters: gmail_sync_failed, agent_search_count, dst)
CREATE TABLE IF NOT EXISTS system_metrics (
  id TEXT PRIMARY KEY,
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL DEFAULT 1,
  feature TEXT,
  user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_system_metrics_name_created ON system_metrics(metric_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_metrics_feature_created ON system_metrics(feature, created_at DESC);

-- Alert Rules (threshold monitoring, seed default di bawah)
CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  metric_name TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('gt', 'lt', 'eq')),
  threshold REAL NOT NULL,
  window_minutes INTEGER NOT NULL DEFAULT 60,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_triggered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_active ON alert_rules(is_active) WHERE is_active = 1;

-- Seed default alert rules (idempotent via UNIQUE name). PK id di-set eksplisit
-- (SQLite TEXT PRIMARY KEY memperbolehkan NULL — baris seed tanpa id tak ter-address).
INSERT OR IGNORE INTO alert_rules (id, name, metric_name, condition, threshold, window_minutes)
VALUES
  ('alert_ai_cost_daily', 'ai_cost_daily', 'estimated_cost_idr', 'gt', 50000, 1440),
  ('alert_gmail_sync_failures', 'gmail_sync_failures', 'gmail_sync_failed', 'gt', 10, 10),
  ('alert_agent_search_error_rate', 'agent_search_error_rate', 'agent_search_error_rate', 'gt', 0.10, 60),
  ('alert_ocr_failure_rate', 'ocr_failure_rate', 'ocr_failure_rate', 'gt', 0.20, 60),
  -- Deteksi degradasi cache: alert bila hit rate LRU < 50% dalam 60 menit
  -- (tanpa aktivitas cache di window = sehat, tidak trigger — lihat computeCacheHitRate).
  -- Catatan semantik: hit rate = SUM(ai_cache_hit)/(SUM(ai_cache_hit)+SUM(ai_cache_miss)).
  -- JOIN single-flight ikut mencatat miss, dan window dengan mayoritas email BARU
  -- (first-scan pasca restart) wajar rendah — alert paling bermakna saat steady-state
  -- pemrosesan berulang (gmail sync / OCR berulang), bukan saat cold-cache.
  ('alert_cache_hit_rate', 'cache_hit_rate', 'cache_hit_rate', 'lt', 0.5, 60);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, transaction_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_amount ON transactions(user_id, date, amount);
CREATE INDEX IF NOT EXISTS idx_transactions_user_category ON transactions(user_id, category_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_source ON transactions(user_id, source);
CREATE INDEX IF NOT EXISTS idx_transactions_gmail_msg ON transactions(user_id, gmail_message_id);
CREATE INDEX IF NOT EXISTS idx_budgets_user_period ON budgets(user_id, year DESC, month DESC);
CREATE INDEX IF NOT EXISTS idx_categories_user_name ON categories(user_id, name);
CREATE INDEX IF NOT EXISTS idx_recurring_user_active ON recurring_transactions(user_id, active, next_due_date);
CREATE INDEX IF NOT EXISTS idx_gmail_logs_user_status ON gmail_sync_logs(user_id, status, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_gmail_logs_user_sync_run ON gmail_sync_logs(user_id, sync_run_id);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallet_accounts(user_id, archived, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_goals_user ON saving_goals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id, next_billing_date ASC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_runs_user ON gmail_sync_runs(user_id, started_at DESC);
