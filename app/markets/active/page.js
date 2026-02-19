import { redirect } from 'next/navigation';

function firstParam(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function LegacyActiveMarketsPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const params = new URLSearchParams();
  params.set('status', 'active');

  const category = firstParam(resolvedSearchParams?.category);
  const sort = firstParam(resolvedSearchParams?.sort);
  const query = firstParam(resolvedSearchParams?.q);

  if (category) params.set('category', category);
  if (sort) params.set('sort', sort);
  if (query) params.set('q', query);

  redirect(`/markets?${params.toString()}`);
}
