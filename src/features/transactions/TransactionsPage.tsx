import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Plus,
  ScanLine,
  X,
  Pencil,
  Trash2,
  TrendingDown,
  TrendingUp,
  Filter as FilterIcon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import {
  addTransaction,
  deleteTransaction,
  getTransactionsPaginated,
  listenToTransactionChanges,
  updateTransaction,
  type PaginatedTransactionsResult,
} from '../../services/transactionService';
import { PAYMENT_METHODS } from '../../config/constants';
import Header from '../../components/layout/Header';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import TransactionItem from '../../components/ui/TransactionItem';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import { TransactionSkeleton } from '../../components/ui/Skeleton';
import TransactionForm from './TransactionForm';
import ScanReceiptModal from './ScanReceiptModal';
import { listenToCategories } from '../../services/categoryService';
import { DuplicateTransactionError } from '../../services/transactionService';
import type { Category, PaymentMethod, Transaction, TransactionFormData, TransactionSource, TransactionType, SortOption } from '../../types';
import { formatCurrency, formatDate, cn } from '../../lib/utils';

export default function TransactionsPage() {
  const { firebaseUser } = useAuthStore();
  const { addToast, addNotification } = useAppStore();
  const [searchParams, setSearchParams] = useSearchParams();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pagination, setPagination] = useState<Omit<PaginatedTransactionsResult, 'data'>>({
    page: Math.max(Number(searchParams.get('page')) || 1, 1),
    pageSize: Math.min(Math.max(Number(searchParams.get('pageSize')) || 50, 1), 100),
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showScanModal, setShowScanModal] = useState(false);
  const [filterType, setFilterType] = useState<TransactionType | 'all'>('all');
  const [filterCategoryId, setFilterCategoryId] = useState('all');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState<PaymentMethod | 'all'>('all');
  const [filterSource, setFilterSource] = useState<TransactionSource | 'all'>('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterMinAmount, setFilterMinAmount] = useState('');
  const [filterMaxAmount, setFilterMaxAmount] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('date-desc');



  useEffect(() => {
    const timeoutId = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    if (!firebaseUser) return;
    return listenToCategories(firebaseUser.uid, setCategories);
  }, [firebaseUser]);

  const loadTransactions = useCallback(async (targetPage = pagination.page) => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const minAmount = filterMinAmount ? Number(filterMinAmount) : null;
      const maxAmount = filterMaxAmount ? Number(filterMaxAmount) : null;
      const result = await getTransactionsPaginated({
        userId: firebaseUser.uid,
        page: targetPage,
        pageSize: pagination.pageSize,
        search: debouncedSearch,
        type: filterType,
        categoryId: filterCategoryId,
        paymentMethod: filterPaymentMethod,
        source: filterSource,
        dateFrom: filterStartDate,
        dateTo: filterEndDate,
        minAmount: Number.isFinite(minAmount) ? minAmount : null,
        maxAmount: Number.isFinite(maxAmount) ? maxAmount : null,
        sortBy,
      });

      if (result.page > result.totalPages && result.totalPages > 0) {
        setPagination((prev) => ({ ...prev, page: result.totalPages, totalPages: result.totalPages }));
        return;
      }

      setTransactions(result.data);
      setPagination({
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
        hasNextPage: result.hasNextPage,
        hasPreviousPage: result.hasPreviousPage,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat transaksi');
    } finally {
      setLoading(false);
    }
  }, [
    firebaseUser,
    pagination.page,
    pagination.pageSize,
    debouncedSearch,
    filterType,
    filterCategoryId,
    filterPaymentMethod,
    filterSource,
    filterStartDate,
    filterEndDate,
    filterMinAmount,
    filterMaxAmount,
    sortBy,
  ]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    if (!firebaseUser) return;
    return listenToTransactionChanges(firebaseUser.uid, () => {
      void loadTransactions();
    });
  }, [firebaseUser, loadTransactions]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(pagination.page));
    params.set('pageSize', String(pagination.pageSize));
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.pageSize]);

  const hasAdvancedFilters = Boolean(
    filterCategoryId !== 'all' ||
      filterPaymentMethod !== 'all' ||
      filterSource !== 'all' ||
      filterStartDate ||
      filterEndDate ||
      filterMinAmount ||
      filterMaxAmount
  );

  useEffect(() => {
    setPagination((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }));
  }, [
    debouncedSearch,
    filterType,
    filterCategoryId,
    filterPaymentMethod,
    filterSource,
    filterStartDate,
    filterEndDate,
    filterMinAmount,
    filterMaxAmount,
    sortBy,
  ]);

  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const rangeEnd = Math.min(pagination.page * pagination.pageSize, pagination.total);
  const pageNumbers = useMemo(() => {
    const totalPages = pagination.totalPages;
    const current = pagination.page;
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    const pages = new Set<number>([1, totalPages, current, current - 1, current + 1]);
    return Array.from(pages)
      .filter((page) => page >= 1 && page <= totalPages)
      .sort((a, b) => a - b);
  }, [pagination.page, pagination.totalPages]);

  const goToPage = (page: number) => {
    const nextPage = Math.min(Math.max(page, 1), pagination.totalPages || 1);
    setPagination((prev) => ({ ...prev, page: nextPage }));
  };

  const clearAdvancedFilters = () => {
    setFilterCategoryId('all');
    setFilterPaymentMethod('all');
    setFilterSource('all');
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterMinAmount('');
    setFilterMaxAmount('');
  };

  const handleDelete = async () => {
    if (!firebaseUser || !selectedTransaction) return;

    try {
      await deleteTransaction(firebaseUser.uid, selectedTransaction.id);
      addToast({ type: 'success', title: 'Transaksi berhasil dihapus' });
      setShowDeleteConfirm(false);
      setSelectedTransaction(null);
      void loadTransactions();
    } catch {
      addToast({ type: 'error', title: 'Gagal menghapus transaksi' });
    }
  };

  const handleSubmit = async (data: TransactionFormData) => {
    if (!firebaseUser) return;

    try {
      if (editingTransaction) {
        await updateTransaction(firebaseUser.uid, editingTransaction.id, data);
        addToast({ type: 'success', title: 'Transaksi berhasil diperbarui' });
      } else {
        await addTransaction(firebaseUser.uid, data);
        addToast({ type: 'success', title: 'Transaksi berhasil ditambahkan' });
        addNotification({
          type: 'transaction',
          title: 'Transaksi berhasil ditambahkan',
          message: `${data.categoryName} sebesar ${formatCurrency(data.amount)} telah dicatat.`,
          actionHref: '/transactions',
          dedupeKey: `transaction-${Date.now()}`,
          read: false,
        });
      }
      setShowForm(false);
      setEditingTransaction(null);
      setSelectedTransaction(null);
      void loadTransactions(1);
    } catch (error) {
      addToast({
        type: 'error',
        title: editingTransaction ? 'Gagal memperbarui transaksi' : 'Gagal menambah transaksi',
        message: error instanceof DuplicateTransactionError
          ? 'Transaksi serupa sudah pernah dicatat. Cek tanggal, nominal, dan merchant.'
          : error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <div>
      <Header
        title="Transaksi"
        showSearch
        onSearchChange={(value) => setSearch(value)}
      />

      <div className="p-4 lg:p-6 space-y-4 max-w-4xl mx-auto">
        {/* Filter & Add */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {['all', 'income', 'expense'].map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type as TransactionType | 'all')}
                className={cn(
                  'px-3 py-1.5 rounded-xl text-xs font-medium transition-all',
                  filterType === type
                    ? 'bg-primary-500 text-white'
                    : 'bg-app-hover/80 text-app-muted hover:bg-app-hover hover:text-app-text'
                )}
              >
                {type === 'all' ? 'Semua' : type === 'income' ? 'Pemasukan' : 'Pengeluaran'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                'relative p-2 rounded-xl bg-app-hover/80 text-app-muted hover:bg-app-hover hover:text-app-text transition-colors',
                hasAdvancedFilters && 'text-primary-600 dark:text-primary-300'
              )}
            >
              <FilterIcon className="w-4 h-4" />
              {hasAdvancedFilters && (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary-500 ring-2 ring-app-bg" />
              )}
            </button>
            <Button
              variant="primary"
              size="sm"
              icon={<ScanLine className="w-4 h-4" />}
              onClick={() => setShowScanModal(true)}
            >
              Scan Bukti
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => {
                setEditingTransaction(null);
                setShowForm(true);
              }}
            >
              Tambah
            </Button>
          </div>
        </div>

        {/* Sort and advanced filter options */}
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-3 rounded-2xl border border-app-border bg-app-surface/70 p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-app-muted">Filter lanjutan</span>
              {hasAdvancedFilters && (
                <button
                  onClick={clearAdvancedFilters}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary-500 hover:text-primary-600"
                >
                  <X className="h-3 w-3" />
                  Reset
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-app-subtle">Urutkan:</span>
              {[
                { value: 'date-desc', label: 'Terbaru' },
                { value: 'date-asc', label: 'Terlama' },
                { value: 'amount-desc', label: 'Nominal Tertinggi' },
                { value: 'amount-asc', label: 'Nominal Terendah' },
                { value: 'merchant-asc', label: 'Merchant A-Z' },
                { value: 'merchant-desc', label: 'Merchant Z-A' },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => setSortBy(option.value as SortOption)}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all',
                    sortBy === option.value
                      ? 'bg-primary-50 dark:bg-primary-500/12 text-primary-600 dark:text-primary-200'
                      : 'text-app-subtle hover:text-app-text'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-app-subtle">Kategori</span>
                <select
                  value={filterCategoryId}
                  onChange={(event) => setFilterCategoryId(event.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-xs app-field"
                >
                  <option value="all">Semua kategori</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[11px] font-medium text-app-subtle">Metode bayar</span>
                <select
                  value={filterPaymentMethod}
                  onChange={(event) => setFilterPaymentMethod(event.target.value as PaymentMethod | 'all')}
                  className="w-full rounded-xl px-3 py-2 text-xs app-field"
                >
                  <option value="all">Semua metode</option>
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[11px] font-medium text-app-subtle">Sumber</span>
                <select
                  value={filterSource}
                  onChange={(event) => setFilterSource(event.target.value as TransactionSource | 'all')}
                  className="w-full rounded-xl px-3 py-2 text-xs app-field"
                >
                  <option value="all">Semua sumber</option>
                  <option value="manual">Manual</option>
                  <option value="gmail">Gmail</option>
                  <option value="fallback">Fallback</option>
                  <option value="ai">AI</option>
                  <option value="import">Import</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[11px] font-medium text-app-subtle">Dari tanggal</span>
                <input
                  type="date"
                  value={filterStartDate}
                  onChange={(event) => setFilterStartDate(event.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-xs app-field"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[11px] font-medium text-app-subtle">Sampai tanggal</span>
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={(event) => setFilterEndDate(event.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-xs app-field"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-app-subtle">Min</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={filterMinAmount}
                    onChange={(event) => setFilterMinAmount(event.target.value)}
                    placeholder="0"
                    className="w-full rounded-xl px-3 py-2 text-xs app-field"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-app-subtle">Max</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={filterMaxAmount}
                    onChange={(event) => setFilterMaxAmount(event.target.value)}
                    placeholder="999999"
                    className="w-full rounded-xl px-3 py-2 text-xs app-field"
                  />
                </label>
              </div>
            </div>
          </motion.div>
        )}

        {/* Transactions list */}
        <Card>
          {loading ? (
            <div className="divide-y divide-app-border/70">
              {[1, 2, 3, 4, 5].map((i) => (
                <TransactionSkeleton key={i} />
              ))}
            </div>
          ) : error ? (
            <div className="p-6 text-center space-y-3">
              <p className="text-sm font-semibold text-app-text">Gagal memuat transaksi</p>
              <p className="text-xs text-app-subtle">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void loadTransactions()}>
                Coba Lagi
              </Button>
            </div>
          ) : transactions.length === 0 ? (
            <EmptyState
              title={search ? 'Tidak ada hasil' : 'Belum ada transaksi'}
              description={
                search
                  ? 'Coba kata kunci lain'
                  : 'Transaksi dari input manual atau Gmail Sync akan tampil di sini.'
              }
              action={
                !search ? (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Plus className="w-4 h-4" />}
                    onClick={() => {
                      setEditingTransaction(null);
                      setShowForm(true);
                    }}
                  >
                    Tambah Transaksi
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="divide-y divide-app-border/70">
              {transactions.map((tx, i) => (
                <TransactionItem
                  key={tx.id}
                  transaction={tx}
                  delay={i}
                  onClick={setSelectedTransaction}
                />
              ))}
            </div>
          )}
        </Card>

        {!loading && !error && pagination.total > 0 && (
          <TransactionPagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            totalPages={pagination.totalPages}
            hasPreviousPage={pagination.hasPreviousPage}
            hasNextPage={pagination.hasNextPage}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            pageNumbers={pageNumbers}
            onPageChange={goToPage}
            onPageSizeChange={(nextPageSize) => {
              setPagination((prev) => ({
                ...prev,
                page: 1,
                pageSize: nextPageSize,
              }));
            }}
          />
        )}
      </div>

      {/* Transaction detail modal */}
      <Modal
        isOpen={!!selectedTransaction && !showDeleteConfirm}
        onClose={() => setSelectedTransaction(null)}
        title="Detail Transaksi"
      >
        {selectedTransaction && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold text-app-text">
                  {formatCurrency(selectedTransaction.amount)}
                </p>
                <p className="text-sm text-app-subtle">
                  {selectedTransaction.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}
                </p>
              </div>
              <div className={cn(
                'w-12 h-12 rounded-xl flex items-center justify-center',
                selectedTransaction.type === 'income'
                  ? 'bg-mint-50 dark:bg-mint-500/12'
                  : 'bg-red-50 dark:bg-red-500/12'
              )}>
                {selectedTransaction.type === 'income'
                  ? <TrendingDown className="w-6 h-6 text-mint-500" />
                  : <TrendingUp className="w-6 h-6 text-red-500" />}
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-app-subtle">Kategori</span>
                <span className="font-medium text-app-text">
                  {selectedTransaction.categoryName}
                </span>
              </div>
              {selectedTransaction.merchant && (
                <div className="flex justify-between">
                  <span className="text-app-subtle">Merchant</span>
                  <span className="font-medium text-app-text">
                    {selectedTransaction.merchant}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-app-subtle">Tanggal</span>
                <span className="font-medium text-app-text">
                  {formatDate(selectedTransaction.date)}
                </span>
              </div>
              {selectedTransaction.note && (
                <div className="flex justify-between">
                  <span className="text-app-subtle">Catatan</span>
                  <span className="font-medium text-app-text">
                    {selectedTransaction.note}
                  </span>
                </div>
              )}
              {selectedTransaction.source !== 'manual' && (
                <div className="flex justify-between">
                  <span className="text-app-subtle">Sumber</span>
                  <span className="font-medium text-primary-500 dark:text-primary-300">
                    {selectedTransaction.source === 'gmail'
                      ? 'Auto from Gmail'
                      : selectedTransaction.source}
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-3 border-t border-app-border">
              <Button
                variant="outline"
                size="sm"
                icon={<Pencil className="w-4 h-4" />}
                fullWidth
                onClick={() => {
                  setEditingTransaction(selectedTransaction);
                  setShowForm(true);
                }}
              >
                Edit
              </Button>
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 className="w-4 h-4" />}
                fullWidth
                onClick={() => setShowDeleteConfirm(true)}
              >
                Hapus
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingTransaction(null);
        }}
        title={editingTransaction ? 'Edit Transaksi' : 'Tambah Transaksi'}
      >
        {firebaseUser && (
          <TransactionForm
            userId={firebaseUser.uid}
            initialData={editingTransaction}
            onSubmit={handleSubmit}
            onCancel={() => {
              setShowForm(false);
              setEditingTransaction(null);
            }}
          />
        )}
      </Modal>

      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Hapus Transaksi"
        maxWidth="sm"
      >
        <div className="space-y-4 text-center">
          <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center mx-auto">
            <Trash2 className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-sm text-app-muted">
            Apakah kamu yakin ingin menghapus transaksi ini? Tindakan ini tidak bisa dibatalkan.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" fullWidth onClick={() => setShowDeleteConfirm(false)}>
              Batal
            </Button>
            <Button variant="danger" size="sm" fullWidth onClick={handleDelete}>
              Hapus
            </Button>
          </div>
        </div>
      </Modal>

      {firebaseUser && (
        <ScanReceiptModal
          isOpen={showScanModal}
          onClose={() => setShowScanModal(false)}
          onSaved={() => {
            setPagination((prev) => ({ ...prev, page: 1 }));
            void loadTransactions(1);
            addNotification({
              type: 'transaction',
              title: 'Transaksi hasil scan tersimpan',
              message: 'Bukti transaksi berhasil dibaca dan dicatat.',
              actionHref: '/transactions',
              dedupeKey: `receipt-scan-${Date.now()}`,
              read: false,
              metadata: { inputSource: 'receipt_scan' },
            });
          }}
        />
      )}
    </div>
  );
}

interface TransactionPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  rangeStart: number;
  rangeEnd: number;
  pageNumbers: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

function TransactionPagination({
  page,
  pageSize,
  total,
  totalPages,
  hasPreviousPage,
  hasNextPage,
  rangeStart,
  rangeEnd,
  pageNumbers,
  onPageChange,
  onPageSizeChange,
}: TransactionPaginationProps) {
  return (
    <div className="space-y-3 rounded-2xl border border-app-border bg-app-card p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5 text-center sm:text-left">
          <p className="text-xs font-medium text-app-text">
            Menampilkan {rangeStart}-{rangeEnd} dari {total} transaksi
          </p>
          <p className="text-[11px] text-app-subtle">
            Halaman {page} dari {totalPages}
          </p>
        </div>

        <label className="flex items-center justify-center gap-2 text-[11px] text-app-subtle">
          Per halaman
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="rounded-lg px-2 py-1 text-xs app-field"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
      </div>

      <div className="flex items-center justify-between gap-2 sm:hidden">
        <Button
          variant="outline"
          size="sm"
          icon={<ChevronLeft className="h-4 w-4" />}
          onClick={() => onPageChange(page - 1)}
          disabled={!hasPreviousPage}
        >
          Sebelumnya
        </Button>
        <span className="text-[11px] font-medium text-app-subtle">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          icon={<ChevronRight className="h-4 w-4" />}
          onClick={() => onPageChange(page + 1)}
          disabled={!hasNextPage}
        >
          Berikutnya
        </Button>
      </div>

      <div className="hidden items-center justify-center gap-1 sm:flex">
        <Button
          variant="outline"
          size="sm"
          icon={<ChevronLeft className="h-4 w-4" />}
          onClick={() => onPageChange(page - 1)}
          disabled={!hasPreviousPage}
        >
          Sebelumnya
        </Button>
        <div className="flex items-center gap-1 px-1">
          {pageNumbers.map((pageNumber, index) => {
            const previous = pageNumbers[index - 1];
            const showEllipsis = previous && pageNumber - previous > 1;
            return (
              <div key={pageNumber} className="flex items-center gap-1">
                {showEllipsis && <span className="px-1 text-xs text-app-subtle">...</span>}
                <button
                  onClick={() => onPageChange(pageNumber)}
                  className={cn(
                    'h-8 min-w-8 rounded-lg px-2 text-xs font-semibold transition-colors',
                    page === pageNumber
                      ? 'bg-primary-500 text-white'
                      : 'text-app-subtle hover:bg-app-hover hover:text-app-text',
                  )}
                >
                  {pageNumber}
                </button>
              </div>
            );
          })}
        </div>
        <Button
          variant="outline"
          size="sm"
          icon={<ChevronRight className="h-4 w-4" />}
          onClick={() => onPageChange(page + 1)}
          disabled={!hasNextPage}
        >
          Berikutnya
        </Button>
      </div>
    </div>
  );
}
