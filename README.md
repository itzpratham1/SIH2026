# WeighGuard — Offline-First Legal Metrology Verification

Smart India Hackathon 2026 · Problem Statement 26036 · Ministry of Consumer Affairs, Legal Metrology Division

WeighGuard verifies weighing and measuring instruments offline with Ed25519-signed QR certificates, and prioritises re-inspection with a live confidence score.

## Tech Stack

- **Frontend**: Astro 7 + React 18 islands, TypeScript, CSS Modules
- **Backend**: FastAPI (Python), SQLite, Ed25519 signing, CBOR
- **PWA**: Service worker with cache-first offline support
- **Crypto**: tweetnacl (client-side), PyNaCl (server-side), cbor-x/cbor2

## Project Structure

```
/
├── backend/          # FastAPI signing & verification service
├── src/
│   ├── components/   # React islands + Astro components
│   ├── layouts/      # Base HTML layout
│   ├── lib/          # API client, CBOR codec, decay engine
│   ├── pages/        # Astro pages (static + dynamic routes)
│   └── styles/       # Global CSS + design tokens
├── public/           # PWA manifest, service worker, static data
└── scripts/          # Build & export utilities
```

## Commands

| Command | Action |
| :------ | :----- |
| `npm install` | Install dependencies |
| `npm run dev` | Start Astro dev server at `localhost:4322` |
| `npm run build` | Build production site to `./dist/` |
| `npm run preview` | Preview production build |
| `python -m backend.run_server` | Start FastAPI backend at `localhost:8001` |

## Architecture

- **Offline-first**: All verification works without network. CBOR certificates are verified client-side using bundled Ed25519 public key.
- **Trust decay**: Confidence scores decay over time based on verification history and usage patterns.
- **Multi-persona**: Citizen verification, LMO field inspection, trader portal, and admin dashboard.
- **Statutory compliance**: Schedule XI certificates and Schedule XII rejection notices conform to Legal Metrology (General) Rules, 2011.
