# ASAP — diagram alur

Tiga diagram untuk menjelaskan bagaimana sistem ini bekerja, dari satelit sampai ke layar aplikasi. Versi yang bisa dibuka langsung di browser: [`diagram.html`](diagram.html).

---

## 1. Dari satelit sampai layar

Yang perlu dipahami: **layar aplikasi tidak menampilkan data karangan.** Layar itu pembaca dari dua kontrak, dan kontrak itu diisi oleh skrip yang menarik file NASA.

```mermaid
flowchart LR
    subgraph sat["1 Satelit"]
        S1["NASA FIRMS VIIRS SNPP C2"]
    end

    subgraph orc["2 Oracle — skrip, siapa pun boleh jalankan"]
        O1["fetch-hotspots.py"]
        O2["commitBatch: fileHash + fileUrl"]
        O3["publish: 200 baris per transaksi"]
    end

    subgraph chain["3 Monad"]
        R["HotspotRegistry"]
        B["FireBounty"]
    end

    subgraph ui["4 Layar aplikasi"]
        U1["Screen 1 peta + counter"]
        U2["Screen 2 claim drawer"]
        U3["Screen 3 verifier queue"]
        U4["Screen 4 verified + payout"]
    end

    S1 --> O1
    O1 --> O2 --> R
    O1 --> O3 --> R
    R --> B
    B -- "BountyOpened" --> U1
    U1 -- "getHotspot dan pool" --> R
    U2 -- "claim + bond" --> B
    B -- "ClaimSubmitted" --> U3
    U3 -- "attest" --> B
    B -- "ClaimVerified" --> U4
```

**Cara membacanya:** panah ke kanan adalah uang dan state, panah ke kiri adalah bacaan. Layar 1 adalah pembaca pasif. Layar 2 dan 3 adalah satu-satunya tempat transaksi dikirim. Layar 4 bukan halaman terpisah — dia layar 2 setelah state berubah.

**Bagian yang belum ada:** panah dari layar 2 dan 3 ke `FireBounty` belum tersambung karena aplikasinya belum dibangun. Kontraknya sudah siap dan lulus 7 test; UI-nya pekerjaan block berikutnya.

---

## 2. Ke mana uangnya pergi

Pertanyaan pertama setiap juri. Semua angka di bawah ada di `FireBounty.sol`.

```mermaid
flowchart LR
    BK["Backer — konsesi, CSR, proyek karbon"] -- "1.000 MON" --> POOL["Escrow FireBounty 2.000 MON"]
    RS["Responder"] -- "1.000 MON bond" --> POOL
    POOL -- "1.900 MON payout" --> RS
    POOL -- "0.100 MON reward" --> VR["2 verifier, 0.050 masing-masing"]
```

Bond = 100% pool. Artinya kalau bounty Rp 350.000, responder menyetor bond senilai itu juga, dan menerima **1,8× pool** saat lolos — bounty plus bond kembali, dipotong 10% untuk verifier.

Kalau verifier menolak:

```mermaid
flowchart LR
    BOND["Bond responder 1.000 MON"] -- "500 MON" --> BK2["Kembali ke backer"]
    BOND -- "500 MON" --> VJ["Dibagi ke 2 verifier penolak"]
    POOL2["Pool bounty"] --> RE["Bounty dibuka lagi selama deadline belum lewat"]
```

**Konsekuensi desain yang harus kamu hafal:** nilai bond lebih besar dari imbalan maksimal sebuah kebohongan, jadi melapor palsu selalu merugi. Tapi konsekuensi lainnya — relawan miskin tidak bisa ikut. Itu trade-off yang kita pilih sadar, dan ada di bagian limitasi spec.

---

## 3. Arti warna titik di peta

Ini yang kamu klik-klik tadi, dipetakan ke state kontrak:

```mermaid
stateDiagram-v2
    [*] --> Open: openBounty
    Open --> Claimed: claim + bond
    Claimed --> Verified: 2 approvals
    Claimed --> Open: 2 rejections, bond slashed
    Open --> Expired: deadline lewat
    Claimed --> Expired: tidak ada quorum sampai grace
    Verified --> [*]
    Expired --> [*]
```

| Warna | State | Arti di pitch |
|---|---|---|
| Amber | Open | Ada uang menunggu, belum ada yang datang |
| Biru | Claimed | Seseorang sudah menyetor bond dan menyerahkan bukti |
| Hijau | Verified | Dua verifier setuju, payout sudah jalan |
| Merah | Expired | **Ada uang, tidak ada yang datang** — ini produknya |

---

## 4. Kenapa merah lebih penting dari hijau

```mermaid
flowchart TD
    H["22.760 deteksi / 24 jam"] --> BQ["Bounty dibuka"]
    BQ --> ANS{"Ada yang datang dalam 6 jam?"}
    ANS -- "Ya" --> V["Verified: api ditangani, bukti on-chain"]
    ANS -- "Tidak" --> E["Expired: tercatat publik bahwa tidak ada yang datang"]
    E --> P["Tekanan publik ke pemegang konsesi"]
    V --> R2["Budget pertahanan api terbukti bekerja"]
    P --> BQ
    R2 --> BQ
```

Sistem lain berhenti di "api terdeteksi". Yang kita jual adalah baris terakhir: **catatan publik tentang api yang dibiarkan.** Itu yang tidak dimiliki SiPongi, dan itu yang membuat bounty berikutnya lebih mungkin dibayar.
