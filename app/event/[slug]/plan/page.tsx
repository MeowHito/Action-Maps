import PlanPageClient from './PlanPageClient';

export default async function PlanPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <PlanPageClient slug={slug} />;
}
