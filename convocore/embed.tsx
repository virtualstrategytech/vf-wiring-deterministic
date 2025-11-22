import React, { useEffect, useMemo, useRef } from 'react';

type ConvocoreEmbedProps = {
  srcBase: string; // e.g., "https://app.convocore.yourdomain/dashboard"
  tenant?: string;
  user?: string;
  height?: number | string; // default 720
  className?: string;
  allow?: string; // e.g., "clipboard-write *; clipboard-read *"
  onEvent?: (evt: { type: string; payload?: unknown }) => void;
};

export default function ConvocoreEmbed({
  srcBase,
  tenant = 'default',
  user,
  height = 720,
  className,
  allow = 'clipboard-write *; clipboard-read *',
  onEvent,
}: ConvocoreEmbedProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const origin = useMemo(() => new URL(srcBase).origin, [srcBase]);
  const src = useMemo(() => {
    const u = new URL(srcBase);
    if (tenant) u.searchParams.set('tenant', tenant);
    if (user) u.searchParams.set('user', user);
    return u.toString();
  }, [srcBase, tenant, user]);

  useEffect(() => {
    const handler = (evt: MessageEvent) => {
      if (evt.origin !== origin) return;
      onEvent?.(evt.data);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [origin, onEvent]);

  return (
    <iframe
      ref={ref}
      src={src}
      style={{ width: '100%', height, border: 0, borderRadius: 14 }}
      className={className}
      allow={allow}
      loading="lazy"
    />
  );
}

