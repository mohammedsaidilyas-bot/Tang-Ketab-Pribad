# Kitab Pribadi — Core Product Specification

## Tujuan
Aplikasi Android pribadi/offline-first untuk membaca kitab turats PDF seperti kitab fisik, menyimpan fihris yang terhubung ke halaman, dan menyimpan Hasyiah/catatan guru secara rapi.

## Keputusan desain
- UI: Bahasa Indonesia.
- Isi kitab/fihris: Arab, RTL.
- PDF asli tidak diubah.
- PDF disimpan/cached di perangkat untuk penggunaan offline.
- GitHub: source code dan build pipeline.
- Data pribadi: Hasyiah, bookmark, riwayat baca disimpan lokal di perangkat.
- Metadata katalog bersama boleh memakai Firebase bila diperlukan.

## Fitur inti
1. Koleksi kitab: judul, mushannif, kategori, cover, jumlah halaman, terakhir dibaca.
2. Reader: dua halaman, RTL, zoom, tampilan seperti kitab fisik.
3. Page turn: lembar tetap terlihat saat digeser, mengikuti jari, halaman bawah tetap terlihat, release menyelesaikan atau membatalkan putaran.
4. Fihris otomatis: semua entri fihris dipertahankan dan dipetakan dari nomor halaman kitab ke indeks PDF.
5. Pencarian Arab.
6. Bookmark dan lanjut membaca.
7. Profil mushannif tanpa membuat-buat data.
8. Hasyiah:
   - terikat ke kitab + halaman + posisi/ibarat bila tersedia;
   - teks catatan;
   - kategori syarah, makna, dalil, muzakarah;
   - nama guru;
   - tanggal;
   - foto/scan catatan;
   - rekaman suara (tahap lanjutan);
   - daftar seluruh Hasyiah per kitab;
   - pencarian Hasyiah;
   - PDF asli tetap tidak berubah.
9. Offline-first.

## Tahap pengerjaan
### Tahap 1 — Reader PDF nyata
Pastikan PDF asli tampil sebagai dua halaman dan page-turn tidak membuat halaman menghilang.

### Tahap 2 — Fihris
Ekstraksi, mapping halaman kitab/PDF, validasi dan navigasi langsung.

### Tahap 3 — Hasyiah
Editor catatan yang tertambat pada halaman/ibarat, daftar Hasyiah, pencarian dan penyimpanan lokal.

### Tahap 4 — Mushannif & pencarian
Profil mushannif dan pencarian Arab lintas kitab.

### Tahap 5 — Android APK
Build otomatis melalui GitHub Actions dan pengujian pada perangkat Android.

## Kriteria selesai tahap 1
- PDF asli terlihat selama animasi membalik.
- Tidak ada lembar kosong/gradasi pengganti halaman.
- Drag jari mengontrol progress putaran.
- Cancel/release behavior bekerja.
- RTL benar.
- Dua halaman stabil dan tidak berkedip.
