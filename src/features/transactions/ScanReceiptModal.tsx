import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import {
  Camera, Upload, X, ScanLine, AlertCircle,
  CheckCircle2, Loader2, ChevronLeft, Save, Trash2,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { useAppStore } from '../../store/useAppStore';
import { listenToCategories } from '../../services/categoryService';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS } from '../../config/constants';
import CategoryIcon from '../../components/ui/CategoryIcon';
import SuccessCheckAnimation from '../../components/ui/SuccessCheckAnimation';
import { cn, getTodayString, formatCurrency } from '../../lib/utils';
import {
  MAX_AI_IMAGE_BYTES,
  validateImageFile,
  extractFromImage, validateExtractionResult,
  saveScanTransaction,
} from '../../services/receiptScanService';
import { compressReceiptImage, dataUrlToFile, fileToDataUrl } from '../../utils/imageCompression';
import type {
  ReceiptScanResult, Category, TransactionType,
  TransactionFormData, PaymentMethod,
} from '../../types';

const CAMERA_FACING_MODE = { ideal: 'environment' };

const PAYMENT_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'qris', label: 'QRIS' },
  { value: 'kartu-debit', label: 'Kartu Debit' },
  { value: 'kartu-kredit', label: 'Kartu Kredit' },
  { value: 'transfer-bank', label: 'Transfer Bank' },
  { value: 'e-wallet', label: 'E-Wallet' },
  { value: 'lainnya-payment', label: 'Lainnya' },
];

function formatImageSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

type ScanStep = 'choose' | 'capture' | 'preview' | 'extracting' | 'review' | 'saving' | 'success';

interface ScanReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function ScanReceiptModal({ isOpen, onClose, onSaved }: ScanReceiptModalProps) {
  const { firebaseUser } = useAuthStore();
  const { addToast } = useAppStore();

