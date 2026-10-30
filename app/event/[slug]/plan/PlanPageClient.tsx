'use client';

import dynamic from 'next/dynamic';
import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { getEventToken } from '@/lib/auth';

const Editor = dynamic(() => import('./editor/Editor'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-full items-center justify-center text-sm text-zinc-500">
      Loading editor…
    </div>
  ),
});

/** The plan editor sits behind the same access code as the event map. */
export default function PlanPageClient({ slug }: { slug: string }) {
  const router = useRouter();
  const allowed = useSyncExternalStore(
    () => () => {},
    () => !!getEventToken(slug),
    () => false,
  );

  useEffect(() => {
    if (!getEventToken(slug)) router.replace(`/event/${slug}`);
  }, [slug, router]);

  if (!allowed) return null;
  return <Editor slug={slug} />;
}
