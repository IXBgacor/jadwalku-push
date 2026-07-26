'use strict';

/**
 * JadwalKu Push Server
 * ---------------------
 * Server kecil yang bertugas SATU hal saja: menyimpan jadwal + langganan push
 * tiap perangkat, lalu tiap menit mengecek apakah ada jadwal yang waktunya
 * sudah tiba, dan mengirim notifikasi via Web Push (VAPID) ke perangkat itu.
 *
 * Karena ini jalan di server (bukan di browser), notifikasi tetap terkirim
 * walau aplikasi/browser di HP sedang tertutup — mirip cara kerja WhatsApp.
 *
 * Penyimpanan pakai file JSON sederhana (data/db.json), cukup untuk
 * pemakaian personal. Untuk skala lebih besar, ganti ke database asli
 * (SQLite/Postgres/dst) — struktur data di bawah sudah dirancang supaya
 * mudah dipindah.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const webpush = require('web-push');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const NOTIF_GRACE_MINUTES = 2; // toleransi kecil di sisi server (cron jalan tiap menit)

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_CONTACT_EMAIL = process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@example.com';

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('❌ VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY belum diset di .env');
  console.error('   Jalankan dulu: npm run generate-vapid');
  process.exit(1);
}

webpush.setVapidDetails(VAPID_CONTACT_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

/* ---------------------------------------------------------
   Penyimpanan sederhana berbasis file JSON
   Struktur: { devices: { [deviceId]: { subscription, schedules, settings,
                                          timezone, notifiedDate, notifiedIds } } }
--------------------------------------------------------- */
function loadDb() {
  try {
    if (!fs.existsSync(DB_PATH)) return { devices: {} };
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    console.error('Gagal membaca db.json, mulai dari kosong:', e.message);
    return { devices: {} };
  }
}
function saveDb(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

let db = loadDb();

/* ---------------------------------------------------------
   App
--------------------------------------------------------- */
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/', (req, res) => {
  res.json({ ok: true, name: 'JadwalKu Push Server', devices: Object.keys(db.devices).length });
});

app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Simpan/update push subscription untuk sebuah deviceId
app.post('/subscribe', (req, res) => {
  const { deviceId, subscription } = req.body || {};
  if (!deviceId || !subscription || !subscription.endpoint) {
    return res.status(400).json({ ok: false, error: 'deviceId dan subscription wajib diisi' });
  }
  db.devices[deviceId] = db.devices[deviceId] || {};
  db.devices[deviceId].subscription = subscription;
  saveDb(db);
  res.json({ ok: true });
});

app.post('/unsubscribe', (req, res) => {
  const { deviceId } = req.body || {};
  if (deviceId && db.devices[deviceId]) {
    delete db.devices[deviceId].subscription;
    saveDb(db);
  }
  res.json({ ok: true });
});

// Sinkronisasi jadwal + pengaturan pesan dari app ke server
// (server butuh ini supaya tahu KAPAN dan APA isi pesan yang harus dikirim)
app.post('/sync', (req, res) => {
  const { deviceId, schedules, settings, timezone } = req.body || {};
  if (!deviceId) return res.status(400).json({ ok: false, error: 'deviceId wajib diisi' });

  db.devices[deviceId] = db.devices[deviceId] || {};
  db.devices[deviceId].schedules = Array.isArray(schedules) ? schedules : [];
  db.devices[deviceId].settings = settings || {};
  db.devices[deviceId].timezone = timezone || 'Asia/Jakarta';
  saveDb(db);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`✅ JadwalKu Push Server jalan di port ${PORT}`);
});

/* ---------------------------------------------------------
   Cron: jalan tiap menit, cek semua device, kirim push
   kalau ada jadwal yang waktunya pas/baru saja lewat.
--------------------------------------------------------- */
const DAY_KEYS_BY_JS_INDEX = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];

function getLocalPartsInTimezone(date, timezone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
  const parts = fmt.formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const weekdayMap = { Sun: 'minggu', Mon: 'senin', Tue: 'selasa', Wed: 'rabu', Thu: 'kamis', Fri: 'jumat', Sat: 'sabtu' };
  const hh = parts.hour === '24' ? '00' : parts.hour; // Intl quirk safeguard
  return {
    dayKey: weekdayMap[parts.weekday],
    hhmm: `${hh}:${parts.minute}`,
    minutes: parseInt(hh, 10) * 60 + parseInt(parts.minute, 10),
    dateStr: new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date) // YYYY-MM-DD
  };
}

async function sendPushToDevice(deviceId, device, schedule) {
  const s = device.settings || {};
  const title = s.senderName || 'JadwalKu';
  const body = `${s.openMsg || ''}\n\nHari ini ada:\n${schedule.title}\n${(schedule.time || '').replace(':', '.')}\n\n${s.closeMsg || ''}`;
  const payload = JSON.stringify({
    title,
    body,
    icon: s.senderPhoto || undefined,
    badge: undefined,
    tag: 'jadwalku-' + schedule.id
  });

  try {
    await webpush.sendNotification(device.subscription, payload);
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      // Subscription sudah tidak berlaku (user uninstall/clear data) -> bersihkan
      console.log(`Subscription device ${deviceId} sudah tidak valid, dihapus.`);
      delete device.subscription;
    } else {
      console.error(`Gagal kirim push ke ${deviceId}:`, err.message);
    }
  }
}

async function checkAllDevicesAndSend() {
  const now = new Date();
  let changed = false;

  for (const [deviceId, device] of Object.entries(db.devices)) {
    if (!device.subscription || !Array.isArray(device.schedules)) continue;

    const tz = device.timezone || 'Asia/Jakarta';
    const local = getLocalPartsInTimezone(now, tz);

    if (device.notifiedDate !== local.dateStr) {
      device.notifiedDate = local.dateStr;
      device.notifiedIds = [];
      changed = true;
    }
    device.notifiedIds = device.notifiedIds || [];

    const todays = device.schedules.filter(s => s.active && s.day === local.dayKey);

    for (const s of todays) {
      if (device.notifiedIds.includes(s.id)) continue;
      const [hh, mm] = (s.time || '00:00').split(':').map(Number);
      const schedMinutes = hh * 60 + mm;
      const diff = local.minutes - schedMinutes;
      if (diff >= 0 && diff <= NOTIF_GRACE_MINUTES) {
        await sendPushToDevice(deviceId, device, s);
        device.notifiedIds.push(s.id);
        changed = true;
      }
    }
  }

  if (changed) saveDb(db);
}

cron.schedule('* * * * *', () => {
  checkAllDevicesAndSend().catch(e => console.error('Cron error:', e));
});

console.log('⏱  Cron pengecekan jadwal aktif (tiap 1 menit).');
