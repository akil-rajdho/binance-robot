import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '../src/contexts/AuthContext'
import AuthGuard from '../src/components/AuthGuard'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Bitcoin Robot',
  description: 'Automated BTC/USDT short trading bot',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-[#070B14] text-white min-h-screen`}>
        <AuthProvider>
          <AuthGuard>
            {children}
          </AuthGuard>
        </AuthProvider>
      </body>
    </html>
  )
}
