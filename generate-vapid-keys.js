// Jalankan sekali: node generate-vapid-keys.js
// Hasilnya (publicKey & privateKey) dipakai untuk isi file .env
const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();
console.log('\n=== VAPID KEYS (simpan baik-baik, jangan dibagikan) ===\n');
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('\nSalin dua baris di atas ke file .env di folder server ini.\n');
