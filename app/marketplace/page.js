'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function MarketplaceIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/marketplace/enter');
  }, [router]);

  return null;
}

