# Seeds

Seed **tidak** berupa file `.sql`, karena data awal (akun admin) membutuhkan
password hash **argon2id** yang harus dibuat oleh aplikasi — bukan ditulis tangan
ke dalam file SQL (itu berisiko membocorkan password ke repository).

Gunakan:

```bash
# isi SEED_ADMIN_* di .env terlebih dahulu
npm run db:seed
```

Script: `apps/api/src/scripts/seed-admin.ts` — idempoten (aman dijalankan ulang;
tidak akan menimpa admin yang sudah ada).