  const [step, setStep] = useState<ScanStep>('choose');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageInfo, setImageInfo] = useState<{ originalBytes: number; compressedBytes: number } | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [extractResult, setExtractResult] = useState<ReceiptScanResult | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [scanSource, setScanSource] = useState<'camera' | 'upload'>('upload');

  const [formType, setFormType] = useState<TransactionType>('expense');
  const [formAmount, setFormAmount] = useState('');
  const [formDate, setFormDate] = useState(getTodayString());
  const [formMerchant, setFormMerchant] = useState('');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formCategoryName, setFormCategoryName] = useState('');
  const [formPaymentMethod, setFormPaymentMethod] = useState<PaymentMethod>('cash');
  const [formNote, setFormNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [extractionFailed, setExtractionFailed] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen || !firebaseUser) return;
    return listenToCategories(firebaseUser.uid, setCategories);
  }, [isOpen, firebaseUser]);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      resetState();
    }
    return () => { stopCamera(); };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (extractingTimeoutRef.current) clearTimeout(extractingTimeoutRef.current);
      stopCamera();
    };
  }, []);

  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
    }
    setCameraError(null);
  }, [cameraStream]);

  const resetState = useCallback(() => {
    setStep('choose');
    setImageDataUrl(null);
    setImageFile(null);
    setImageInfo(null);
    setExtractResult(null);
    setWarnings([]);
    setFormError(null);
    setExtractionFailed(false);
    setFormType('expense');
    setFormAmount('');
    setFormDate(getTodayString());
    setFormMerchant('');
    setFormCategoryId('');
    setFormCategoryName('');
    setFormPaymentMethod('cash');
    setFormNote('');
    setCameraError(null);
  }, []);

  // Camera
  const openCamera = useCallback(async () => {
    setCameraError(null);
    setScanSource('camera');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Browser tidak mendukung akses kamera. Gunakan Upload Gambar.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: CAMERA_FACING_MODE },
        audio: false,
      });
      setCameraStream(stream);
      setStep('capture');
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 100);
    } catch (error: any) {
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setCameraError('Izin kamera ditolak. Izinkan akses kamera atau gunakan Upload Gambar.');
      } else if (error.name === 'NotFoundError') {
        setCameraError('Kamera tidak ditemukan di perangkat ini.');
      } else {
        setCameraError('Gagal membuka kamera: ' + (error.message || 'Unknown error'));
      }
    }
  }, []);

  const capturePhoto = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !cameraStream) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const cameraFile = dataUrlToFile(dataUrl, `receipt-camera-${Date.now()}.jpg`);

    try {
      const compressedFile = await compressReceiptImage(cameraFile);
      const previewUrl = await fileToDataUrl(compressedFile);
      setImageFile(compressedFile);
      setImageInfo({ originalBytes: cameraFile.size, compressedBytes: compressedFile.size });
      setImageDataUrl(previewUrl);
      stopCamera();
      setStep('preview');
    } catch (error: any) {
      addToast({
        type: 'error',
        title: 'Gagal memproses gambar',
        message: error.message || 'Coba ambil foto ulang dengan jarak lebih dekat.',
      });
    }
  }, [cameraStream, stopCamera, addToast]);

  const openFilePicker = useCallback(() => {
    setScanSource('upload');
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const validationError = validateImageFile(file);
    if (validationError) {
      addToast({ type: 'error', title: validationError });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    try {
      const compressedFile = await compressReceiptImage(file);
      if (compressedFile.size > MAX_AI_IMAGE_BYTES) {
        throw new Error('Gambar masih terlalu besar setelah dikompres.');
      }
      const previewUrl = await fileToDataUrl(compressedFile);
      setImageFile(compressedFile);
      setImageInfo({ originalBytes: file.size, compressedBytes: compressedFile.size });
      setImageDataUrl(previewUrl);
      setStep('preview');
    } catch (error: any) {
      addToast({ type: 'error', title: 'Gagal memproses gambar', message: error.message });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [addToast]);

  // AI Extraction
  const handleExtract = useCallback(async () => {
    if (!imageFile) {
      addToast({
        type: 'error',
        title: 'Gambar belum siap',
        message: 'Upload atau ambil foto bukti transaksi terlebih dahulu.',
      });
      return;
    }
    setStep('extracting');
    setFormError(null);
    try {
      const result = await extractFromImage(imageFile, { paymentMethod: 'cash' });
      const { validated, warnings: newWarnings } = validateExtractionResult(result);
      setExtractResult(validated);
      setWarnings(newWarnings);

      const defaultDate = getTodayString();
      setFormType(validated.transaction_type || 'expense');
      setFormAmount(validated.amount ? String(validated.amount) : '');
      setFormDate(validated.date || defaultDate);
      setFormMerchant(validated.merchant || '');
      setFormPaymentMethod((validated.payment_method as PaymentMethod) || 'cash');
      setFormNote(validated.note || 'Pembayaran' + (validated.merchant ? ' di ' + validated.merchant : ''));

      if (validated.category) {
        const catType = validated.transaction_type === 'income' || validated.transaction_type === 'refund' ? 'income' : 'expense';
        const matched = categories.find(
          (c) => c.name.toLowerCase() === validated.category?.toLowerCase() && c.type === catType
        );
        if (matched) {
          setFormCategoryId(matched.id);
          setFormCategoryName(matched.name);
        } else {
          setFormCategoryName(validated.category);
        }
      }

      addToast({ type: 'success', title: 'Bukti berhasil dibaca', message: 'Cek kembali detail transaksinya.' });
      extractingTimeoutRef.current = setTimeout(() => { setStep('review'); }, 600);
    } catch (error: any) {
      addToast({
        type: 'error',
        title: 'Gagal membaca bukti',
        message: error.message || 'AI belum bisa membaca bukti ini. Coba foto lebih jelas atau isi manual.',
      });
      setExtractionFailed(true);
      setStep('preview');
    }
  }, [imageFile, categories, addToast]);

  // Save
  const handleSave = useCallback(async () => {
    if (!firebaseUser) return;
    const amountNum = parseInt(formAmount.replace(/[^0-9]/g, ''), 10);
    if (!amountNum || amountNum <= 0) {
      setFormError('Isi nominal transaksi yang valid.');
      return;
    }
    if (!formCategoryId && !formCategoryName) {
      setFormError('Pilih kategori transaksi.');
      return;
    }
    setStep('saving');
    setFormError(null);
    try {
      const data: TransactionFormData = {
        type: formType,
        amount: amountNum,
        categoryId: formCategoryId,
        categoryName: formCategoryName,
        merchant: formMerchant,
        paymentMethod: formPaymentMethod,
        note: formNote,
        date: formDate,
      };
      // Duplicate detection handled inside saveScanTransaction
      await saveScanTransaction(firebaseUser.uid, data, extractResult!, scanSource);
      setStep('success');
      setTimeout(() => { onSaved(); onClose(); resetState(); }, 1500);
    } catch (error: any) {
      addToast({ type: 'error', title: 'Gagal menyimpan transaksi', message: error.message || 'Coba lagi.' });
      setStep('review');
    }
  }, [firebaseUser, formAmount, formType, formCategoryId, formCategoryName, formMerchant, formPaymentMethod, formNote, formDate, extractResult, scanSource, addToast, onSaved, onClose, resetState]);

  // Confidence label helper
  const confLabel = (score: number | undefined): { label: string; color: string } => {
    if (!score) return { label: 'Tidak ada skor', color: 'text-app-muted' };
    if (score >= 0.88) return { label: 'Akurat', color: 'text-emerald-600 dark:text-emerald-400' };
    if (score >= 0.6) return { label: 'Perlu dicek', color: 'text-amber-600 dark:text-amber-400' };
    return { label: 'Kurang yakin', color: 'text-red-600 dark:text-red-400' };
  };

  const catType = formType === 'income' || formType === 'refund' ? 'income' : 'expense';
  const cats = categories.filter((c) => c.type === catType);
  const displayCats = cats.length > 0 ? cats : (
    catType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  ).map((c) => ({
    id: c.id, userId: firebaseUser?.uid || '', name: c.name,
    type: catType as 'income' | 'expense', icon: c.icon, color: c.color, isDefault: true, createdAt: new Date(),
  }));

  return (
    <AnimatePresence>
      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 app-overlay backdrop-blur-sm"
            onClick={() => { if (step !== 'extracting' && step !== 'saving') { stopCamera(); onClose(); } }}
          />
          <motion.div
            initial={{ opacity: 0, y: 100, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 100, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className={cn(
              'relative w-full max-w-md app-elevated',
              'rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto',
              'sm:mb-0 mx-0 sm:mx-4',
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-app-border sticky top-0 bg-app-bg z-10 rounded-t-2xl">
              <h2 className="text-sm font-semibold text-app-text">
                {step === 'choose' && 'Scan Bukti'}
                {step === 'capture' && 'Ambil Foto'}
                {step === 'preview' && 'Preview Gambar'}
                {step === 'extracting' && 'Memproses...'}
                {step === 'review' && 'Review Hasil'}
                {step === 'saving' && 'Menyimpan...'}
                {step === 'success' && 'Berhasil'}
              </h2>
              <button
                onClick={() => { stopCamera(); onClose(); }}
                disabled={step === 'extracting' || step === 'saving'}
                className={cn('p-1.5 app-icon-button', (step === 'extracting' || step === 'saving') && 'opacity-50 cursor-not-allowed')}
                aria-label="Tutup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="px-5 py-2">
              {step === 'choose' && (
                <div className="space-y-5 py-4">
                  <div className="text-center space-y-2">
                    <div className="mx-auto w-16 h-16 rounded-2xl bg-primary-50 dark:bg-primary-500/12 flex items-center justify-center">
                      <ScanLine className="w-8 h-8 text-primary-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-app-text">Scan Bukti Transaksi</h3>
                    <p className="text-sm text-app-muted max-w-xs mx-auto leading-relaxed">
                      Ambil foto atau unggah gambar bukti transaksi fisik untuk diekstrak otomatis oleh AI.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={openCamera}
                      className="flex items-center justify-center gap-3 w-full py-4 px-5 rounded-2xl bg-gradient-to-r from-primary-500 to-soft-purple text-white shadow-lg shadow-primary-500/25 hover:shadow-xl hover:shadow-primary-500/30 transition-all active:scale-[0.98] font-semibold text-sm"
                    >
                      <Camera className="w-5 h-5" />
                      Ambil Foto
                    </button>
                    <button
                      onClick={openFilePicker}
                      className="flex items-center justify-center gap-3 w-full py-4 px-5 rounded-2xl bg-app-hover/80 text-app-text border-2 border-dashed border-app-border hover:border-primary-500/40 hover:bg-primary-50/50 dark:hover:bg-primary-500/8 transition-all active:scale-[0.98] font-semibold text-sm"
                    >
                      <Upload className="w-5 h-5" />
                      Upload Gambar
                    </button>
                  </div>
                  <p className="text-[10px] text-app-subtle text-center leading-relaxed px-2">
                    Gambar bukti transaksi hanya digunakan untuk membaca nominal dan detail transaksi. Gambar tidak disimpan permanen.
                  </p>
                  <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileSelected} />
                </div>
              )}

              {step === 'capture' && (
                <div className="space-y-4 pb-4">
                  <div className="relative rounded-2xl overflow-hidden bg-black flex items-center justify-center min-h-[300px] sm:min-h-[400px]">
                    {cameraError ? (
                      <div className="text-center p-6 space-y-3">
                        <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
                        <p className="text-sm text-white/80">{cameraError}</p>
                        <button onClick={openCamera} className="px-4 py-2 rounded-xl bg-white/15 text-white text-xs font-semibold hover:bg-white/25 transition-colors">Coba Lagi</button>
                        <button onClick={() => setStep('choose')} className="px-4 py-2 rounded-xl bg-white/10 text-white/70 text-xs hover:bg-white/20 transition-colors block mx-auto">Kembali</button>
                      </div>
                    ) : (
                      <>
                        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                        <div className="absolute inset-0 border-[3px] border-white/20 rounded-2xl pointer-events-none" />
                        <div className="absolute inset-x-0 top-4 flex justify-center">
                          <span className="px-3 py-1 rounded-full bg-black/40 text-white/80 text-[10px] font-medium backdrop-blur-sm">Arahkan ke bukti transaksi</span>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => { stopCamera(); setStep('choose'); }}
                      className="flex-1 py-3 rounded-2xl text-sm font-semibold bg-app-hover/80 text-app-text border border-app-border hover:bg-app-hover transition-all"
                    >
                      Batal
                    </button>
                    <button
                      onClick={capturePhoto}
                      disabled={!!cameraError}
                      className="flex-[2] py-3 rounded-2xl text-sm font-semibold bg-gradient-to-r from-primary-500 to-soft-purple text-white shadow-md shadow-primary-500/25 hover:shadow-lg hover:shadow-primary-500/30 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Ambil Foto
                    </button>
                  </div>
                  <canvas ref={canvasRef} className="hidden" />
                </div>
              )}

              {step === 'preview' && (
                <div className="space-y-4 pb-4">
                  <div className="relative rounded-2xl overflow-hidden bg-app-surface/50 flex items-center justify-center min-h-[250px] sm:min-h-[320px] border border-app-border">
                    {imageDataUrl && (
                      <img src={imageDataUrl} alt="Preview bukti transaksi" className="w-full h-full object-contain max-h-[400px]" />
                    )}
                  </div>
                  <div className="rounded-xl border border-app-border bg-app-surface/60 px-3 py-2">
                    <p className="text-[11px] font-medium text-app-muted">
                      Gambar dioptimalkan otomatis agar proses AI lebih cepat.
                    </p>
                    {imageInfo && (
                      <p className="mt-0.5 text-[10px] text-app-subtle">
                        {formatImageSize(imageInfo.originalBytes)} menjadi {formatImageSize(imageInfo.compressedBytes)}
                      </p>
                    )}
                  </div>

                  {/* Extraction failed: show fallback message and manual entry option */}
                  {extractionFailed && (
                    <div className="rounded-xl border border-amber-200 dark:border-amber-400/30 bg-amber-50/80 dark:bg-amber-500/10 px-3 py-2.5">
                      <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                        AI belum bisa membaca bukti saat ini. Kamu tetap bisa mengisi transaksi manual dari gambar ini.
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => { stopCamera(); setImageFile(null); setImageInfo(null); setExtractionFailed(false); setStep('choose'); }}
                      className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-app-hover/80 text-app-muted border border-app-border hover:bg-app-hover hover:text-app-text transition-all"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      Ganti
                    </button>
                    {extractionFailed ? (
                      <>
                        <button
                          onClick={handleExtract}
                          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold bg-app-hover/80 text-app-text border border-app-border hover:bg-app-hover transition-all active:scale-[0.98]"
                        >
                          <ScanLine className="w-4 h-4" />
                          Coba Lagi
                        </button>
                        <button
                          onClick={() => {
                            setExtractionFailed(false);
                            setExtractResult(null);
                            setFormType('expense');
                            setFormAmount('');
                            setFormDate(getTodayString());
                            setFormMerchant('');
                            setFormNote('');
                            setStep('review');
                          }}
                          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold bg-gradient-to-r from-primary-500 to-soft-purple text-white shadow-md shadow-primary-500/25 hover:shadow-lg hover:shadow-primary-500/30 transition-all active:scale-[0.98]"
                        >
                          <Save className="w-4 h-4" />
                          Isi Manual
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => { setExtractionFailed(false); handleExtract(); }}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold bg-gradient-to-r from-primary-500 to-soft-purple text-white shadow-md shadow-primary-500/25 hover:shadow-lg hover:shadow-primary-500/30 transition-all active:scale-[0.98]"
                      >
                        <ScanLine className="w-4 h-4" />
                        Ekstrak dengan AI
                      </button>
                    )}
                    <button
                      onClick={() => { setImageDataUrl(null); setImageFile(null); setImageInfo(null); setExtractionFailed(false); setStep('choose'); }}
                      className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-red-50 dark:bg-red-500/12 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-400/30 hover:bg-red-100 dark:hover:bg-red-500/20 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {step === 'extracting' && (
                <div className="flex flex-col items-center justify-center py-12 space-y-4" role="status" aria-live="polite">
                  <div className="w-16 h-16 rounded-2xl bg-primary-50 dark:bg-primary-500/12 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-semibold text-app-text">Membaca bukti transaksi...</p>
                    <p className="text-xs text-app-muted">AI sedang mengekstrak nominal dan detail</p>
                  </div>
                </div>
              )}

              {step === 'review' && extractResult && (
                <div className="space-y-4 pb-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-app-text">Hasil Ekstraksi</h3>
                    <span className={cn(
                      'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold',
                      confLabel(extractResult.confidence_score).color,
                      extractResult.confidence_score && extractResult.confidence_score >= 0.88
                        ? 'bg-emerald-50 dark:bg-emerald-500/12'
                        : extractResult.confidence_score && extractResult.confidence_score >= 0.6
                          ? 'bg-amber-50 dark:bg-amber-500/12'
                          : 'bg-red-50 dark:bg-red-500/12',
                    )}>
                      <CheckCircle2 className="w-3 h-3" />
                      {confLabel(extractResult.confidence_score).label}
                      {extractResult.confidence_score ? ' (' + Math.round(extractResult.confidence_score * 100) + '%)' : ''}
                    </span>
                  </div>

                  {warnings.length > 0 && (
                    <div className="rounded-xl bg-amber-50 dark:bg-amber-500/8 border border-amber-200 dark:border-amber-400/20 p-3 space-y-1">
                      {warnings.map((w, i) => (
                        <p key={i} className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          {w}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <label className="text-[11px] font-medium text-app-muted mb-1.5 block">Tipe</label>
                      <div className="flex gap-1.5">
                        {[{ value: 'expense', label: 'Pengeluaran' }, { value: 'income', label: 'Pemasukan' }, { value: 'transfer', label: 'Transfer' }, { value: 'refund', label: 'Refund' }].map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => setFormType(opt.value as TransactionType)}
                            className={cn(
                              'flex-1 py-2 rounded-xl text-[11px] font-semibold transition-all border',
                              formType === opt.value
                                ? 'bg-primary-50 dark:bg-primary-500/12 text-primary-700 dark:text-primary-200 border-primary-200 dark:border-primary-400/30'
                                : 'bg-app-surface/50 text-app-muted border-app-border hover:border-app-subtle',
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="space-y-1">
                        <span className="text-[11px] font-medium text-app-muted">Nominal (Rp)</span>
                        <input
                          type="text" inputMode="numeric" value={formAmount}
                          onChange={(e) => setFormAmount(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="0"
                          className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold tabular-nums app-field"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] font-medium text-app-muted">Tanggal</span>
                        <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="w-full rounded-xl px-3 py-2.5 text-sm app-field" />
                      </label>
                    </div>

                    <label className="space-y-1">
                      <span className="text-[11px] font-medium text-app-muted">Merchant</span>
                      <input type="text" value={formMerchant} onChange={(e) => setFormMerchant(e.target.value)} placeholder="Nama toko / merchant" className="w-full rounded-xl px-3 py-2.5 text-sm app-field" />
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-[11px] font-medium text-app-muted block">Kategori</span>
                      <div className="grid grid-cols-3 gap-1.5 max-h-[140px] overflow-y-auto">
                        {displayCats.slice(0, 12).map((cat) => (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => { setFormCategoryId(cat.id); setFormCategoryName(cat.name); }}
                            className={cn(
                              'flex flex-col items-center gap-1 py-2 px-1 rounded-xl text-[10px] font-medium transition-all',
                              formCategoryId === cat.id
                                ? 'bg-primary-50 dark:bg-primary-500/12 text-primary-700 dark:text-primary-200 border border-primary-200 dark:border-primary-400/30'
                                : 'bg-app-surface/50 text-app-muted border border-app-border hover:border-app-subtle hover:text-app-text',
                            )}
                          >
                            <CategoryIcon name={cat.name} type={catType} size="sm" noBackground animated={formCategoryId === cat.id} animationVariant={formCategoryId === cat.id ? 'selected' : 'soft'} />
                            <span className="truncate w-full text-center leading-tight">{cat.name}</span>
                          </button>
                        ))}
                      </div>
                    </label>

                    <label className="space-y-1">
                      <span className="text-[11px] font-medium text-app-muted">Metode Bayar</span>
                      <select value={formPaymentMethod} onChange={(e) => setFormPaymentMethod(e.target.value as PaymentMethod)} className="w-full rounded-xl px-3 py-2.5 text-sm app-field">
                        {PAYMENT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1">
                      <span className="text-[11px] font-medium text-app-muted">Catatan</span>
                      <textarea value={formNote} onChange={(e) => setFormNote(e.target.value)} placeholder="Deskripsi transaksi" rows={2} className="w-full rounded-xl px-3 py-2.5 text-sm app-field resize-none" />
                    </label>

                    {formError && (
                      <p className="text-xs text-red-500 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {formError}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => { setImageDataUrl(null); setImageFile(null); setImageInfo(null); setExtractResult(null); setWarnings([]); setStep('choose'); }}
                      className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-app-hover/80 text-app-muted border border-app-border hover:bg-app-hover hover:text-app-text transition-all"
                    >
                      Scan Ulang
                    </button>
                    <button
                      onClick={handleSave}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold bg-gradient-to-r from-primary-500 to-soft-purple text-white shadow-md shadow-primary-500/25 hover:shadow-lg hover:shadow-primary-500/30 transition-all active:scale-[0.98]"
                    >
                      <Save className="w-4 h-4" />
                      Simpan Transaksi
                    </button>
                  </div>
                </div>
              )}

              {step === 'saving' && (
                <div className="flex flex-col items-center justify-center py-12 space-y-4" role="status" aria-live="polite">
                  <div className="w-16 h-16 rounded-2xl bg-primary-50 dark:bg-primary-500/12 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
                  </div>
                  <p className="text-sm font-semibold text-app-text">Menyimpan transaksi...</p>
                </div>
              )}

              {step === 'success' && (
                <div className="flex flex-col items-center justify-center py-10 space-y-4" role="status" aria-live="polite">
                  <SuccessCheckAnimation size="lg" showParticles />
                  <div className="text-center space-y-1">
                    <p className="text-base font-semibold text-app-text">Transaksi berhasil disimpan</p>
                    <p className="text-xs text-app-muted">
                      {formMerchant
                        ? formCategoryName + ' sebesar ' + formatCurrency(parseInt(formAmount) || 0) + ' di ' + formMerchant
                        : formCategoryName + ' sebesar ' + formatCurrency(parseInt(formAmount) || 0)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
