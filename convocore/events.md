# Convocore ↔ Host Events

All messages use `window.postMessage({ type, payload })`.

## Origins

- **Convocore origin:** `https://app.convocore.yourdomain` (replace with your prod host)
- **Always check `event.origin`** before acting on a message.

## Outbound (Convocore → Host)

- `vf:lesson:ready`
  - `payload`: `{ title: string, bulletCount: number, lessonMarkdown?: string }`
- `vf:quiz:ready`
  - `payload`: `{ lessonTitle: string, counts: { mcq: number, tf: number, open: number }, quizJSON?: object }`
- `vf:export:url`
  - `payload`: `{ url: string }` — a temporary public URL for the exported file.
- `vf:cal:open`
  - `payload`: `{ bookingUrl: string, prefill?: { name?: string; email?: string; notes?: string } }`
- `vf:error`
  - `payload`: `{ message: string, code?: string, meta?: any }`

## Inbound (Host → Convocore)

- `host:context`
  - `payload`: `{ plan?: "beta"|"pro"|"enterprise", flags?: { reduceMotion?: boolean } }`
- `host:request:export`
  - `payload`: `{ format: "md"|"pdf" }`
- `host:kb:query`
  - `payload`: `{ text: string }`
- `host:cal:open`
  - `payload`: `{ bookingUrl: string, prefill?: { name?: string; email?: string; notes?: string } }`

> You can extend these events at any time; keep namespaced prefixes.
