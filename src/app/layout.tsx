import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { RegisterSW } from "@/components/register-sw";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Oliveira's", template: "%s · Oliveira's" },
  description: "A vida da família Oliveira Rodrigues em um só lugar.",
  applicationName: "Oliveira's",
  appleWebApp: { capable: true, title: "Oliveira's", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f3" },
    { media: "(prefers-color-scheme: dark)", color: "#121310" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
