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
  createdAt: Date;
  updatedAt: Date;
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
}

export interface WalletAccountFormData {
  name: string;
  type: WalletAccountType;
  institution: string;
  balance: number;
  color: string;
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
