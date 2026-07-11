# WhatsApp AI Gateway
**Evolution API + Claude Code CLI | macOS Local Setup**

---

## Prasyarat

- Node.js >= 18
- Claude Code CLI sudah terinstall & login (`claude --version`)
- Evolution API sudah running via Docker
- Instance WhatsApp sudah terhubung di Evolution API

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
MASTER_NUMBER=628xxxxxxxxxx       # Nomor WA kamu (tanpa + atau spasi)
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=your-api-key    # Dari Evolution API dashboard
EVOLUTION_INSTANCE=nama-instance  # Nama instance di Evolution API
PORT=3000

# WA Sender (opsional — Pub/Sub → WhatsApp). Kosongkan untuk menonaktifkan.
WHATSAPP_TOPIC=whatsapp-outbound
WHATSAPP_SUBSCRIPTION=             # Default: <topic>-wa-sender
GCP_PROJECT_ID=                    # Opsional — diinfer dari ADC/emulator
```

### 3. Jalankan Gateway

```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```

### 4. Daftarkan Webhook ke Evolution API

Di Evolution API, set webhook URL ke:
```
http://localhost:3000/webhook
```

Atau via API:
```bash
curl -X POST http://localhost:8080/webhook/set/INSTANCE_NAME \
  -H "apikey: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://localhost:3000/webhook",
    "events": ["messages.upsert"]
  }'
```

> **Note untuk lokal macOS**: Jika Evolution API jalan di Docker dan Gateway di host,
> gunakan `http://host.docker.internal:3000/webhook` sebagai URL webhook.

---

## Cara Pakai

### Pesan biasa
Kirim pesan apapun ke nomor WA instance → Claude akan menjawab

### Commands (ketik di WA)

| Command | Role | Keterangan |
|---|---|---|
| `/help` | Semua | Daftar command |
| `/whoami` | Semua | Info akun & kuota |
| `/reset` | Semua | Reset history percakapan |
| `/add 628xxx user` | Master/Admin | Tambah nomor |
| `/remove 628xxx` | Master | Hapus nomor |
| `/role 628xxx admin` | Master | Ubah role |
| `/block 628xxx` | Master | Blokir nomor |
| `/list` | Master/Admin | Daftar nomor |
| `/stats` | Master | Statistik sistem |

### Role & Limits

| Role | Limit/hari | Bisa assign |
|---|---|---|
| MASTER | Unlimited | admin, user, readonly |
| ADMIN | 500 | user |
| USER | 100 | - |
| READONLY | 20 | - |
| BLOCKED | 0 | - |

---

## WA Sender — Notifikasi HR Platform via WhatsApp

Selain membalas chat masuk, Gateway juga bisa **mengirim notifikasi** dari HR
Platform ke penerima lewat WhatsApp. HR Platform tidak bicara langsung ke
WhatsApp — ia mem-*publish* pesan ke topic **Google Cloud Pub/Sub**, lalu
Gateway (sebagai *WA Sender*) meng-*subscribe* topic itu dan mengantar pesannya.

```
HR Platform ──► Pub/Sub topic (WHATSAPP_TOPIC) ──► WA Sender (gateway ini) ──► Evolution API ──► WhatsApp
```

### Aktivasi

Set `WHATSAPP_TOPIC` di `.env` (mis. `whatsapp-outbound`). Kalau **kosong**,
fitur ini **dormant** (tidak subscribe apa-apa) — aman untuk deploy sebelum
topic-nya ada.

| Env | Wajib? | Keterangan |
|---|---|---|
| `WHATSAPP_TOPIC` | untuk aktivasi | Nama topic Pub/Sub. Kosong = fitur mati. |
| `WHATSAPP_SUBSCRIPTION` | tidak | Nama subscription. Default `<topic>-wa-sender` (mis. `whatsapp-outbound-wa-sender`). Dibuat otomatis jika belum ada. |
| `GCP_PROJECT_ID` | tidak | Project id GCP. Diinfer dari ADC / emulator jika kosong. |
| `PUBSUB_EMULATOR_HOST` | tidak | Set (mis. `localhost:8085`) untuk pakai emulator offline. |

### Kredensial (Pub/Sub asli)

Gateway pakai Application Default Credentials:

```bash
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID
```

Service account-nya perlu `roles/pubsub.subscriber` pada subscription, dan
`roles/pubsub.editor` bila ingin subscription dibuat otomatis.

### Cara kerja (kontrak)

- **Payload**: JSON schema `version: "1"` — `message.title`, `message.body`,
  `message.link` dirakit jadi satu pesan WhatsApp; dikirim ke
  `recipient.phone` (sudah format E.164, apa adanya).
- **Dedup**: delivery Pub/Sub *at-least-once*, jadi tiap `source.notificationId`
  hanya dikirim sekali (disimpan di tabel `notification_dedup`).
- **ack/nack**: sukses kirim → `ack`; gagal transient → `nack` (Pub/Sub retry);
  JSON rusak / tanpa nomor / `version` lebih baru dari yang didukung → `ack`
  (skip, tidak crash).

### Tes cepat dengan emulator

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
whatsapp-ai-gateway/
├── index.js                    # Entry point
├── .env                        # Config (jangan di-commit!)
├── data/                       # SQLite database (auto-created)
├── logs/                       # Log files (auto-created)
└── src/
    ├── db/index.js             # Database + schema
    ├── auth/numberRegistry.js  # Auth & role management
    ├── claude/
    │   ├── client.js           # Claude Code CLI integration
    │   └── historyManager.js   # Conversation history
    ├── evolution/sender.js     # Kirim pesan via Evolution API
    ├── notifications/          # WA Sender (Pub/Sub → WhatsApp)
    │   ├── subscriber.js       # Subscribe, dedup, ack/nack
    │   └── formatMessage.js    # Payload notifikasi → teks WhatsApp
    ├── commands/index.js       # Command handler
    ├── webhook/receiver.js     # Webhook processor
    └── utils/logger.js         # Winston logger
```

---

## Troubleshooting

**Claude tidak merespons?**
```bash
# Test manual
claude -p "halo" --output-format text
```

**Webhook tidak diterima?**
```bash
# Cek health endpoint
curl http://localhost:3000/health

# Lihat log
tail -f logs/gateway.log
```

**Database error?**
```bash
# Hapus dan buat ulang
rm -rf data/
npm start
```
