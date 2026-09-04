import { useState, useEffect, useMemo } from 'react';
import {
  RefreshCw,
  Plus,
  PauseCircle,
  PlayCircle,
  Trash2,
  Edit3,
  Calendar,
  ArrowLeftRight,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import {
  listenToRecurringTransactions,
  addRecurringTransaction,
  updateRecurringTransaction,
  deleteRecurringTransaction,
  processDueRecurringTransactions,
  computeNextDueDate,
} from '../../services/recurringService';
import { cn, formatCurrency, formatDate, formatTransactionType } from '../../lib/utils';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS } from '../../config/constants';
import type { RecurringTransaction, RecurringFormData, RecurringInterval, TransactionType, PaymentMethod } from '../../types';

const INTERVAL_LABELS: Record<RecurringInterval, string> = {
  daily: 'Harian',
  weekly: 'Mingguan',
  monthly: 'Bulanan',
  yearly: 'Tahunan',
};

const INTERVAL_OPTIONS: { value: RecurringInterval; label: string }[] = [
  { value: 'daily', label: 'Harian' },
  { value: 'weekly', label: 'Mingguan' },
  { value: 'monthly', label: 'Bulanan' },
  { value: 'yearly', label: 'Tahunan' },
];

const DAY_OF_WEEK_LABELS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function getIntervalDescription(rt: RecurringTransaction): string {
  switch (rt.interval) {
    case 'daily':
      return 'Setiap hari';
    case 'weekly':
      return `Setiap ${DAY_OF_WEEK_LABELS[rt.intervalDay] || 'hari ke-' + rt.intervalDay}`;
    case 'monthly':
      return `Setiap tanggal ${rt.intervalDay}`;
    case 'yearly':
      return `Setiap ${formatDate(rt.startDate)}`;
  }
}

