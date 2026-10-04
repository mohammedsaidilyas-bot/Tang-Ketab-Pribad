import React, { useState, useRef } from 'react';
import { Upload, FileText, X, BookOpen, CheckCircle2, Sparkles, Lock } from 'lucide-react';
import { KitabDocument } from '../types/kitab';
import { convertPdfFileToKitab, createSampleKitabPdfFile } from '../utils/pdfProcessor';

interface PdfUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKitabCreated: (kitab: KitabDocument) => void;
}

export const PdfUploadModal: React.FC<PdfUploadModalProps> = ({
  isOpen,
  onClose,
  onKitabCreated,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [customTitle, setCustomTitle] = useState('');
  const [customAuthor, setCustomAuthor] = useState('');
  const [customCategory, setCustomCategory] = useState('Maktabah Pribadi');
  const [coverTone, setCoverTone] = useState<KitabDocument['coverTone']>('bronze');
  const [password, setPassword] = useState('');
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; status?: 'converting' | 'uploading' } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (file: File | null) => {
    setErrorMsg(null);
    setRequiresPassword(false);
    setPassword('');
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setErrorMsg('Mohon pilih berkas berformat .PDF untuk dikonversi menjadi PocketBook.');
      return;
    }
    setSelectedFile(file);
    if (!customTitle) {
      const cleanName = file.name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ');
      setCustomTitle(cleanName);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleProcessPdf = async (fileToUse?: File) => {
    const targetFile = fileToUse || selectedFile;
    if (!targetFile) {
      setErrorMsg('Pilih berkas PDF terlebih dahulu atau gunakan tombol PDF Contoh di bawah.');
      return;
    }

    setIsConverting(true);
    setErrorMsg(null);
    setProgress({ current: 0, total: 1, status: 'converting' });

    try {
      const newKitab = await convertPdfFileToKitab(targetFile, {
        customTitle: customTitle || undefined,
        customAuthor: customAuthor || 'Koleksi Tang Kitab',
        customCategory: customCategory || 'Kitab Pribadi',
        coverTone,
        password: password.trim() || undefined,
        onProgress: (current, total) => {
          if (current === total) {
            setProgress({ current, total, status: 'uploading' });
          } else {
            setProgress({ current, total, status: 'converting' });
          }
        },
      });
      setIsConverting(false);
      onKitabCreated(newKitab);
      onClose();
    } catch (err: any) {
      console.error(err);
      setIsConverting(false);
      if (err?.message === 'PDF_PASSWORD_REQUIRED') {
        setRequiresPassword(true);
        setErrorMsg(
          'Berkas PDF ini terproteksi kata sandi. Masukkan kata sandi dokumen pada kolom di bawah lalu klik Buka kembali.'
        );
      } else {
        setErrorMsg(
          err?.message ? `Gagal memproses berkas PDF: ${err.message}` : 'Gagal memproses berkas PDF. Mohon periksa kembali berkas Anda.'
        );
      }
    }
  };

  const handleInstantSamplePdf = async () => {
    const sampleFile = createSampleKitabPdfFile();
    setSelectedFile(sampleFile);
    setCustomTitle('Risalah Adab & Metode Tang Kitab (Edisi PDF)');
    setCustomAuthor('Maktabah Tang Kitab');
    setCustomCategory('Ushul & Adab');
    await handleProcessPdf(sampleFile);
  };

  const toneOptions: { id: KitabDocument['coverTone']; label: string; swatch: string }[] = [
    { id: 'bronze', label: 'Perunggu Klasik', swatch: 'bg-[#78350F]' },
    { id: 'lapis', label: 'Biru Lapis', swatch: 'bg-[#1E3A8A]' },
    { id: 'forest', label: 'Hijau Zaitun', swatch: 'bg-[#14532D]' },
    { id: 'terracotta', label: 'Terakota Kuno', swatch: 'bg-[#9A3412]' },
    { id: 'charcoal', label: 'Hitam Tinta', swatch: 'bg-[#1C1917]' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C1917]/60 backdrop-blur-xs p-4">
      <div className="relative w-full max-w-2xl bg-[#FBF9F5] border border-[#D6CEBE] shadow-2xl overflow-hidden">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#EBE6DF] bg-[#F7F4EE]">
          <div>
            <p className="text-xs uppercase tracking-widest text-[#78350F] font-sans">
              Konversi Dokumen ke PocketBook
            </p>
            <h2 className="text-2xl font-display font-semibold text-[#1C1917] mt-0.5">
              Masukkan PDF Kitab Pribadi ke Tang Kitab
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-[#57534E] hover:text-[#1C1917] transition-colors"
            aria-label="Tutup modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 max-h-[82vh] overflow-y-auto">
          {/* Dropzone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer border border-dashed p-6 text-center transition-colors ${
              selectedFile
                ? 'border-[#14532D] bg-[#14532D]/5'
                : 'border-[#C7B299] bg-[#F7F4EE]/70 hover:border-[#78350F] hover:bg-[#F3EFE6]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
            />

            {selectedFile ? (
              <div className="flex flex-col items-center gap-2">
                <CheckCircle2 className="w-8 h-8 text-[#14532D]" />
                <p className="text-base font-medium text-[#1C1917]">{selectedFile.name}</p>
                <p className="text-xs text-[#57534E] font-mono-tabular">
                  Ukuran berkas: {(selectedFile.size / 1024).toFixed(1)} KB · Siap diubah ke format PocketBook
                </p>
                <span className="text-xs underline text-[#78350F] mt-1">
                  Klik untuk mengganti berkas PDF lain
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-8 h-8 text-[#78350F]" />
                <p className="text-base font-medium text-[#1C1917]">
                  Seret & lepaskan berkas PDF Kitab di sini, atau klik untuk memilih
                </p>
                <p className="text-xs text-[#57534E] max-w-md">
                  Dokumen PDF Anda akan diekstrak per halaman menjadi buku saku (PocketBook) lengkap dengan mode lembaran ganda, kertas kuning turats, dan tampilan kanvas PDF asli.
                </p>
              </div>
            )}
          </div>

          {/* Format Compatibility Note */}
          <div className="flex items-center gap-2.5 px-4 py-2.5 bg-[#F3EFE6] border border-[#E5DEC9] text-xs text-[#57534E]">
            <CheckCircle2 className="w-4 h-4 text-[#14532D] shrink-0" />
            <span>
              Mendukung segala format dokumen PDF: pindaian kitab turats, manuskrip, dokumen A4/B5, buku terjemahan, dan berkas digital lainnya.
            </span>
          </div>

          {/* Metadata Form */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs uppercase tracking-wider text-[#57534E] mb-1.5 font-sans">
                Judul Kitab di Rak PocketBook
              </label>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="Contoh: Tang Kitab — Syarah Hikmah Pribadi"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D6CEBE] text-[#1C1917] focus:outline-none focus:border-[#78350F]"
              />
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-[#57534E] mb-1.5 font-sans">
                Mushannif / Penyusun
              </label>
              <input
                type="text"
                value={customAuthor}
                onChange={(e) => setCustomAuthor(e.target.value)}
                placeholder="Contoh: Catatan Pribadi / Syaikh ..."
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D6CEBE] text-[#1C1917] focus:outline-none focus:border-[#78350F]"
              />
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-[#57534E] mb-1.5 font-sans">
                Bidang / Fan Ilmu
              </label>
              <input
                type="text"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="Contoh: Fiqih, Ushul, Tasawuf, Tarikh"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D6CEBE] text-[#1C1917] focus:outline-none focus:border-[#78350F]"
              />
            </div>
          </div>

          {/* Cover Tone Picker */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-[#57534E] mb-2 font-sans">
              Warna Jilid Sampul Kitab
            </label>
            <div className="flex flex-wrap gap-2">
              {toneOptions.map((tone) => (
                <button
                  key={tone.id}
                  type="button"
                  onClick={() => setCoverTone(tone.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs border transition-colors whitespace-nowrap ${
                    coverTone === tone.id
                      ? 'border-[#1C1917] bg-[#EBE6DF] font-semibold text-[#1C1917]'
                      : 'border-[#D6CEBE] bg-white text-[#57534E] hover:text-[#1C1917]'
                  }`}
                >
                  <span className={`w-3 h-3 rounded-xs ${tone.swatch}`} />
                  {tone.label}
                </button>
              ))}
            </div>
          </div>

          {/* Password field if PDF is protected */}
          {requiresPassword && (
            <div className="p-4 bg-[#FBF9F5] border-2 border-[#78350F] space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#78350F]">
                <Lock className="w-4 h-4" />
                <span>Dokumen PDF Membutuhkan Kata Sandi Buka Dokumen</span>
              </div>
              <p className="text-xs text-[#57534E] leading-relaxed">
                Jika berkas PDF Anda memang diberi kata sandi, silakan masukkan di bawah. Namun jika berkas sebenarnya tidak memiliki kata sandi (misalnya hasil scan atau dokumen publik), Anda dapat menekan tombol <strong>"Buka Tanpa Sandi"</strong> agar sistem membukanya secara langsung.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Ketik kata sandi PDF jika ada..."
                  className="flex-1 px-3.5 py-2 text-sm bg-white border border-[#D6CEBE] text-[#1C1917] focus:outline-none focus:border-[#78350F]"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPassword('');
                    handleProcessPdf();
                  }}
                  className="px-4 py-2 text-xs font-medium text-[#78350F] border border-[#78350F] bg-white hover:bg-[#78350F] hover:text-white transition-colors whitespace-nowrap"
                >
                  Buka Tanpa Sandi
                </button>
              </div>
            </div>
          )}

          {/* Progress or Error */}
          {isConverting && progress && (
            <div className="p-4 bg-[#F3EFE6] border border-[#D6CEBE]">
              <div className="flex items-center justify-between text-xs text-[#1C1917] mb-2">
                <span className="flex items-center gap-2 font-medium">
                  {progress.status === 'uploading' ? (
                    <Sparkles className="w-4 h-4 text-[#78350F] animate-pulse" />
                  ) : (
                    <FileText className="w-4 h-4 text-[#78350F] animate-pulse" />
                  )}
                  {progress.status === 'uploading' 
                    ? 'Hampir selesai, sedang mengamankan berkas ke cloud...' 
                    : 'Menyusun lembaran PocketBook dari PDF...'}
                </span>
                <span className="font-mono-tabular">
                  {progress.status === 'uploading' ? 'Langkah Terakhir' : `Halaman ${progress.current} / ${progress.total}`}
                </span>
              </div>
              <div className="w-full h-1.5 bg-[#E5DEC9] overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 origin-left ${progress.status === 'uploading' ? 'bg-[#14532D] animate-pulse' : 'bg-[#78350F]'}`}
                  style={{
                    transform: progress.status === 'uploading' ? 'scaleX(1)' : `scaleX(${Math.max(0.08, progress.current / Math.max(1, progress.total))})`,
                  }}
                />
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 bg-[#9A3412]/10 border border-[#9A3412] text-xs text-[#9A3412]">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#EBE6DF] bg-[#F7F4EE]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-[#57534E] hover:text-[#1C1917] transition-colors"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={!selectedFile || isConverting}
            onClick={() => handleProcessPdf()}
            className={`px-5 py-2.5 text-xs font-medium text-white flex items-center gap-2 transition-colors whitespace-nowrap ${
              !selectedFile || isConverting
                ? 'bg-[#A8A29E] cursor-not-allowed'
                : 'bg-[#78350F] hover:bg-[#5C280B]'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            {isConverting ? 'Mengonversi PDF...' : 'Buka di PocketBook Tang Kitab'}
          </button>
        </div>
      </div>
    </div>
  );
};
