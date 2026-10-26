import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { BrandingProvider } from '@/context/BrandingContext';
import { A11yEnhancements } from '@/components/A11yEnhancements';
import { LocaleProvider } from '@/lib/i18n';
import { LOCALE_COOKIE, resolveLocale } from '@/lib/i18n-core';

export const metadata: Metadata = {
  title: 'GuruGyan Learning Management System',
  description: 'GuruGyan Enterprise Multi-Tenant Learning Management System',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The person's own choice (cookie) wins, else the browser's Accept-Language, else English.
  const locale = resolveLocale({
    chosen: (await cookies()).get(LOCALE_COOKIE)?.value,
    acceptLanguage: (await headers()).get('accept-language'),
  });
  return (
    <html lang={locale} className="dark">
      <body className="min-h-screen bg-slate-950 antialiased text-slate-100 transition-colors duration-200">
        <LocaleProvider initial={locale}>
          <ThemeProvider>
            <BrandingProvider>
              <AuthProvider>
                <A11yEnhancements />
                {children}
              </AuthProvider>
            </BrandingProvider>
          </ThemeProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
