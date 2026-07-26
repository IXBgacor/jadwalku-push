# JadwalKu Push Server

Server kecil supaya notifikasi jadwal tetap terkirim walau aplikasi/browser
di HP sedang **tertutup total** — mirip cara kerja WhatsApp. Bekerja dengan
Web Push (VAPID): server menyimpan jadwal + "alamat push" tiap perangkat,
lalu tiap 1 menit mengecek dan mengirim notifikasi kalau waktunya sudah tiba.

## 1. Setup lokal

```bash
cd server
npm install
npm run generate-vapid
```

Perintah kedua akan mencetak `VAPID_PUBLIC_KEY` dan `VAPID_PRIVATE_KEY`.
Salin `.env.example` jadi `.env`, lalu isi dua nilai itu:

```bash
cp .env.example .env
# lalu edit .env, isi VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CONTACT_EMAIL
```

Jalankan server:

```bash
npm start
```

Server jalan di `http://localhost:3000`. Cek dengan buka URL itu di browser —
harus muncul JSON `{ "ok": true, ... }`.

## 2. Deploy ke internet (harus HTTPS)

Web Push **wajib HTTPS**. Pilihan termudah, gratis untuk pemakaian personal:

- **Render.com** — buat "Web Service" baru, hubungkan ke repo Git yang berisi
  folder `server/` ini. Set root directory ke `server`, build command
  `npm install`, start command `npm start`. Tambahkan environment variables
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT_EMAIL` di dashboard.
- **Railway.app** — mirip, hubungkan repo, set root ke `server`, isi env vars.
- **Fly.io** / **VPS sendiri** — juga bisa, tinggal `npm install && npm start`
  di belakang reverse proxy HTTPS (nginx + certbot, dsb).

⚠️ **Catatan tentang penyimpanan**: server ini pakai file `data/db.json` biar
sederhana. Di banyak platform gratis (termasuk Render free tier), disk itu
**tidak permanen** — bisa terhapus saat server di-restart/redeploy. Untuk
pemakaian jangka panjang, sebaiknya nanti diganti ke database asli (misalnya
Render Postgres gratis, atau SQLite dengan volume permanen). Untuk mencoba
fiturnya dulu, file JSON ini sudah cukup.

## 3. Hubungkan ke aplikasi JadwalKu

Setelah server online (misalnya `https://jadwalku-push.onrender.com`):

1. Buka JadwalKu di HP/browser
2. Masuk ke **Pengaturan → Notifikasi Push (Server)**
3. Masukkan URL server itu, simpan
4. Tekan **"Aktifkan Push"** — browser akan minta izin notifikasi (kalau
   belum), lalu otomatis mendaftar ke server
5. Setiap kali kamu ubah jadwal/pengaturan, aplikasi otomatis mengirim
   salinannya ke server supaya server tahu kapan & pesan apa yang harus
   dikirim

Selesai — sekarang notifikasi akan tetap masuk walau aplikasi ditutup,
selama HP kamu punya koneksi internet & baterai (OS tetap boleh membatasi
push di kondisi hemat baterai ekstrem, itu di luar kendali aplikasi).

## Endpoint API

| Method | Path                 | Fungsi                                      |
|--------|----------------------|----------------------------------------------|
| GET    | `/vapid-public-key`  | Ambil public key untuk subscribe di browser  |
| POST   | `/subscribe`         | Simpan push subscription per `deviceId`      |
| POST   | `/unsubscribe`       | Hapus subscription                           |
| POST   | `/sync`              | Kirim jadwal + pengaturan pesan ke server     |
