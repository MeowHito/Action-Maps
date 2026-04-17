'use client';
import dynamic from 'next/dynamic';

// Leaflet touches `window` at import time, so we disable SSR.
const MapClient = dynamic(() => import('./MapClient'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-full items-center justify-center text-sm text-zinc-500">
      Loading map…
    </div>
  ),
});

export default function EventPageClient({ slug }: { slug: string }) {
  return <MapClient slug={slug} />;
}
