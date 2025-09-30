/*If you proxy Convocore behind your domain (recommended), set srcBase to that origin and keep the origin check in sync.*/

import React, { useMemo } from "react";

type Prefill = {
  name?: string;
  email?: string;
  notes?: string;
};

type CalButtonProps = {
  /** Base Cal.com URL, e.g. https://cal.com/YOUR_HANDLE/30min */
  bookingUrl: string;
  /** Optional prefill for name/email/notes */
  prefill?: Prefill;
  /** Open in a new tab instead of same tab */
  newTab?: boolean;
  /** Extra query params (e.g., theme=dark, hide_event_type_details=true) */
  params?: Record<string, string | number | boolean | undefined>;
  /** Button text */
  children?: React.ReactNode;
  /** Classnames (Tailwind-friendly) */
  className?: string;
  /** Callback after opening the link */
  onOpen?: (finalUrl: string) => void;
};

/**
 * Minimal, styled-agnostic button that opens your Cal.com booking link
 * with safe prefill (name/email/notes) and optional params.
 */
export default function CalButton({
  bookingUrl,
  prefill,
  newTab = true,
  params,
  children = "Book a consultation",
  className,
  onOpen,
}: CalButtonProps) {
  const finalUrl = useMemo(() => {
    const u = new URL(bookingUrl);
    if (prefill?.name) u.searchParams.set("name", prefill.name);
    if (prefill?.email) u.searchParams.set("email", prefill.email);
    if (prefill?.notes) u.searchParams.set("notes", prefill.notes);

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v === undefined) return;
        u.searchParams.set(k, String(v));
      });
    }

    // Sensible defaults for a clean embed/experience
    if (!u.searchParams.has("theme")) u.searchParams.set("theme", "dark");
    if (!u.searchParams.has("hide_event_type_details")) {
      u.searchParams.set("hide_event_type_details", "true");
    }

    return u.toString();
  }, [bookingUrl, prefill?.name, prefill?.email, prefill?.notes, params]);

  const openCal = () => {
    if (newTab) {
      window.open(finalUrl, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = finalUrl;
    }
    onOpen?.(finalUrl);
  };

  return (
    <button
      type="button"
      onClick={openCal}
      aria-label="Book a consultation"
      className={
        className ??
        // default neutral style (Tailwind-friendly)
        "inline-flex items-center gap-2 rounded-xl px-4 py-2 font-semibold " +
          "bg-blue-600 text-white hover:bg-blue-500 active:bg-blue-700 " +
          "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-400"
      }
    >
      {/* You can swap this for an icon if you use lucide-react */}
      <span>📅</span>
      <span>{children}</span>
    </button>
  );
}

// Example usage:
// <CalButton
//   bookingUrl="https://cal.com/YOUR_HANDLE/30min"
//   prefill={{ name: "Alex", email: "alex@acme.com", notes: "From Convocore" }}
// />;
// Example if you saved a ref to the iframe inside embed.tsx (already supported internally via onEvent)
