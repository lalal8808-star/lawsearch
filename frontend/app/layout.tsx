import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Serif_KR } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import CacheCleanup from "@/components/CacheCleanup";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const editorialSerif = Noto_Serif_KR({
  variable: "--font-editorial",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "JongLaw AI Intelligence",
  description: "대한민국 법령 기반 지능형 법률 분석 엔진",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "LawSearch",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport = {
  themeColor: "#001f3f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${editorialSerif.variable} antialiased`}
      >
        <AuthProvider>
          <CacheCleanup />
          {children}
          <Analytics />
          <SpeedInsights />
        </AuthProvider>
      </body>
    </html>
  );
}
