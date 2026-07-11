# WA Sender
**Google Cloud Pub/Sub → WhatsApp (Evolution API)**

Konsumsi notifikasi dari Google Cloud Pub/Sub, lalu antar ke penerima lewat
WhatsApp. Aplikasi hulu (*publisher*) tidak bicara langsung ke WhatsApp — ia
mem-*publish* pesan ke topic **Pub/Sub**, lalu WA Sender meng-*subscribe* topic
itu dan mengirimkannya via **Evolution API**.

```
Publisher ──► Pub/Sub topic (WHATSAPP_TOPIC) ──► WA Sender ──► Evolution API ──► WhatsApp
```

---

## Prasyarat

- Node.js >= 18
- Evolution API sudah running & instance WhatsApp sudah terhubung
- Akses ke Google Cloud Pub/Sub (atau emulator untuk dev offline)

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Konfigurasi environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Evolution API
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=your-api-key    # Dari Evolution API dashboard
EVOLUTION_INSTANCE=nama-instance  # Nama instance di Evolution API

# Pub/Sub (kosongkan WHATSAPP_TOPIC untuk menonaktifkan / dormant)
WHATSAPP_TOPIC=whatsapp-outbound
WHATSAPP_SUBSCRIPTION=            # Default: <topic>-wa-sender
GCP_PROJECT_ID=                  # Opsional — diinfer dari ADC/emulator
```

### 3. Jalankan

```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```

---

## Aktivasi

Set `WHATSAPP_TOPIC` di `.env` (mis. `whatsapp-outbound`). Kalau **kosong**,
WA Sender **dormant** (tidak subscribe apa-apa) — aman untuk deploy sebelum
topic-nya ada.

| Env | Wajib? | Keterangan |
|---|---|---|
| `EVOLUTION_API_URL` | ya | URL Evolution API. |
| `EVOLUTION_API_KEY` | ya | API key Evolution API. |
| `EVOLUTION_INSTANCE` | ya | Nama instance WhatsApp. |
| `WHATSAPP_TOPIC` | untuk aktivasi | Nama topic Pub/Sub. Kosong = fitur mati. |
| `WHATSAPP_SUBSCRIPTION` | tidak | Nama subscription. Default `<topic>-wa-sender` (mis. `whatsapp-outbound-wa-sender`). Dibuat otomatis jika belum ada. |
| `GCP_PROJECT_ID` | tidak | Project id GCP. Diinfer dari ADC / emulator jika kosong. |
| `PUBSUB_EMULATOR_HOST` | tidak | Set (mis. `localhost:8085`) untuk pakai emulator offline. |
| `DB_PATH` | tidak | Path SQLite untuk dedup + log. Default `./data/gateway.db`. |

---

## Kredensial (Pub/Sub asli)

WA Sender pakai Application Default Credentials:

```bash
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID
```

Service account-nya perlu `roles/pubsub.subscriber` pada subscription, dan
`roles/pubsub.editor` bila ingin subscription dibuat otomatis.

---

## Cara kerja (kontrak)

- **Payload**: JSON schema `version: "1"` — `message.title`, `message.body`,
  `message.link` dirakit jadi satu pesan WhatsApp; dikirim ke
  `recipient.phone` (sudah format E.164, apa adanya).
- **Dedup**: delivery Pub/Sub *at-least-once*, jadi tiap `source.notificationId`
  hanya dikirim sekali (disimpan di tabel `notification_dedup`).
- **ack/nack**: sukses kirim → `ack`; gagal transient → `nack` (Pub/Sub retry);
  JSON rusak / tanpa nomor / `version` lebih baru dari yang didukung → `ack`
  (skip, tidak crash).

---

## Tes cepat dengan emulator

```bash
gcloud beta emulators pubsub start --host-port=localhost:8085   # shell 1

# shell 2
export PUBSUB_EMULATOR_HOST=localhost:8085
export PUBSUB_PROJECT_ID=local-dev
# set WHATSAPP_TOPIC=whatsapp-outbound & GCP_PROJECT_ID=local-dev di .env, lalu npm start
gcloud pubsub topics create whatsapp-outbound --project=local-dev
gcloud pubsub topics publish whatsapp-outbound --project=local-dev \
  --message='{"version":"1","channel":"whatsapp","tenantId":"acme","recipient":{"employeeId":"emp_123","phone":"+6281234567890"},"message":{"title":"Action required","body":"A request needs your review.","link":"https://app.example.com/approvals"},"source":{"notificationId":"ntf_test1","type":"approval_required"}}'
```

---

## Struktur File

```
wa-sender/
├── index.js                    # Entry point — bootstrap DB + subscriber
├── .env                        # Config (jangan di-commit!)
├── data/                       # SQLite database (auto-created)
├── logs/                       # Log files (auto-created)
└── src/
    ├── db/index.js             # Database + schema (dedup + log)
    ├── evolution/sender.js     # Kirim pesan via Evolution API
    ├── notifications/
    │   ├── subscriber.js       # Subscribe Pub/Sub, dedup, ack/nack
    │   └── formatMessage.js    # Payload notifikasi → teks WhatsApp
    └── utils/logger.js         # Winston logger
```

---

## Troubleshooting

**Pesan tidak terkirim?**
```bash
# Lihat log
tail -f logs/gateway.log
```

**Database error?**
```bash
# Hapus dan buat ulang
rm -rf data/
npm start
```
