import EventPageClient from './EventPageClient';

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <EventPageClient slug={slug} />;
}
