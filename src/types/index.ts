// ===================== USER =====================
export interface User {
  id: string;
  name: string;
  email: string;
  photoUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppUser {
  uid: string;
  id: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

// ===================== TRANSACTION =====================
export type TransactionType = 'income' | 'expense' | 'transfer' | 'refund';
export type TransactionSource = 'manual' | 'gmail' | 'fallback' | 'ai' | 'import';
export type PaymentMethod = 'cash' | 'transfer-bank' | 'qris' | 'e-wallet' | 'kartu-debit' | 'kartu-kredit' | 'lainnya-payment';

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  categoryId: string;
  categoryName: string;
  merchant: string;
  paymentMethod: PaymentMethod;
  note: string;
  date: string;
  source: TransactionSource;
  gmailMessageId?: string;
  confidenceScore?: number;
  metadata?: Record<string, unknown>;
  /** P2.6+: akun ledger yang menautkan transaksi (NULL = belum ditautkan). */
  accountId?: string | null;
  /** Fraud flag hasil L1 rule engine: 'flagged' (advisory) | 'review' (high/critical) | null */
  fraudFlag?: 'flagged' | 'review' | 'blocked' | null;
  /** Skor risiko 0..1 (L1 deterministik, atau L2 AI bila aktif) */
  fraudScore?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// ===================== FRAUD DETECTION =====================
export type FraudFlagType =
  | 'duplicate'
  | 'velocity'
  | 'amount_outlier'
  | 'new_merchant'
  | 'category_anomaly';

export type FraudSeverity = 'low' | 'medium' | 'high' | 'critical';
export type FraudDecision = 'allow' | 'review' | 'block';
export type FraudFlagStatus = 'open' | 'reviewed' | 'dismissed';

export interface FraudFlag {
  id: string;
  userId: string;
  transactionId?: string;
  flagType: FraudFlagType;
  severity: FraudSeverity;
  description: string;
  ruleData?: Record<string, unknown>;
  riskScore?: number;
  decision?: FraudDecision;
  status: FraudFlagStatus;
  createdAt: string;
  /** Field join ringan dari transaksi (opsional) */
  merchant?: string;
  amount?: number;
  date?: string;
  transactionType?: string;
}

export interface FraudSummary {
  openCount: number;
  totalCount: number;
  bySeverity: Record<FraudSeverity, number>;
  recent: FraudFlag[];
}

export interface TransactionFormData {
  type: TransactionType;
  amount: number;
  categoryId: string;
  categoryName: string;
  merchant: string;
  paymentMethod: PaymentMethod;
  note: string;
  date: string;
  metadata?: Record<string, unknown>;
}

// ===================== CATEGORY =====================
export interface Category {
  id: string;
  userId: string;
  name: string;
  type: 'income' | 'expense';
  icon: string;
  color: string;
  isDefault: boolean;
  createdAt: Date;
}

export interface CategoryFormData {
  name: string;
  type: 'income' | 'expense';
  icon: string;
  color: string;
}

// ===================== BUDGET =====================
export type BudgetStatus = 'safe' | 'warning' | 'overbudget';

export interface Budget {
  id: string;
  userId: string;
  categoryId: string;
  categoryName: string;
  amount: number;
  usedAmount: number;
  month: number;
  year: number;
  status: BudgetStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetFormData {
  categoryId: string;
  categoryName: string;
  amount: number;
  month: number;
  year: number;
}

// ===================== GMAIL SYNC =====================
/**
 * Status untuk setiap email dalam pipeline Gmail Sync.
 *
 * AUTO-FIRST, REVIEW-BY-EXCEPTION (new flow):
 * - auto_accepted:   Transaksi sangat yakin valid → langsung masuk transactions (confidence >= 0.88, validator lulus)
 * - auto_skipped:    Email dari sumber finansial terpercaya tapi bukan transaksi aktual
 * - auto_rejected:   Email jelas promo/newsletter/non-keuangan
 * - needs_review:    Email ambigu yang perlu dicek user (confidence 0.60-0.87, atau ada konflik AI/fallback)
 *
 * LEGACY/TRANSITION (manual flow):
 * - pending_review:  Transaksi valid, menunggu konfirmasi user (legacy, akan digantikan needs_review)
 * - approved:        User menyetujui, transaksi sudah disimpan
 * - rejected:        User menolak transaksi
 *
 * ERROR STATUSES:
 * - duplicate:       Email sudah pernah diproses sebelumnya
 * - retry_later:     Error sementara, aman untuk dicoba ulang
 * - config_error:    Konfigurasi manual perlu diperbaiki
 * - failed:          Bug teknis nyata (API gagal, fallback juga gagal)
 * - gmail_permission_required: User perlu reconnect Gmail
 */
export type SyncEmailStatus =
  | 'auto_accepted'
  | 'auto_skipped'
  | 'auto_rejected'
  | 'needs_review'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'skipped'
  | 'duplicate'
  | 'failed'
  | 'retry_later'
  | 'config_error'
  | 'gmail_permission_required'
  | 'paused_config_error';

export type GmailSyncStatus = SyncEmailStatus;

export interface GmailSyncLog {
  id: string;
  userId: string;
  messageId: string;
  subject: string;
  sender: string;
  senderDomain?: string;
  emailDate?: string;
  prefilterStatus?: string;
  aiCalled?: boolean;
  aiParsed?: boolean;
  finalStatus?: GmailSyncStatus;
  errorMessage?: string;
  extractedTransactionId?: string;
  status: GmailSyncStatus;
  confidenceScore?: number;
  syncRunId?: string;
  errorCode?: string;
  fallbackUsed?: boolean;
  extractedNote?: string;
  metadata?: Record<string, unknown>;
  scannedAt: Date;
}

// ===================== AUTO-DECISION TYPES =====================

/**
 * Final decision dari sistem auto-first
 */
export type AutoDecision = 'auto_accept' | 'auto_skip' | 'auto_reject' | 'needs_review';

/**
 * Risiko/flags yang terdeteksi pada email
 */
export interface RiskFlags {
  promoDetected: boolean;
  cashbackPromo: boolean;
  cardActivation: boolean;
  welcomeEmail: boolean;
  newsletter: boolean;
  multipleAmounts: boolean;
  conflictingAIandFallback: boolean;
  unknownSender: boolean;
  amountTooHigh: boolean;
  noAmount: boolean;
  onlyFallbackLowConfidence: boolean;
}

/**
 * Confidence score breakdown
 */
export interface ConfidenceBreakdown {
  total: number;
  components: {
    trustedSender: number;
    transactionKeyword: number;
    amountPresent: number;
    datePresent: number;
    merchantPaymentMethod: number;
    aiValidJson: number;
    fallbackKnownPattern: number;
    promoPenalty: number;
    cashbackMaxPenalty: number;
    noAmountPenalty: number;
    unknownSenderPenalty: number;
  };
  riskFlags: RiskFlags;
}

/**
 * Debug info untuk development mode
 */
export interface SyncEmailDebug {
  gmailMessageId: string;
  senderDomain: string;
  subjectClassification: string;
  prefilterDecision: string;
  aiCalled: boolean;
  aiParsedSuccessful: boolean;
  extractedAmount: number | null;
  extractedMerchant: string | null;
  confidenceScore: number | null;
  finalStatus: string;
  errorDetail: string | null;
  /** Error code from Gemini API (e.g., GEMINI_API_DISABLED, GEMINI_REFERER_BLOCKED) */
  aiErrorCode?: string;
  /** Cleaned response text after sanitization */
  cleanedResponse?: string;
  /** Raw response from AI before any cleaning */
  rawResponse?: string;
  /** Whether a fallback regex parser was used */
  fallbackUsed?: boolean;
  /** Retry count for rate-limited emails */
  retryCount?: number;
  /** Which Gemini model was used (e.g., gemini-2.5-flash) */
  modelUsed?: string;
  /** Domain-specific skip reason, e.g. promo_cashback */
  skipReason?: string;
  /** Classification rule that matched the email */
  matchedRule?: string;
  /** Promo amount found but intentionally ignored */
  detectedPromoAmount?: number | null;
  /** Whether a detected amount was ignored because it is not transactional */
  amountIgnored?: boolean;
}

// ===================== EXTRACTED TRANSACTION =====================
// ===================== RECEIPT SCAN =====================
export interface ReceiptScanResult {
  decision: 'auto_accept' | 'needs_review' | 'auto_skip';
  is_transaction: boolean;
  transaction_type: TransactionType | null;
  amount: number | null;
  currency: string;
  date: string | null;
  merchant: string | null;
  category: string | null;
  payment_method: string | null;
  note: string | null;
  confidence_score: number;
  reason: string | null;
  risk_flags: string[];
}

export interface ExtractedTransaction {
  is_transaction: boolean;
  transaction_type?: TransactionType;
  amount?: number;
  currency?: string;
  date?: string;
  merchant?: string;
  category?: string;
  payment_method?: string;
  description?: string;
  /** Catatan transaksi yang jelas — menjelaskan transaksi untuk apa */
  note?: string;
  confidence_score?: number;
  reason?: string;
}

// ===================== FINANCIAL SUMMARY (windowless, server-side) =====================
export interface FinancialTotals {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  count: number;
}

export interface MonthlyCategoryTotal {
  categoryId: string;
  categoryName: string;
  total: number;
}

export interface TransactionSummary {
  month: number;
  year: number;
  lifetime: FinancialTotals;
  monthly: FinancialTotals;
  monthlyByCategory: MonthlyCategoryTotal[];
  /** P2.5 account-based ledger (append-only; null bila server lama/gagal). */
  ledger?: LedgerSummary | null;
  /** P2.6 reconciliation summary ringan (counts + status; null bila gagal). */
  reconciliation?: ReconciliationSummary | null;
}

// ===================== RECONCILIATION (P2.6) =====================
export type ReconciliationStatus = 'unknown' | 'partial' | 'reconciled' | 'verified';
export type BalanceConfidence = 'unknown' | 'low' | 'medium' | 'high' | 'verified';
export type SuggestionConfidence = 'high' | 'medium' | 'low';
export type AccountVerificationStatus = 'not_verified' | 'verified' | 'mismatch';

export interface ReconciliationSummary {
  accounts: number;
  openingBalancesConfigured: number;
  /** P2.7: jumlah akun dengan balance anchor terverifikasi. */
  anchoredAccounts: number;
  transactions: {
    total: number;
    classified: number;
    unclassified: number;
    unclassifiedAmount: number;
  };
  transfers: {
    total: number;
    resolved: number;
    unresolved: number;
    /** P2.9: transfer yang user tolak (transfer_review_status='rejected'). */
    rejected: number;
  };
  dateCoverage: { earliest: string | null; latest: string | null };
  status: ReconciliationStatus;
  balanceConfidence: BalanceConfidence;
}

export interface ReconciliationAccount {
  id: string;
  name: string;
  type: string;
  currency: string;
  openingBalance: number | null;
  openingBalanceDate: string | null;
  realBalance: number | null;
  realBalanceDate: string | null;
  realBalanceVerifiedAt: string | null;
  balanceAnchorStatus: string | null;
  systemBalance: number | null;
  verificationStatus: AccountVerificationStatus;
}

export interface AccountSuggestionGroup {
  accountName: string | null;
  accountId: string | null;
  confidence: SuggestionConfidence;
  count: number;
  totalAmount: number;
}

export interface TransferPairCandidate {
  transferId: string;
  incomeId: string;
  transferDate: string;
  incomeDate: string;
  amount: number;
  merchant: string | null;
  confidence: SuggestionConfidence;
  reason: string;
}

export interface ReconciliationState {
  status: ReconciliationStatus;
  accounts: ReconciliationAccount[];
  /** P2.8: kandidat aktivasi akun (own_accounts yang belum dibuat sebagai
   *  rekening) — UI merender CTA "Tambahkan Rekening" per kandidat. */
  accountCandidates: string[];
  openingBalancesConfigured: number;
  /** P2.7: jumlah akun dengan balance anchor. */
  anchoredAccounts: number;
  transactions: {
    total: number;
    linked: number;
    unlinked: number;
    unlinkedAmount: number;
    pending: number;
    confirmed: number;
    rejected: number;
  };
  transfers: {
    total: number;
    grouped: number;
    ungrouped: number;
    /** P2.9: transfer yang user tolak. */
    rejected: number;
  };
  transferPairSuggestions: TransferPairCandidate[];
  suggestions: AccountSuggestionGroup[];
  /** P2.9 §12: transaksi LOW (tanpa sinyal akun) untuk bulk-assign manual. */
  /** P3.0 §12: `type` dipakai filter UI All/Income/Expense/Refund pada checklist LOW. */
  unassignedTransactions: Array<{ id: string; merchant: string; amount: number; date: string; type: string }>;
  /** P3.1 §20/§21: daftar transaksi tertaut (confirmed) untuk section "Perbaiki penautan" (reassign eksplisit). */
  linkedTransactions: Array<{ id: string; merchant: string; amount: number; date: string; type: string; accountId: string; accountName: string }>;
  /** P2.9 §28: completion score deterministik + rincian. */
  completionScore: {
    score: number;
    accounts: { activated: number; detected: number };
    anchors: { anchored: number; total: number };
    transactions: { linked: number; total: number };
    transfers: { resolved: number; total: number };
  };
  dateCoverage: { earliest: string | null; latest: string | null };
  currentBalance: CurrentBalance;
  balanceConfidence: BalanceConfidence;
  onboardingProgress: {
    accountsConfigured: boolean;
    openingBalancesConfigured: boolean;
    transactionsReconciled: boolean;
    transfersReconciled: boolean;
    realBalanceVerified: boolean;
    completedSteps: number;
    totalSteps: number;
  };
}

// ===================== LEDGER (P2.5 account-based balance) =====================
/**
 * Status saldo saat ini — jujur terhadap kelengkapan data.
 * P2.5: known | partial | unknown (opening-based).
 * P2.7: + verified (semua akun ber-anchor) | stale (aktivitas post-anchor
 * belum terselesaikan) | mismatch (anchor tidak cocok sistem saat verifikasi).
 */
export type CurrentBalanceStatus = 'known' | 'partial' | 'unknown' | 'verified' | 'stale' | 'mismatch';

export interface AccountLedgerMovement {
  inflow: number;
  expense: number;
  incomingTransfer: number;
  outgoingTransfer: number;
  internalTransferPair: number;
  unresolvedTransfer: number;
  count: number;
}

export interface AccountLedger {
  id: string;
  name: string;
  type: string;
  currency: string;
  openingBalance: number | null;
  openingBalanceDate: string | null;
  /** P2.7: verified balance anchor (snapshot saldo aktual user). */
  anchor: { amount: number; date: string; verifiedAt: string | null } | null;
  verificationStatus: 'verified' | 'mismatch' | 'not_verified';
  movements: AccountLedgerMovement;
  closingBalance: number | null;
  status: CurrentBalanceStatus;
}

export interface CurrentBalance {
  status: CurrentBalanceStatus;
  amount: number | null;
  reason: string | null;
  message: string;
  /** P2.7: tanggal anchor terbaru (saldo aktual terverifikasi). */
  anchorDate?: string | null;
}

export interface LedgerSummary {
  currentBalance: CurrentBalance;
  accounts: AccountLedger[];
  unclassified: { count: number; amount: number };
  netCashFlow: { amount: number; totalIncome: number; totalExpense: number };
  reconciliationStatus: 'balanced' | 'warning' | 'unknown';
}

// ===================== DASHBOARD =====================
export interface DashboardSummary {
  totalBalance: number;
  totalIncome: number;
  totalExpense: number;
  remainingBudget: number;
  recentTransactions: Transaction[];
  incomeChange: number;
  expenseChange: number;
}

// ===================== FILTERS =====================
export interface TransactionFilters {
  search: string;
  type: TransactionType | 'all';
  categoryId: string;
  paymentMethod: string;
  source: TransactionSource | 'all';
  startDate: string;
  endDate: string;
  sortBy: 'date' | 'amount' | 'merchant';
  sortOrder: 'asc' | 'desc';
}

// ===================== REPORT =====================
export interface ReportData {
  totalIncome: number;
  totalExpense: number;
  netCashflow: number;
  categorySummary: CategorySummaryItem[];
  merchantSummary: MerchantSummaryItem[];
  dailyCashflow: DailyCashflowItem[];
}

export interface CategorySummaryItem {
  categoryId: string;
  categoryName: string;
  total: number;
  percentage: number;
  color: string;
}

export interface MerchantSummaryItem {
  merchant: string;
  total: number;
  count: number;
}

export interface DailyCashflowItem {
  date: string;
  income: number;
  expense: number;
}

// ===================== AI INTELLIGENCE =====================
export type FinancialHealth = 'sehat' | 'stabil' | 'waspada' | 'kritis';

export interface MonthlyFinancialReport {
  summary: string;
  cashflowHealth: FinancialHealth;
  /** Skor kesehatan finansial 0–100 (Sprint 1.2 — deterministik fallback, AI optional) */
  financialHealthScore?: number;
  /** Peluang hemat yang bisa dieksekusi (Sprint 1.2) */
  savingOpportunities?: string[];
  /** Pengeluaran tidak biasa yang perlu ditinjau (Sprint 1.2) */
  unusualSpending?: string[];
  topRisks: string[];
  recommendations: string[];
  positiveNotes: string[];
  generatedBy: 'gemini' | 'rule-based';
  generatedAt: string;
}

export interface BudgetRecommendation {
  categoryId: string;
  categoryName: string;
  averageLastThreeMonths: number;
  currentBudget: number;
  suggestedBudget: number;
  difference: number;
  confidence: 'high' | 'medium' | 'low';
  action: 'create' | 'increase' | 'decrease' | 'keep';
  reason: string;
  existingBudgetId?: string;
}

export interface SpendingForecast {
  month: number;
  year: number;
  currentExpense: number;
  projectedExpense: number;
  averageDailyExpense: number;
  remainingDays: number;
  trendPercentage: number;
  status: 'under-control' | 'watch' | 'high-risk';
  narrative: string;
}

// ===================== PROFESSIONAL SUITE =====================
export type WalletAccountType = 'cash' | 'bank' | 'e-wallet' | 'credit' | 'investment' | 'other';

export interface WalletAccount {
  id: string;
  userId: string;
  name: string;
  type: WalletAccountType;
  institution: string;
  balance: number;
  color: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  /** P2.5 account-based ledger: saldo awal per akun (nullable = belum diisi). */
  openingBalance: number | null;
  /** Tanggal saldo awal (semantik: balance pada START-of-day tanggal tsb). */
  openingBalanceDate: string | null;
  currency: string;
  /** P2.7 verified balance anchor (saldo aktual terverifikasi; opsional —
   *  diisi server lewat /api/reconciliation/verify-balance). */
  realBalance?: number | null;
  realBalanceDate?: string | null;
  realBalanceVerifiedAt?: string | null;
  /** P2.7: outcome verifikasi yang disimpan ('verified' | 'mismatch' | null). */
  balanceAnchorStatus?: string | null;
  /** P0.11/P0.12: kode provider dari katalog (server-derived; match institution/name bila belum terpasang). */
  providerCode?: string | null;
}

export interface WalletAccountFormData {
  name: string;
  type: WalletAccountType;
  institution: string;
  balance: number;
  color: string;
  openingBalance?: number | null;
  openingBalanceDate?: string | null;
  currency?: string;
  /** P2.9 §41: tandai sebagai aktivasi kandidat — POST idempoten (nama sama → id existing). */
  activation?: boolean;
  /** P0.11 — kode provider dari katalog (mis. 'line_bank'); dipakai onboarding. */
  providerCode?: string | null;
}

export type SavingGoalStatus = 'on-track' | 'behind' | 'completed';

export interface SavingGoal {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string;
  color: string;
  status: SavingGoalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SavingGoalFormData {
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string;
  color: string;
}

export type SubscriptionCycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled';

export interface Subscription {
  id: string;
  userId: string;
  name: string;
  amount: number;
  cycle: SubscriptionCycle;
  categoryId: string;
  categoryName: string;
  nextBillingDate: string;
  status: SubscriptionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionFormData {
  name: string;
  amount: number;
  cycle: SubscriptionCycle;
  categoryId: string;
  categoryName: string;
  nextBillingDate: string;
  status: SubscriptionStatus;
}

// ===================== FINANCIAL ADVISOR (Sprint 1.3) =====================
export type AdvisorPriority = 'high' | 'medium' | 'low';

export interface AdvisorActionItem {
  priority: AdvisorPriority;
  action: string;
}

export interface AdvisorEmergencyFund {
  suggestion: string;
  /** Estimasi bulan tertutup bila saldo saat ini jadi dana darurat */
  monthsCoverage: number;
  /** Target dana darurat (≈ 6× pengeluaran rata-rata bulanan) */
  targetAmount: number;
  /** Saldo terkumpul saat ini (total wallet) */
  currentAmount: number;
}

export interface AdvisorReport {
  summary: string;
  spendingAdvice: string[];
  savingStrategy: string[];
  budgetStrategy: string[];
  emergencyFund: AdvisorEmergencyFund;
  subscriptionOptimization: string[];
  actionList: AdvisorActionItem[];
  generatedBy: 'gemini' | 'rule-based';
  generatedAt: string;
}

export interface AdvisorMetricsInput {
  month: number;
  year: number;
  currentMonthIncome: number;
  currentMonthExpense: number;
  avgMonthlyIncome3m: number;
  avgMonthlyExpense3m: number;
  /** Pengeluaran ÷ pemasukan (0..1+; >1 = defisit) */
  expenseRatio: number;
  /** (Pemasukan − Pengeluaran) ÷ Pemasukan, di-clamp 0..1 */
  savingsRate: number;
  totalBalance: number;
  transactionCount: number;
  topCategory: { categoryId: string; categoryName: string; total: number } | null;
  topMerchant: { merchant: string; total: number; count: number } | null;
  budgetUsage: Array<{ categoryId: string; categoryName: string; amount: number; usedAmount: number; usage: number }>;
  subscriptions: Array<{ name: string; monthlyCost: number; cycle: string }>;
  goals: { totalTarget: number; totalCurrent: number };
  forecastProjectedExpense: number;
}

export interface CashflowHealthScore {
  score: number;
  grade: 'excellent' | 'good' | 'fair' | 'critical';
  savingsRate: number;
  expenseRatio: number;
  budgetDiscipline: number;
  subscriptionLoad: number;
  goalProgress: number;
  summary: string;
  actions: string[];
}

// ===================== UI =====================
export type ThemeMode = 'light' | 'dark' | 'system';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
}

export type SortOption = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc' | 'merchant-asc' | 'merchant-desc';

// ===================== RECURRING TRANSACTION =====================
export type RecurringInterval = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RecurringDayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export interface RecurringTransaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  categoryId: string;
  categoryName: string;
  merchant: string;
  paymentMethod: PaymentMethod;
  note: string;
  interval: RecurringInterval;
  /** Day of month (1-31) for monthly, day of week (0-6) for weekly */
  intervalDay: number;
  /** Start date (YYYY-MM-DD) — first occurrence */
  startDate: string;
  /** Optional end date (YYYY-MM-DD) */
  endDate?: string;
  /** Is recurring active */
  active: boolean;
  /** Last date a transaction was auto-created (YYYY-MM-DD) */
  lastProcessedDate?: string;
  /** Next due date (YYYY-MM-DD) — computed */
  nextDueDate: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecurringFormData {
  type: TransactionType;
  amount: number;
  categoryId: string;
  categoryName: string;
  merchant: string;
  paymentMethod: PaymentMethod;
  note: string;
  interval: RecurringInterval;
  intervalDay: number;
  startDate: string;
  endDate?: string;
}

// ===================== NOTIFICATION =====================

export type NotificationType =
  | 'transaction'
  | 'budget'
  | 'gmail'
  | 'system'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

export type NotificationPriority = 'low' | 'normal' | 'high';

export interface AppNotification {
  id: string;
  type: NotificationType;
  priority?: NotificationPriority;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  /** Optional action label for CTA button */
  actionLabel?: string;
  /** Optional route to navigate to on click */
  actionHref?: string;
  /** Deduplication key — same key updates existing notification */
  dedupeKey?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface CreateNotificationInput {
  type: NotificationType;
  priority?: NotificationPriority;
  title: string;
  message: string;
  read?: boolean;
  actionLabel?: string;
  actionHref?: string;
  dedupeKey?: string;
  metadata?: Record<string, unknown>;
}
