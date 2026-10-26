# BINUS LMS Forum Web Assistant (FastAPI & Pure HTML/CSS/JS)

A lightweight, standalone local web application built with **FastAPI**, **vanilla JavaScript**, and **uv** to monitor and answer [BINUS LMS](https://lms.binus.ac.id/lms) forum discussions directly from your browser.

---

## 🚀 Fitur Utama

- **Pure Web Dashboard (Single-Page)**: Dibuka di browser (`http://127.0.0.1:8000`), ultra-cepat, tanpa framework berat (no Gradio, no Tkinter).
- **Auto-Period Detection**: Otomatis mendeteksi dan memilih periode akademik aktif (`isRunningPeriod: true`, contoh: `2611`).
- **Subject Selector**: Dropdown mata kuliah hanya menampilkan nama subject yang bersih (contoh: *Computer Vision Application*, *Generative Artificial Intelligence*, *Internet of Things (IoT)*).
- **Card-Based Feed**: Setiap pertanyaan forum dosen ditampilkan dalam kartu lengkap dengan:
  - Label sesi & topik
  - Nama & role dosen pengampu (`Instructor`)
  - Indikator status: 🟢 **Replied by You** (dengan preview jawaban Anda) vs 🟠 **Not Replied Yet**
  - Opsi filter: *"Show Unanswered Only"* dan filter per sesi
- **Direct Answer Submission**: Form jawaban langsung pada kartu pertanyaan untuk submit jawaban via API (`/Comment/Post`) tanpa membuka LMS manual. Status otomatis berubah ke 🟢 secara instan tanpa reload halaman.
- **Smart Auth & Persistent Profile**:
  - Menggunakan profil Chrome (`.chrome_user_data/`) agar SSO dan cookie tetap tersimpan.
  - Token didekripsi otomatis dengan AES key LMS (`%v$4T!9CRqE_[G-=`) dan dicache di `.auth_cache.json` untuk startup instan (< 100ms).

---

## 📁 Struktur File

```text
lms_forum_answer/
├── .chrome_user_data/      # Profil Chrome tersimpan (cookies, SSO)
├── .auth_cache.json        # Cache token JWT & headers APIM
├── lms_auth.py             # Manajemen autentikasi & ekstraksi token
├── lms_api.py              # Klien HTTP Azure APIM (periods, courses, sessions, threads, posts)
├── server.py               # FastAPI backend REST API
├── static/
│   └── index.html          # Frontend single-page (Pure HTML5, CSS3, JS)
├── browser.py              # Helper Selenium Chrome persistent profile
├── main.py                 # Entry point aplikasi (auto-open browser)
├── ecosystem.config.js     # Konfigurasi process manager PM2
├── pyproject.toml          # Dependensi uv
└── README.md               # Dokumentasi
```

---

## 🛠️ Cara Penggunaan

### 1. Sinkronisasi Dependensi dengan `uv`
```powershell
uv sync
```

### 2. Jalankan Aplikasi Web
Cukup jalankan:
```powershell
uv run python main.py
```
Browser default Anda akan otomatis terbuka ke:
👉 **`http://127.0.0.1:8000`**

### 3. Jalankan di Background dengan PM2 (Rekomendasi)
Agar aplikasi berjalan terus-menerus di background tanpa jendela terminal dan otomatis restart saat PC dinyalakan:

1. **Install PM2 & Windows Startup Utility** (jika belum ada):
   ```powershell
   npm install -g pm2
   npm install -g pm2-windows-startup
   pm2-startup install
   ```

2. **Jalankan Aplikasi via PM2**:
   ```powershell
   pm2 start ecosystem.config.js
   ```

3. **Simpan agar otomatis jalan saat boot**:
   ```powershell
   pm2 save
   ```

4. **Perintah Berguna PM2**:
   - Cek status: `pm2 status`
   - Cek logs: `pm2 logs lms-forum`
   - Restart: `pm2 restart lms-forum`
   - Hentikan: `pm2 stop lms-forum`

---

### 4. Login Ulang (Jika Token Kedaluwarsa)
Jika sesi login kedaluwarsa atau belum ada:
- Klik tombol **"🔑 Re-Login"** pada navigasi web, atau
- Jalankan via terminal:
  ```powershell
  uv run python main.py --login
  ```
- Browser Chrome akan terbuka. Silakan login ke akun BINUS Anda.
- Sesi akan tersimpan otomatis dan halaman web akan merefresh data.
