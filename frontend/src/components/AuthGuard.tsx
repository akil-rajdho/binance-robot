'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isAuthenticated && pathname !== '/login') {
      router.replace('/login');
    } else if (isAuthenticated && pathname === '/login') {
      router.replace('/');
    }
  }, [isAuthenticated, pathname, router]);

  // Show nothing while redirect is pending to avoid flash
  if (!isAuthenticated && pathname !== '/login') {
    return null;
  }

  return <>{children}</>;
}
