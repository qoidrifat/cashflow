import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, TrendingUp, TrendingDown } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { addTransaction, DuplicateTransactionError } from '../../services/transactionService';
import { listenToCategories } from '../../services/categoryService';
import CategoryIcon from '../../components/ui/CategoryIcon';
import { cn, getTodayString, formatCurrency } from '../../lib/utils';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../config/constants';
import type { Category, TransactionType, TransactionFormData, PaymentMethod } from '../../types';

interface QuickAddSheetProps {
  isOpen: boolean;
  onClose: () => void;
  initialType?: TransactionType;
}

export default function QuickAddSheet({ isOpen, onClose, initialType }: QuickAddSheetProps) {
  const authUser = useAuthStore((s) => s.authUser);
  const { addToast, addNotification } = useAppStore(
    useShallow((s) => ({ addToast: s.addToast, addNotification: s.addNotification })),
  );
  const amountInputRef = useRef<HTMLInputElement>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [type, setType] = useState<TransactionType>(initialType || 'expense');
  const [amount, setAmount] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [categoryName, setCategoryName] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  // Subscribe to categories when sheet opens
  useEffect(() => {
    if (!isOpen || !authUser) return;
    const unsubscribe = listenToCategories(authUser.uid, setCategories);
    return unsubscribe;
  }, [isOpen, authUser]);

  // Auto-focus amount input when sheet opens
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        amountInputRef.current?.focus();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Reset form when sheet opens
  useEffect(() => {
    if (isOpen) {
      setType(initialType || 'expense');
      setAmount('');
      setCategoryId('');
      setCategoryName('');
    }
  }, [isOpen, initialType]);

  // Filter categories by type + sort: recent first (default categories first)
  const visibleCategories = useMemo(() => {
    const categoryType = type === 'income' || type === 'refund' ? 'income' : 'expense';
    const realtime = categories.filter((c) => c.type === categoryType);
    if (realtime.length > 0) {
      // Sort: default categories first, then custom
      return [...realtime].sort((a, b) => (a.isDefault === b.isDefault ? 0 : a.isDefault ? -1 : 1));
    }
    const fallback = categoryType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    return fallback.map((c) => ({
      id: c.id,
      userId: authUser?.uid || '',
      name: c.name,
      type: categoryType,
      icon: c.icon,
      color: c.color,
      isDefault: true,
      createdAt: new Date(),
    }));
  }, [categories, type, authUser]);

  // Auto-select first category
  useEffect(() => {
    if (!categoryId && visibleCategories.length > 0) {
      setCategoryId(visibleCategories[0].id);
      setCategoryName(visibleCategories[0].name);
    }
  }, [categoryId, visibleCategories]);

  const handleSubmit = useCallback(async () => {
    if (!authUser) return;
    const amountNum = parseInt(amount.replace(/\./g, ''), 10);
    if (!amountNum || amountNum <= 0) {
      addToast({ type: 'warning', title: 'Isi nominal transaksi' });
      return;
    }

    setSubmitting(true);
    try {
      const data: TransactionFormData = {
        type,
        amount: amountNum,
        categoryId,
        categoryName,
        merchant: '',
        paymentMethod: 'qris' as PaymentMethod,
        note: '',
        date: getTodayString(),
      };

      const created = await addTransaction(authUser.uid, data);
      addToast({ type: 'success', title: 'Transaksi berhasil ditambahkan' });
      addNotification({
        type: 'transaction',
        title: 'Transaksi berhasil ditambahkan',
        message: `${categoryName} sebesar ${formatCurrency(amountNum)} telah dicatat.`,
        actionHref: '/transactions',
        // M-14 (audit 2026-09-04): dedupeKey deterministik dari ID transaksi
        // yang baru dibuat — `transaction-${Date.now()}` bisa sama antar dua
        // submit di event loop yang sama → notifikasi salah dedupe.
        dedupeKey: `transaction-created-${created}`,
        read: false,
      });
      onClose();
    } catch (error) {
      addToast({
        type: error instanceof DuplicateTransactionError ? 'warning' : 'error',
        title: error instanceof DuplicateTransactionError ? 'Transaksi duplikat' : 'Gagal menambah transaksi',
        message: error instanceof DuplicateTransactionError
          ? 'Transaksi dengan tanggal, nominal, dan kategori/merchant serupa sudah ada.'
          : error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }, [authUser, amount, type, categoryId, categoryName, addToast, addNotification, onClose]);

  // Handle Enter key to submit
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !submitting && amount) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit, submitting, amount]);

  if (!authUser) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 app-overlay backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Bottom sheet */}
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className={cn(
              'relative w-full max-w-md',
              'app-elevated',
              'rounded-t-2xl sm:rounded-2xl',
              'max-h-[85vh] overflow-y-auto',
              'sm:mb-0',
              'mx-0 sm:mx-4',
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-app-border">
              <h2 className="text-sm font-semibold text-app-text">Catat Transaksi</h2>
              <button onClick={onClose} className="p-1.5 app-icon-button" aria-label="Tutup">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="px-5 py-4 space-y-4" onKeyDown={handleKeyDown}>
              {/* Type toggle */}
              <div className="flex gap-2">
                <button
                  onClick={() => { setType('expense'); setCategoryId(''); setCategoryName(''); }}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-all',
                    type === 'expense'
                      ? 'bg-red-50 dark:bg-red-500/12 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-400/30'
                      : 'bg-app-surface/50 text-app-muted border border-app-border hover:border-app-subtle'
                  )}
                >
                  <TrendingUp className="w-4 h-4" />
                  Pengeluaran
                </button>
                <button
                  onClick={() => { setType('income'); setCategoryId(''); setCategoryName(''); }}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-all',
                    type === 'income'
                      ? 'bg-mint-50 dark:bg-mint-500/12 text-mint-600 dark:text-mint-300 border border-mint-200 dark:border-mint-400/30'
                      : 'bg-app-surface/50 text-app-muted border border-app-border hover:border-app-subtle'
                  )}
                >
                  <TrendingDown className="w-4 h-4" />
                  Pemasukan
                </button>
              </div>

              {/* Amount input */}
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-app-subtle">
                  Rp
                </span>
                <input
                  ref={amountInputRef}
                  type="text"
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => {
                    // Only allow digits
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    setAmount(raw);
                  }}
                  placeholder="0"
                  className={cn(
                    'w-full pl-12 pr-4 py-4 rounded-2xl text-2xl font-bold tabular-nums',
                    'app-field',
                    'focus:ring-2 focus:ring-primary-500/20',
                    type === 'expense'
                      ? 'focus:border-red-400'
                      : 'focus:border-mint-400'
                  )}
                  autoComplete="off"
                />
              </div>

              {/* Quick amount chips */}
              <div className="flex gap-1.5 flex-wrap">
                {type === 'expense'
                  ? [15000, 25000, 50000, 100000, 150000].map((val) => (
                      <button
                        key={val}
                        onClick={() => setAmount(String(val))}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all',
                          parseInt(amount) === val
                            ? 'bg-red-50 dark:bg-red-500/12 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-400/30'
                            : 'bg-app-hover/80 text-app-muted border border-app-border hover:bg-app-hover'
                        )}
                      >
                        Rp{val.toLocaleString('id-ID')}
                      </button>
                    ))
                  : [500000, 1000000, 3000000, 5000000].map((val) => (
                      <button
                        key={val}
                        onClick={() => setAmount(String(val))}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all',
                          parseInt(amount) === val
                            ? 'bg-mint-50 dark:bg-mint-500/12 text-mint-600 dark:text-mint-300 border border-mint-200 dark:border-mint-400/30'
                            : 'bg-app-hover/80 text-app-muted border border-app-border hover:bg-app-hover'
                        )}
                      >
                        Rp{val.toLocaleString('id-ID')}
                      </button>
                    ))}
              </div>

              {/* Category grid */}
              <div>
                <p className="text-[11px] font-medium text-app-muted mb-2">Kategori</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {visibleCategories.slice(0, 9).map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => { setCategoryId(cat.id); setCategoryName(cat.name); }}
                      className={cn(
                        'flex flex-col items-center gap-1 py-2 px-1 rounded-xl text-[11px] font-medium transition-all',
                        categoryId === cat.id
                          ? 'bg-primary-50 dark:bg-primary-500/12 text-primary-700 dark:text-primary-200 border border-primary-200 dark:border-primary-400/30'
                          : 'bg-app-surface/50 text-app-muted border border-app-border hover:border-app-subtle hover:text-app-text'
                      )}
                    >
                      <CategoryIcon
                        name={cat.name}
                        type={type === 'income' ? 'income' : 'expense'}
                        size="sm"
                        noBackground
                        animated={categoryId === cat.id}
                        animationVariant={categoryId === cat.id ? 'selected' : 'soft'}
                      />
                      <span className="truncate w-full text-center leading-tight">{cat.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit button */}
              <button
                onClick={handleSubmit}
                disabled={submitting || !amount || parseInt(amount) <= 0}
                className={cn(
                  'w-full py-3.5 rounded-2xl text-sm font-semibold transition-all',
                  'flex items-center justify-center gap-2',
                  type === 'expense' ? [
                    'bg-gradient-to-r from-red-500 to-rose-500',
                    'text-white shadow-sm shadow-red-500/25',
                    'hover:shadow-md hover:shadow-red-500/30',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  ] : [
                    'bg-gradient-to-r from-mint-500 to-emerald-500',
                    'text-white shadow-sm shadow-mint-500/25',
                    'hover:shadow-md hover:shadow-mint-500/30',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                  ]
                )}
              >
                {submitting ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    {amount
                      ? `Catat Rp${parseInt(amount).toLocaleString('id-ID')}`
                      : 'Catat Transaksi'}
                  </>
                )}
              </button>

              {/* Note */}
              <p className="text-[10px] text-app-subtle text-center">
                Tekan Enter untuk menyimpan cepat &middot; Transaksi dicatat hari ini
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
