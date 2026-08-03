import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, Trash2, Sparkles } from 'lucide-react';
import CategoryIcon from '../../components/ui/CategoryIcon';
import Header from '../../components/layout/Header';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import { addCategory, deleteCategory, initializeDefaultCategories, listenToCategories, updateCategory } from '../../services/categoryService';
import { cn } from '../../lib/utils';
import type { Category, CategoryFormData } from '../../types';

const colorOptions = ['#10b981', '#8b5cf6', '#3b82f6', '#ec4899', '#f59e0b', '#ef4444', '#14b8a6', '#64748b'];
const iconOptions = ['Wallet', 'UtensilsCrossed', 'Car', 'ShoppingBag', 'Receipt', 'Gamepad2', 'BookOpen', 'HeartPulse', 'Briefcase', 'Gift'];

export default function CategoriesPage() {
  const { authUser } = useAuthStore();
  const { addToast } = useAppStore();
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeType, setActiveType] = useState<'expense' | 'income'>('expense');
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CategoryFormData>({
    name: '',
    type: 'expense',
    icon: 'Wallet',
    color: '#10b981',
  });

  useEffect(() => {
    if (!authUser) return;

    initializeDefaultCategories(authUser.uid).catch(() => {
      addToast({ type: 'warning', title: 'Kategori default belum bisa dibuat' });
    });

    return listenToCategories(authUser.uid, setCategories);
  }, [authUser, addToast]);

  const visibleCategories = useMemo(
    () => categories.filter((category) => category.type === activeType),
    [categories, activeType]
  );

  const openForm = (category?: Category) => {
    setEditingCategory(category || null);
    setForm({
      name: category?.name || '',
      type: category?.type || activeType,
      icon: category?.icon || 'Wallet',
      color: category?.color || '#10b981',
    });
    setShowForm(true);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!authUser || !form.name.trim()) return;

    try {
      if (editingCategory) {
        await updateCategory(authUser.uid, editingCategory.id, form);
        addToast({ type: 'success', title: 'Kategori diperbarui' });
      } else {
        await addCategory(authUser.uid, form);
        addToast({ type: 'success', title: 'Kategori ditambahkan' });
      }
      setShowForm(false);
      setEditingCategory(null);
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Kategori gagal disimpan',
        message: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const handleDelete = async (category: Category) => {
    if (!authUser) return;
    if (category.isDefault) {
      addToast({ type: 'warning', title: 'Kategori default tidak bisa dihapus' });
      return;
    }

    try {
      await deleteCategory(authUser.uid, category.id);
      addToast({ type: 'success', title: 'Kategori dihapus' });
    } catch {
      addToast({ type: 'error', title: 'Gagal menghapus kategori' });
    }
  };

  return (
    <div>
      <Header title="Kategori" />

      <div className="mx-auto max-w-5xl space-y-5 p-4 lg:p-6">
        <Card className="fintech-surface overflow-hidden">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-app-elevated/70 px-3 py-1 text-xs font-bold text-primary-700 dark:text-primary-300">
                <Sparkles className="h-3.5 w-3.5" />
                Category Studio
              </div>
              <h2 className="font-display text-2xl font-bold text-app-text">
                Atur kategori sesuai gaya cashflow kamu
              </h2>
              <p className="mt-1 max-w-xl text-sm text-app-muted">
                Default kategori sudah siap, tapi kamu tetap bisa menambah kategori custom dengan warna dan icon sendiri.
              </p>
            </div>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => openForm()}>
              Kategori Baru
            </Button>
          </div>
        </Card>

        <div className="flex gap-2">
          {[
            { value: 'expense', label: 'Pengeluaran' },
            { value: 'income', label: 'Pemasukan' },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => setActiveType(option.value as 'expense' | 'income')}
              className={cn(
                'rounded-2xl px-4 py-2 text-sm font-bold transition',
                activeType === option.value
                  ? 'bg-navy-950 text-white dark:bg-slate-50 dark:text-navy-950'
                  : 'bg-app-surface text-app-muted hover:bg-app-hover/70 hover:text-app-text'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {visibleCategories.length === 0 ? (
          <Card>
            <EmptyState title="Belum ada kategori" description="Tambahkan kategori custom pertama kamu." />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleCategories.map((category, index) => (
              <motion.div
                key={category.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
              >
                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <CategoryIcon
                        name={category.name}
                        type={category.type}
                        size="lg"
                        animated
                        animationVariant="hover"
                        interactive
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-app-text">{category.name}</p>
                        <p className="text-xs text-app-subtle">
                          {category.isDefault ? 'Default' : 'Custom'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => openForm(category)}
                        className="p-2 app-icon-button hover:text-primary-600 dark:hover:text-primary-300"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(category)}
                        className="p-2 app-icon-button hover:text-red-500 dark:hover:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title={editingCategory ? 'Edit Kategori' : 'Kategori Baru'}>
        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-app-muted">Nama Kategori</span>
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              className="w-full rounded-2xl px-4 py-3 text-sm app-field"
              placeholder="Contoh: Kopi Produktif"
              required
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            {[
              { value: 'expense', label: 'Pengeluaran' },
              { value: 'income', label: 'Pemasukan' },
            ].map((option) => (
              <button
                type="button"
                key={option.value}
                onClick={() => setForm((current) => ({ ...current, type: option.value as 'expense' | 'income' }))}
                className={cn(
                  'rounded-2xl border px-3 py-2 text-xs font-bold',
                  form.type === option.value
                    ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-400/30 dark:bg-primary-500/12 dark:text-primary-300'
                    : 'border-app-border text-app-muted bg-app-surface/50'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <span className="text-xs font-semibold text-app-muted">Warna</span>
            <div className="flex flex-wrap gap-2">
              {colorOptions.map((color) => (
                <button
                  type="button"
                  key={color}
                  onClick={() => setForm((current) => ({ ...current, color }))}
                  className={cn('h-9 w-9 rounded-2xl border-2 shadow-sm', form.color === color ? 'border-navy-950 dark:border-slate-50' : 'border-transparent')}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-app-muted">Icon</span>
            <select
              value={form.icon}
              onChange={(event) => setForm((current) => ({ ...current, icon: event.target.value }))}
              className="w-full rounded-2xl px-4 py-3 text-sm app-field"
            >
              {iconOptions.map((icon) => (
                <option key={icon} value={icon}>
                  {icon}
                </option>
              ))}
            </select>
          </label>

          <div className="flex gap-2 border-t border-app-border pt-4">
            <Button type="button" variant="ghost" fullWidth onClick={() => setShowForm(false)}>
              Batal
            </Button>
            <Button type="submit" fullWidth>
              Simpan
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