export default function RecurringPage() {
  const authUser = useAuthStore((s) => s.authUser);
  const { addToast, addNotification } = useAppStore(
    useShallow((s) => ({ addToast: s.addToast, addNotification: s.addNotification })),
  );
  const [recurringList, setRecurringList] = useState<RecurringTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [processingAll, setProcessingAll] = useState(false);

  // Form state
  const [formType, setFormType] = useState<TransactionType>('expense');
  const [formAmount, setFormAmount] = useState('');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formCategoryName, setFormCategoryName] = useState('');
  const [formMerchant, setFormMerchant] = useState('');
  const [formPaymentMethod, setFormPaymentMethod] = useState<PaymentMethod>('cash');
  const [formNote, setFormNote] = useState('');
  const [formInterval, setFormInterval] = useState<RecurringInterval>('monthly');
  const [formIntervalDay, setFormIntervalDay] = useState(new Date().getDate());
  const [formStartDate, setFormStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [formEndDate, setFormEndDate] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const userId = authUser?.uid;

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const unsub = listenToRecurringTransactions(
      userId,
      (list) => {
        setRecurringList(list);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return unsub;
  }, [userId]);

  const categories = formType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  // Reset form
  const resetForm = () => {
    setFormType('expense');
    setFormAmount('');
    setFormCategoryId(categories[0]?.id || '');
    setFormCategoryName(categories[0]?.name || '');
    setFormMerchant('');
    setFormPaymentMethod('cash');
    setFormNote('');
    setFormInterval('monthly');
    setFormIntervalDay(new Date().getDate());
    setFormStartDate(new Date().toISOString().split('T')[0]);
    setFormEndDate('');
    setEditingId(null);
  };

  // Open form for edit
  const openEdit = (rt: RecurringTransaction) => {
    setFormType(rt.type);
    setFormAmount(String(rt.amount));
    setFormCategoryId(rt.categoryId);
    setFormCategoryName(rt.categoryName);
    setFormMerchant(rt.merchant || '');
    setFormPaymentMethod(rt.paymentMethod);
    setFormNote(rt.note || '');
    setFormInterval(rt.interval);
    setFormIntervalDay(rt.intervalDay);
    setFormStartDate(rt.startDate);
    setFormEndDate(rt.endDate || '');
    setEditingId(rt.id);
    setShowForm(true);
  };

  // Auto select category when type changes
  useEffect(() => {
    const list = formType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    if (!formCategoryId || !list.find((c) => c.id === formCategoryId)) {
      setFormCategoryId(list[0]?.id || '');
      setFormCategoryName(list[0]?.name || '');
    }
  }, [formType, formCategoryId]);

  const handleSubmit = async () => {
    if (!userId) return;
    const amount = parseInt(formAmount.replace(/\./g, ''), 10);
    if (!amount || amount <= 0) {
      addToast({ type: 'error', title: 'Masukkan nominal transaksi' });
      return;
    }
    if (!formCategoryId) {
      addToast({ type: 'error', title: 'Pilih kategori' });
      return;
    }
    const cat = categories.find((c) => c.id === formCategoryId);
    const data: RecurringFormData = {
      type: formType,
      amount,
      categoryId: formCategoryId,
      categoryName: cat?.name || formCategoryName,
      merchant: formMerchant,
      paymentMethod: formPaymentMethod,
      note: formNote,
      interval: formInterval,
      intervalDay: formIntervalDay,
      startDate: formStartDate,
      endDate: formEndDate || undefined,
    };

    setFormSubmitting(true);
    try {
      if (editingId) {
        await updateRecurringTransaction(userId, editingId, data);
        addToast({ type: 'success', title: 'Transaksi rutin diperbarui' });
      } else {
        await addRecurringTransaction(userId, data);
        addToast({ type: 'success', title: 'Transaksi rutin ditambahkan' });
      }
      setShowForm(false);
      resetForm();
    } catch (err) {
      addToast({ type: 'error', title: 'Gagal menyimpan transaksi rutin', message: String(err) });
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleToggleActive = async (rt: RecurringTransaction) => {
    if (!userId) return;
    try {
      await updateRecurringTransaction(userId, rt.id, { active: !rt.active });
      addToast({
        type: 'success',
        title: rt.active ? 'Transaksi rutin dijeda' : 'Transaksi rutin diaktifkan',
      });
    } catch (err) {
      addToast({ type: 'error', title: 'Gagal mengubah status', message: String(err) });
    }
  };

  const handleDelete = async () => {
    if (!userId || !deleteId) return;
    try {
      await deleteRecurringTransaction(userId, deleteId);
      addToast({ type: 'success', title: 'Transaksi rutin dihapus' });
      setDeleteId(null);
    } catch (err) {
      addToast({ type: 'error', title: 'Gagal menghapus', message: String(err) });
    }
  };

  const handleProcessNow = async () => {
    if (!userId) return;
    setProcessingAll(true);
    try {
      const count = await processDueRecurringTransactions(userId);
      addToast({
        type: 'success',
        title: count > 0 ? `${count} transaksi rutin dibuat` : 'Tidak ada transaksi jatuh tempo',
      });
    } catch (err) {
      addToast({ type: 'error', title: 'Gagal memproses', message: String(err) });
    } finally {
      setProcessingAll(false);
    }
  };

  // Sort: active first, then by next due date
  const sortedList = useMemo(() => {
    return [...recurringList].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.nextDueDate.localeCompare(b.nextDueDate);
    });
  }, [recurringList]);

  const activeCount = recurringList.filter((rt) => rt.active).length;

  // --- Render ---
  return (
    <div className="px-4 sm:px-6 py-4 sm:py-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-app-text">Transaksi Rutin</h1>
          <p className="text-sm text-app-subtle mt-0.5">
            {activeCount} aktif · {recurringList.length - activeCount} dijeda
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleProcessNow}
            disabled={processingAll}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all',
              'bg-app-surface border border-app-border text-app-muted hover:bg-app-hover hover:text-app-text',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            <RefreshCw className={cn('w-3.5 h-3.5', processingAll && 'animate-spin')} />
            Proses
          </button>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-primary-500 text-white hover:bg-primary-600 transition-all shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            Tambah
          </button>
        </div>
      </div>

      {/* Info card */}
      <div className="flex items-start gap-3 p-3 rounded-xl bg-primary-50 dark:bg-primary-500/8 border border-primary-200 dark:border-primary-500/20 text-xs text-primary-700 dark:text-primary-200">
        <Clock className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p>
          Transaksi rutin akan otomatis dibuat setiap kali tanggal jatuh tempo tiba.
          Setiap kali kamu membuka aplikasi, sistem akan mengecek dan membuat transaksi yang terlewat.
          Kamu juga bisa menjalankan proses manual kapan saja.
        </p>
      </div>

      {/* Empty state */}
      {!loading && sortedList.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-2xl bg-app-surface border border-app-border flex items-center justify-center mb-4">
            <RefreshCw className="w-6 h-6 text-app-subtle" />
          </div>
          <h3 className="text-sm font-semibold text-app-text mb-1">Belum ada transaksi rutin</h3>
          <p className="text-xs text-app-subtle max-w-xs mb-4">
            Catat langganan, cicilan, gaji, atau pengeluaran rutin lainnya dan biarkan CashFlow membuatkannya secara otomatis.
          </p>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-primary-500 text-white hover:bg-primary-600 transition-all"
          >
            <Plus className="w-4 h-4" />
            Tambah Transaksi Rutin
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-24 rounded-xl bg-app-surface border border-app-border" />
          ))}
        </div>
      )}

      {/* List */}
      {sortedList.length > 0 && (
        <div className="space-y-2">
          {sortedList.map((rt) => (
            <motion.div
              key={rt.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                'relative p-4 rounded-xl border transition-all duration-200',
                rt.active
                  ? 'bg-app-surface border-app-border hover:border-primary-500/40'
                  : 'bg-app-surface/60 border-app-border/50 opacity-60'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                {/* Left: info */}
                <div className="flex-1 min-w-0">
                  {/* Type badge + amount */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={cn(
                      'text-xs font-semibold px-1.5 py-0.5 rounded-md',
                      rt.type === 'expense'
                        ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-300'
                        : 'bg-mint-50 dark:bg-mint-500/10 text-mint-600 dark:text-mint-300'
                    )}>
                      {formatTransactionType(rt.type)}
                    </span>
                    <span className="text-sm font-bold text-app-text">
                      {formatCurrency(rt.amount)}
                    </span>
                    {!rt.active && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-app-surface border border-app-border text-app-subtle">
                        Dijeda
                      </span>
                    )}
                  </div>

                  {/* Category + Merchant */}
                  <p className="text-xs font-medium text-app-text truncate">
                    {rt.categoryName}
                    {rt.merchant && <span className="text-app-subtle"> · {rt.merchant}</span>}
                  </p>

                  {/* Interval + next due */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                    <span className="text-[11px] text-app-subtle flex items-center gap-1">
                      <RefreshCw className="w-3 h-3" />
                      {getIntervalDescription(rt)}
                    </span>
                    {rt.active && (
                      <span className="text-[11px] text-primary-600 dark:text-primary-300 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        Jatuh tempo {formatDate(rt.nextDueDate)}
                      </span>
                    )}
                    {rt.note && (
                      <span className="text-[11px] text-app-subtle truncate max-w-[200px]">
                        · {rt.note}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Toggle active */}
                  <button
                    onClick={() => handleToggleActive(rt)}
                    className="p-1.5 rounded-lg text-app-subtle hover:bg-app-hover hover:text-app-text transition-all"
                    title={rt.active ? 'Jeda' : 'Aktifkan'}
                  >
                    {rt.active
                      ? <PauseCircle className="w-4 h-4" />
                      : <PlayCircle className="w-4 h-4 text-mint-500" />
                    }
                  </button>
                  {/* Edit */}
                  <button
                    onClick={() => openEdit(rt)}
                    className="p-1.5 rounded-lg text-app-subtle hover:bg-app-hover hover:text-app-text transition-all"
                    title="Edit"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  {/* Delete */}
                  <button
                    onClick={() => setDeleteId(rt.id)}
                    className="p-1.5 rounded-lg text-app-subtle hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 transition-all"
                    title="Hapus"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Add / Edit Form Modal */}
      <AnimatePresence>
        {showForm && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
              onClick={() => {
                if (!formSubmitting) { setShowForm(false); resetForm(); }
              }}
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className={cn(
                'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
                'w-[calc(100%-2rem)] sm:w-[480px] max-h-[85vh] overflow-y-auto',
                'bg-app-elevated border border-app-border rounded-2xl shadow-xl',
                'p-5 sm:p-6'
              )}
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-bold text-app-text">
                  {editingId ? 'Edit Transaksi Rutin' : 'Tambah Transaksi Rutin'}
                </h2>
                <button
                  onClick={() => { setShowForm(false); resetForm(); }}
                  className="p-1 rounded-lg text-app-subtle hover:bg-app-hover"
                >
                  <ArrowLeftRight className="w-4 h-4 rotate-45" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Type toggle */}
                <div className="flex rounded-xl bg-app-surface border border-app-border p-0.5">
                  <button
                    onClick={() => setFormType('expense')}
                    className={cn(
                      'flex-1 py-2 text-sm font-medium rounded-[10px] transition-all',
                      formType === 'expense'
                        ? 'bg-red-500 text-white shadow-sm'
                        : 'text-app-muted hover:text-app-text'
                    )}
                  >
                    Pengeluaran
                  </button>
                  <button
                    onClick={() => setFormType('income')}
                    className={cn(
                      'flex-1 py-2 text-sm font-medium rounded-[10px] transition-all',
                      formType === 'income'
                        ? 'bg-mint-500 text-white shadow-sm'
                        : 'text-app-muted hover:text-app-text'
                    )}
                  >
                    Pemasukan
                  </button>
                </div>

                {/* Amount */}
                <label className="block">
                  <span className="block text-xs font-medium text-app-subtle mb-1.5">Nominal</span>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-app-muted">Rp</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={formAmount}
                      onChange={(e) => setFormAmount(e.target.value)}
                      placeholder="0"
                      aria-label="Nominal transaksi rutin"
                      className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl bg-app-surface border border-app-border text-app-text placeholder:text-app-subtle/50 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                    />
                  </div>
                </label>

                {/* Interval */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-app-subtle mb-1.5">Frekuensi</label>
                    <select
                      value={formInterval}
                      onChange={(e) => setFormInterval(e.target.value as RecurringInterval)}
                      className="w-full px-3 py-2.5 text-sm rounded-xl bg-app-surface border border-app-border text-app-text focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                    >
                      {INTERVAL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-app-subtle mb-1.5">
                      {formInterval === 'weekly' ? 'Hari' : 'Tanggal'}
                    </label>
                    {formInterval === 'weekly' ? (
                      <select
                        value={formIntervalDay}
                        onChange={(e) => setFormIntervalDay(Number(e.target.value))}
                        className="w-full px-3 py-2.5 text-sm rounded-xl bg-app-surface border border-app-border text-app-text focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                      >
                        {DAY_OF_WEEK_LABELS.map((label, i) => (
                          <option key={i} value={i}>{label}</option>
                        ))}
                      </select>
                    ) : (
                      <select
                        value={formIntervalDay}
                        onChange={(e) => setFormIntervalDay(Number(e.target.value))}
                        className="w-full px-3 py-2.5 text-sm rounded-xl bg-app-surface border border-app-border text-app-text focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                      >
                        {Array.from({ length: 31 }, (_, i) => (
                          <option key={i + 1} value={i + 1}>{i + 1}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* Category */}
                <div>
                  <label className="block text-xs font-medium text-app-subtle mb-1.5">Kategori</label>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                    {categories.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => { setFormCategoryId(cat.id); setFormCategoryName(cat.name); }}
                        className={cn(
                          'px-2 py-2 rounded-lg text-xs font-medium transition-all border',
                          formCategoryId === cat.id
                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-300'
                            : 'border-app-border bg-app-surface text-app-muted hover:bg-app-hover hover:text-app-text'
                        )}
                      >
                        {cat.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Merchant + Payment */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-app-subtle mb-1.5">Merchant</label>
                    <input
                      type="text"
                      value={formMerchant}
                      onChange={(e) => setFormMerchant(e.target.value)}
                      placeholder="Nama merchant"
                      className="w-full px-3 py-2.5 text-sm rounded-xl bg-app-surface border border-app-border text-app-text placeholder:text-app-subtle/50 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-app-subtle mb-1.5">Pembayaran</label>
                    <select
                      value={formPaymentMethod}
                      onChange={(e) => setFormPaymentMethod(e.target.value as PaymentMethod)}
                      className="w-full px-3 py-2.5 text-sm rounded-xl bg-app-surface border border-app-border text-app-text focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                    >
                      {PAYMENT_METHODS.map((pm) => (
                        <option key={pm.id} value={pm.id}>{pm.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-xs font-medium text-app-subtle mb-1.5">Mulai</span>
                    <input
                      type="date"
                      value={formStartDate}
                      onChange={(e) => setFormStartDate(e.target.value)}
                      aria-label="Tanggal mulai transaksi rutin"
                      className="w-full px-3 py-2.5 text-sm rounded-xl bg-app-surface border border-app-border text-app-text focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs font-medium text-app-subtle mb-1.5">
                      Berakhir <span className="text-app-subtle/60">(opsional)</span>
                    </span>
                    <input
                      type="date"
                      value={formEndDate}
                      onChange={(e) => setFormEndDate(e.target.value)}
                      aria-label="Tanggal berakhir transaksi rutin (opsional)"
                      min={formStartDate || undefined}
                      className="w-full px-3 py-2.5 text-sm rounded-xl bg-app-surface border border-app-border text-app-text placeholder:text-app-subtle/50 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                    />
                  </label>
                </div>

                {/* Note */}
                <div>
                  <label className="block text-xs font-medium text-app-subtle mb-1.5">
                    Catatan <span className="text-app-subtle/60">(opsional)</span>
                  </label>
                  <input
                    type="text"
                    value={formNote}
                    onChange={(e) => setFormNote(e.target.value)}
                    placeholder="Misal: Kos, Netflix, dll"
                    className="w-full px-3 py-2.5 text-sm rounded-xl bg-app-surface border border-app-border text-app-text placeholder:text-app-subtle/50 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
                  />
                </div>

                {/* Submit */}
                <button
                  onClick={handleSubmit}
                  disabled={formSubmitting}
                  className={cn(
                    'w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all',
                    formType === 'expense'
                      ? 'bg-red-500 hover:bg-red-600'
                      : 'bg-mint-500 hover:bg-mint-600',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    'shadow-sm'
                  )}
                >
                  {formSubmitting ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : 'Tambah Transaksi Rutin'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {deleteId && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
              onClick={() => setDeleteId(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn(
                'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
                'w-[calc(100%-2rem)] sm:w-[360px]',
                'bg-app-elevated border border-app-border rounded-2xl shadow-xl',
                'p-5 text-center'
              )}
            >
              <div className="w-10 h-10 mx-auto mb-3 rounded-2xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="text-sm font-bold text-app-text mb-1">Hapus Transaksi Rutin?</h3>
              <p className="text-xs text-app-subtle mb-4">
                Transaksi rutin yang sudah dibuat sebelumnya tidak akan terpengaruh.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setDeleteId(null)}
                  className="flex-1 py-2 rounded-xl text-sm font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-hover transition-all"
                >
                  Batal
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 py-2 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-all shadow-sm"
                >
                  Hapus
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
