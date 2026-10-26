# LMS Forum Answer - Browser Automation with Selenium & uv

Proyek otomasi browser menggunakan **Python**, **Selenium 4**, dan **uv** sebagai package manager, dilengkapi fitur penyimpanan sesi profil pengguna (**stored user data / persistent browser profile**).

Dengan konfigurasi ini, sesi login, cookie, dan riwayat browsing disimpan secara lokal sehingga Anda tidak perlu login berulang kali (termasuk verifikasi 2FA/SSO) setiap kali script dijalankan.

---

## 🚀 Fitur Utama

- **`uv` Package Manager**: Manajemen environment dan dependensi Python ultra-cepat.
- **Selenium 4 Auto-Driver**: Driver Chrome otomatis dikelola oleh Selenium Manager bawaan (tanpa perlu download ChromeDriver manual).
- **Persistent Profile (`--user-data-dir`)**: Direktori data tersimpan (`.chrome_user_data/`) agar sesi login tetap aktif.
- **Anti-Bot Flag Mitigation**: Konfigurasi flag untuk meminimalkan deteksi bot pada form/LMS (`navigator.webdriver` disabled).
- **Context Manager Support**: Pembersihan otomatis instance Chrome via `with get_browser() as driver:`.

---

## 📁 Struktur File

```text
lms_forum_answer/
├── .chrome_user_data/      # Direktori lokal penyimpanan profil browser (auto-generated, git-ignored)
├── .env                    # Konfigurasi environment lokal (git-ignored)
├── .env.example            # Template konfigurasi environment
├── .gitignore              # Daftar file yang dikecualikan dari Git
├── browser.py              # Helper inisialisasi Selenium Chrome dengan stored user data
├── main.py                 # Entry point dan contoh penggunaan
├── pyproject.toml          # Deklarasi dependensi uv
└── uv.lock                 # Lockfile dependensi
```

---

## 🛠️ Cara Penggunaan

### 1. Sinkronisasi Dependensi dengan `uv`
Jika pertama kali clone atau setup:
```powershell
uv sync
```

### 2. Konfigurasi Environment (`.env`)
File `.env` sudah disediakan. Anda dapat menyesuaikan konfigurasi berikut jika diperlukan:
```env
CHROME_USER_DATA_DIR=./.chrome_user_data
CHROME_PROFILE_DIR=Default
HEADLESS=false
```

### 3. Login Pertama Kali (Mode Interaktif)
Jalankan script dengan flag `--interactive` agar browser terbuka dan tetap menunggu hingga Anda selesai login secara manual di browser:
```powershell
uv run python main.py --interactive
```
- Browser Chrome akan terbuka.
- Navigasi ke situs LMS Anda dan lakukan login (pastikan mencentang opsi *Remember Me* atau *Tetap Masuk* jika ada).
- Setelah login berhasil, tekan **[Enter]** pada terminal untuk menutup browser. Sesi login akan tersimpan di folder `.chrome_user_data`.

### 4. Menjalankan Otomasi
Jalankan script utama:
```powershell
uv run python main.py
```
Browser akan otomatis membuka sesi dengan profil yang sudah login sebelumnya.

---

## 📦 Menambah Dependensi Baru dengan `uv`

Untuk menambah package baru (misalnya `beautifulsoup4` atau `requests`):
```powershell
uv add beautifulsoup4 requests
```

Untuk menjalankan script Python apapun di dalam virtual environment:
```powershell
uv run python <nama_script>.py
```
