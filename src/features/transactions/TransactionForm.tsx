import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS } from '../../config/constants';
import { listenToCategories } from '../../services/categoryService';
import CategoryIcon from '../../components/ui/CategoryIcon';
import Button from '../../components/ui/Button';
import { cn, getTodayString } from '../../lib/utils';
import type { Category, PaymentMethod, Transaction, TransactionFormData, TransactionType } from '../../types';

interface TransactionFormProps {
  userId: string;
  initialData?: Transaction | null;
  onSubmit: (data: TransactionFormData) => Promise<void>;
  onCancel: () => void;
}

const typeOptions: Array<{ value: TransactionType; label: string }> = [
  { value: 'expense', label: 'Pengeluaran' },
  { value: 'income', label: 'Pemasukan' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'refund', label: 'Refund' },
];

export default function TransactionForm({ userId, initialData, onSubmit, onCancel }: TransactionFormProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<TransactionFormData>({
    type: initialData?.type || 'expense',
    amount: initialData?.amount || 0,
    categoryId: initialData?.categoryId || '',
    categoryName: initialData?.categoryName || '',
    merchant: initialData?.merchant || '',
    paymentMethod: initialData?.paymentMethod || 'qris',
    note: initialData?.note || '',
    date: initialData?.date || getTodayString(),
  });

  useEffect(() => {
    const unsubscribe = listenToCategories(userId, setCategories);
    return unsubscribe;
  }, [userId]);

  const visibleCategories = useMemo(() => {
    const categoryType = form.type === 'income' || form.type === 'refund' ? 'income' : 'expense';
    const realtimeCategories = categories.filter((category) => category.type === categoryType);
    if (realtimeCategories.length > 0) return realtimeCategories;

    const fallback = categoryType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    return fallback.map((category) => ({
      id: category.id,
      userId,
      name: category.name,
      type: categoryType,
      icon: category.icon,
      color: category.color,
      isDefault: true,
      createdAt: new Date(),
    }));
  }, [categories, form.type, userId]);

  useEffect(() => {
    if (form.categoryId && visibleCategories.some((category) => category.id === form.categoryId)) return;
    const firstCategory = visibleCategories[0];
    if (firstCategory) {
      setForm((current) => ({
        ...current,
        categoryId: firstCategory.id,
        categoryName: firstCategory.name,
      }));
    }
  }, [form.categoryId, visibleCategories]);

  const updateField = <K extends keyof TransactionFormData>(key: K, value: TransactionFormData[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.amount || form.amount <= 0) return;

    setSubmitting(true);
    try {
      await onSubmit(form);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2">
        {typeOptions.map((option) => (
          <button
            type="button"
            key={option.value}
            onClick={() => updateField('type', option.value)}
            className={cn(
              'rounded-2xl border px-3 py-2 text-xs font-semibold transition-all',
                form.type === option.value
                ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-400/40 dark:bg-primary-500/12 dark:text-primary-200'
                : 'border-app-border bg-app-surface text-app-muted hover:border-app-subtle hover:text-app-text'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-app-muted">Nominal</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={form.amount || ''}
            onChange={(event) => updateField('amount', Number(event.target.value))}
            placeholder="125000"
            className="w-full rounded-2xl px-4 py-3 text-sm app-field tabular-nums"
            required
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-app-muted">Tanggal</span>
          <input
            type="date"
            value={form.date}
            onChange={(event) => updateField('date', event.target.value)}
            className="w-full rounded-2xl px-4 py-3 text-sm app-field"
            required
          />
        </label>
      </div>

      <div className="space-y-2">
        <span className="text-xs font-semibold text-app-muted">Kategori</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {visibleCategories.map((category) => (
            <button
              type="button"
              key={category.id}
              onClick={() => {
                updateField('categoryId', category.id);
                updateField('categoryName', category.name);
              }}
              className={cn(
                'flex items-center gap-2 rounded-2xl border px-3 py-2 text-left text-xs font-semibold transition-all',
                form.categoryId === category.id
                  ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-400/40 dark:bg-primary-500/12 dark:text-primary-200'
                  : 'border-app-border bg-app-surface text-app-muted hover:border-app-subtle hover:text-app-text'
              )}
            >
              <CategoryIcon
                name={category.name}
                type={form.type === 'income' ? 'income' : 'expense'}
                size="xs"
                animated={form.categoryId === category.id}
                animationVariant={form.categoryId === category.id ? 'selected' : 'soft'}
                interactive
              />
              <span className="truncate">{category.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-app-muted">Merchant / Pengirim</span>
          <input
            value={form.merchant}
            onChange={(event) => updateField('merchant', event.target.value)}
            placeholder="Shopee, GoPay, BCA"
            className="w-full rounded-2xl px-4 py-3 text-sm app-field"
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-app-muted">Metode Bayar</span>
          <select
            value={form.paymentMethod}
            onChange={(event) => updateField('paymentMethod', event.target.value as PaymentMethod)}
            className="w-full rounded-2xl px-4 py-3 text-sm app-field"
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method.id} value={method.id}>
                {method.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="space-y-1.5 block">
        <span className="text-xs font-semibold text-app-muted">Catatan</span>
        <textarea
          value={form.note}
          onChange={(event) => updateField('note', event.target.value)}
          placeholder="Detail singkat transaksi"
          rows={3}
          className="w-full resize-none rounded-2xl px-4 py-3 text-sm app-field"
        />
      </label>

      <motion.div layout className="sticky bottom-0 bg-app-surface/95 backdrop-blur-lg -mx-4 sm:-mx-5 px-4 sm:px-5 py-3 border-t border-app-border flex gap-2 sm:static sm:bg-transparent sm:backdrop-blur-none sm:-mx-0 sm:px-0 sm:pt-4 sm:border-t sm:border-app-border">
        <Button type="button" variant="ghost" fullWidth onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" fullWidth loading={submitting}>
          {initialData ? 'Simpan Perubahan' : 'Tambah Transaksi'}
        </Button>
      </motion.div>
    </form>
  );
}
