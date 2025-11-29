# Convocore Embed Kit

This folder holds tiny, framework-agnostic helpers for embedding your Convocore dashboard/app and wiring booking + events.

## Files

- `embed.html` – static iframe wrapper you can host anywhere.
- `embed.tsx` – React component version with a typed API.
- `events.md` – the postMessage contract between Host ⇄ Convocore.
- `cal-template.md` – ready-to-use Cal.com URL patterns.
- `CalButton.tsx` – React button that opens a Cal.com booking (prefill supported).

## Quick Start (React / Vite / Next.js)

1. Import the iframe component:

```tsx
import ConvocoreEmbed from "./embed";

export default function Page() {
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <ConvocoreEmbed
        srcBase="https://app.convocore.yourdomain/dashboard" // ← CHANGE
        tenant="default"
        user="demo@virtualstrategytech.com"
        onEvent={(evt) => {
          if (evt.type === "vf:export:url")
            window.open(evt.payload.url, "_blank");
          if (evt.type === "vf:error") console.error(evt.payload);
        }}
      />
    </div>
  );
}
```
