# 🎓 BINUS LMS Assistant & MCP Server

Aplikasi web lokal mandiri dan **Model Context Protocol (MCP) Server** berbasis **FastAPI**, **Jinja2**, **vanilla JavaScript**, dan **uv** untuk memantau diskusi forum, manajemen jadwal tugas/asesmen, presensi tatap muka virtual, serta automasi AI assistant langsung dengan [BINUS LMS](https://lms.binus.ac.id/lms).

---

## 🚀 Fitur Utama

### 💬 1. Forum Discussion Assistant (`/forum`)
- **Feed Interaktif Berbasis Kartu**: Setiap pertanyaan/thread dosen disajikan dalam kartu yang rapi lengkap dengan nomor sesi, topik perkuliahan, nama dosen, dan tanggal posting.
- **Indikator Status Jawaban**:
  - 🟢 **Replied by You**: Menampilkan tanggal submit dan preview jawaban yang telah Anda kirimkan.
  - 🟠 **Not Replied Yet**: Menandai forum yang masih butuh jawaban.
- **Direct Answer Submission**: Form submit jawaban langsung dari kartu tanpa perlu membuka LMS manual. Status otomatis berubah ke hijau (🟢) secara instan tanpa reload halaman (*optimistic UI*).
- **Deep-Link ke Portal LMS**: Akses langsung ke thread spesifik di portal BINUS LMS dengan 1 klik.
- **Drawer Komentar & Balasan**: Telusuri semua komentar mahasiswa lain dan dosen pada suatu thread secara mendalam.
- **Filter Cepat**: Filter berdasarkan mata kuliah (termasuk komponen LEC & LAB), per sesi pertemuan, atau tampilkan thread yang belum dijawab saja (*Show Unanswered Only*).

### 📅 2. Schedule & Assessment Dashboard (`/schedule`)
- **Timeline Asesmen Lengkap**: Menggabungkan seluruh tugas individu (*Individual Assignment*), tugas kelompok (*Team Assignment*), kuis, dan aktivitas forum dalam satu dasbor terpadu.
- **Tracking Deadline & Countdown**: Diurutkan otomatis berdasarkan tenggat waktu terdekat, dilengkapi badge waktu sisa dan penanda *urgent* / *overdue*.
- **Status & Penilaian**: Pantau status pengerjaan (*Submitted* / *Not Submitted*), status penilaian (*Scored* / *Not Scored*), serta nilai/skor tugas yang telah dinilai.
- **Info Tim / Kelompok**: Menampilkan daftar anggota kelompok dan ID tim secara otomatis untuk tugas kelompok (*Group Assignment*).
- **Download Dokumen Soal**: Unduh berkas materi, lembar kerja, atau lampiran soal tugas secara langsung melalui tombol download.
- **Link Presensi & Video Conference (Zoom/Teams)**: Mendeteksi link pertemuan virtual kuliah tatap muka dan presensi, memungkinkan Anda bergabung langsung dengan 1 klik.
- **Deep-Link Asesmen**: Tautan langsung ke laman pengumpulan tugas di LMS.

### 🤖 3. Model Context Protocol (MCP) Server
- Menyediakan endpoint MCP standar industri via **HTTP Streamable** (`/mcp`) dan **Stdio** (`--mcp-stdio`).
- Terhubung langsung ke AI Assistant (Antigravity, Claude Desktop, Cursor, dll.) untuk mengambil jadwal, menganalisis soal forum, menyusun draf jawaban, hingga submit jawaban secara otomatis.

### ⚡ 4. Smart Auth & Performa Tinggi
- **Performa Ringan**: Dibangun tanpa framework JavaScript yang berat (pure HTML5, CSS3, modern Vanilla JS).
- **Multi-threading**: Fetching data secara paralel menggunakan `ThreadPoolExecutor` untuk memuat sesi, thread, dan asesmen secara instan.
- **Profil Chrome Persisten (`.chrome_user_data/`)**: Menjaga sesi login SSO BINUS dan cookies tetap aman di lingkungan lokal.
- **Cache Token Cerdas (`.auth_cache.json`)**: Token didekripsi otomatis dengan AES key LMS (`%v$4T!9CRqE_[G-=`) dan disimpan di cache lokal untuk startup super cepat (< 100ms).

---

## 📁 Struktur Proyek

```text
lms_forum_answer/
├── .chrome_user_data/        # Profil Chrome lokal (cookies, session SSO)
├── .auth_cache.json          # Cache token JWT & headers APIM terdekripsi
├── lms_auth.py               # Otomasi login Selenium & ekstraksi token JWT
├── lms_api.py                # Klien HTTP Azure APIM (courses, sessions, threads, assessments)
├── server.py                 # FastAPI backend server & MCP streamable mount (/mcp)
├── mcp_server.py             # Definisi MCPServer & 12 tool functions
├── browser.py                # Helper konfigurasi Chrome driver Selenium
├── main.py                   # Entry point aplikasi (CLI flag handler & browser launcher)
├── ecosystem.config.js       # Konfigurasi process manager PM2
├── pyproject.toml            # Definisi proyek & dependensi uv
├── templates/                # Jinja2 HTML templates
│   ├── layouts/
│   │   └── base.html         # Template layout induk
│   ├── components/
│   │   ├── header.html       # Header navigasi & profil user
│   │   └── sidebar.html      # Sidebar menu (Forum & Schedule)
│   ├── forum.html            # Halaman Forum Discussion Assistant
│   └── schedule.html         # Halaman Schedule & Assessment Dashboard
├── static/                   # Aset frontend statis
│   ├── css/
│   │   ├── base.css          # CSS global (theme, layout, typography)
│   │   ├── forum.css         # Styling khusus halaman forum
│   │   └── schedule.css      # Styling khusus halaman schedule/assessment
│   └── js/
│       ├── common.js         # Utilitas umum & handler re-login
│       ├── forum.js          # Logika frontend forum & submit jawaban
│       └── schedule.js       # Logika frontend schedule, filter, modal tim & dokumen
└── README.md                 # Dokumentasi proyek
```

---

## 🛠️ Instalasi & Menjalankan Aplikasi

### 1. Prasyarat
- [Python](https://www.python.org/) 3.10+
- [uv](https://github.com/astral-sh/uv) (Package & project manager modern untuk Python)
- Google Chrome terinstal di sistem

### 2. Sinkronisasi Dependensi
Install dan sinkronkan seluruh library yang dibutuhkan dengan satu perintah:
```powershell
uv sync
```

### 3. Menjalankan Aplikasi Web
Jalankan aplikasi dengan perintah:
```powershell
uv run python main.py
```
Browser default Anda akan otomatis terbuka ke:
👉 **`http://127.0.0.1:8000`**

#### 💡 Pilihan Parameter CLI:
| Parameter | Deskripsi |
|---|---|
| *(tanpa parameter)* | Menjalankan web server dan otomatis membuka browser ke Web UI. |
| `--no-browser` | Menjalankan web server tanpa otomatis membuka browser. |
| `--login` | Membuka browser interaktif untuk login ulang SSO BINUS LMS. |
| `--mcp-stdio` / `--stdio` | Menjalankan server dalam mode MCP Stdio transport untuk klien AI. |

---

### 4. Menjalankan di Background dengan PM2 (Rekomendasi)
Agar web server dan MCP endpoint selalu berjalan di background tanpa jendela terminal dan aktif otomatis saat PC dinyalakan:

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

3. **Simpan status proses agar otomatis berjalan saat boot**:
   ```powershell
   pm2 save
   ```

4. **Perintah Berguna PM2**:
   - Cek status: `pm2 status`
   - Pantau logs: `pm2 logs lms-forum`
   - Restart server: `pm2 restart lms-forum`
   - Hentikan server: `pm2 stop lms-forum`

---

### 5. Login Ulang (*Token Expiration*)
Token autentikasi LMS memiliki masa berlaku. Jika sesi kedaluwarsa atau terjadi galat autentikasi:
- Klik tombol **"🔑 Re-Login"** pada header navigasi web, atau
- Jalankan via terminal:
  ```powershell
  uv run python main.py --login
  ```
Browser Chrome akan terbuka. Silakan login ke akun BINUS Anda. Sesi baru akan diekstraksi dan dicache secara otomatis.

---

## 🌐 Navigasi Web & REST API

### Halaman Web:
- **`http://127.0.0.1:8000/forum`** — Dasbor monitoring dan penjawab diskusi forum dosen.
- **`http://127.0.0.1:8000/schedule`** — Dasbor kalender tugas, kuis, asesmen kelompok, dan tautan Zoom.

### Endpoint REST API:
| Method | Endpoint | Keterangan |
|---|---|---|
| `GET` | `/api/init` | Mengambil data sesi pengguna, periode aktif, dan daftar mata kuliah. |
| `GET` | `/api/subjects` | Mengambil mata kuliah pada periode tertentu (`period`, `include_lab`). |
| `GET` | `/api/sessions` | Mengambil daftar sesi pertemuan untuk `class_id`. |
| `GET` | `/api/posts` | Mengambil thread forum dosen beserta status balasan pengguna. |
| `GET` | `/api/comments` | Mengambil komentar/jawaban mahasiswa pada thread forum tertentu. |
| `POST` | `/api/answer` | Mengirim jawaban balasan forum via API LMS. |
| `GET` | `/api/schedule/assessments` | Mengambil daftar seluruh asesmen tugas/kuis beserta deadline dan skor. |
| `GET` | `/api/schedule/team` | Mengambil informasi grup/anggota tim untuk asesmen kelompok. |
| `GET` | `/api/schedule/assessment-documents` | Mengambil daftar file/dokumen soal pendukung tugas. |
| `GET` | `/api/schedule/download-document` | Proxy unduh dokumen tugas langsung ke browser. |
| `GET` | `/api/schedule/attendance-link` | Mengambil link sesi tatap muka virtual (Zoom/Teams) dan presensi. |
| `POST` | `/api/relogin` | Memicu alur login ulang interaktif via Chrome. |

---

## 🤖 Integrasi Model Context Protocol (MCP)

Server ini mengimplementasikan protokol **Model Context Protocol (MCP)**, memungkinkan AI Assistant (Antigravity, Claude Desktop, Cursor, Roo Code, dll.) mengakses data LMS secara langsung.

### 1. HTTP Transport (Streamable HTTP)
Gunakan opsi ini jika aplikasi web atau PM2 sedang berjalan di background:
- **URL**: `http://127.0.0.1:8000/mcp`

Contoh konfigurasi MCP client (`claude_desktop_config.json` atau format konfigurasi MCP lainnya):
```json
{
  "mcpServers": {
    "binus-lms": {
      "url": "http://127.0.0.1:8000/mcp"
    }
  }
}
```

### 2. Stdio Transport
Gunakan opsi ini jika ingin klien AI menjalankan script MCP secara mandiri sesuai kebutuhan:
```json
{
  "mcpServers": {
    "binus-lms": {
      "command": "uv",
      "args": ["run", "python", "main.py", "--mcp-stdio"]
    }
  }
}
```

---

### 📋 Daftar Tool MCP yang Tersedia:

| Tool | Parameter | Deskripsi |
|---|---|---|
| `init_session` | *None* | Mengambil profil user, daftar periode akademik, periode aktif, dan daftar mata kuliah. |
| `get_subjects` | `period: str`, `include_lab: bool = False` | Mengambil daftar mata kuliah terdaftar pada periode tertentu. |
| `get_sessions` | `class_id: str` | Mengambil daftar sesi pertemuan dan sesi aktif pada suatu kelas. |
| `get_posts` | `class_id: str`, `session_id: Optional[str]` | Mengambil thread forum dosen pada sesi kelas tertentu beserta status apakah Anda sudah menjawab. |
| `get_thread_detail` | `class_id: str`, `thread_id: str` | Mengambil isi lengkap pertanyaan thread forum dosen dalam bentuk teks polos (*clean plain text*). |
| `get_comments` | `class_id: str`, `thread_id: str`, `page: int = 1`, `limit: int = 25` | Mengambil daftar komentar/balasan mahasiswa & dosen pada suatu thread forum. |
| `post_answer` | `thread_id: str`, `answer_text: str`, `class_id: Optional[str]`, `session_id: Optional[str]` | Mengirim jawaban/balasan forum Anda langsung ke sistem BINUS LMS. |
| `get_schedule_assessments` | `period: Optional[str]`, `force_refresh: bool = False` | Mengambil seluruh tugas, kuis, dan asesmen beserta tenggat waktu, skor, dan status submission. |
| `get_schedule_team` | `class_id: str`, `assessment_group_id: Optional[str]`, `force_refresh: bool = False` | Mengambil data kelompok belajar dan daftar anggota tim untuk tugas kelompok. |
| `get_assessment_documents` | `class_id: str`, `resource_id: str`, `assessment_id: Optional[str]` | Mengambil metadata dan tautan berkas dokumen soal dari suatu asesmen tugas. |
| `get_attendance_link` | `class_id: str`, `session_id: str`, `resource_id: Optional[str]` | Mengambil tautan presensi dan tatap muka virtual (Zoom/Teams). |
| `relogin` | *None* | Memicu browser interaktif untuk memperbarui sesi autentikasi yang kedaluwarsa. |

---

## 🔒 Keamanan & Privasi

- Kredensial dan token disimpan secara eksklusif di mesin lokal Anda (`.auth_cache.json` & `.chrome_user_data/`).
- Berkas sesi dan cache sudah otomatis dimasukkan ke dalam `.gitignore` sehingga tidak akan terunggah ke repositori Git publik.
- Aplikasi ini berkomunikasi secara langsung ke endpoint resmi Azure APIM BINUS LMS (`lms.binus.ac.id`) tanpa perantara server pihak ketiga manapun.
