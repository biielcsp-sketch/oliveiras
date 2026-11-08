import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "@fontsource-variable/inter";
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
    { media: "(prefers-color-scheme: light)", color: "#eef1f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0a141c" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Renderização dinâmica em todas as páginas: necessária para o nonce da CSP.
  await connection();
  return (
    <html
      lang="pt-BR"
      className="h-full antialiased"
    >
      <body className="min-h-full font-sans">
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
