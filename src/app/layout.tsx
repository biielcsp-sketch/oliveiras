import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { THEME_COLOR, THEME_COOKIE, parseTheme } from "@/lib/theme";
import "@fontsource-variable/inter";
import { RegisterSW } from "@/components/register-sw";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Oliveira's", template: "%s · Oliveira's" },
  description: "A vida da família Oliveira Rodrigues em um só lugar.",
  applicationName: "Oliveira's",
  appleWebApp: { capable: true, title: "Oli", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export async function generateViewport(): Promise<Viewport> {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    // Com escolha no botão, a barra do navegador acompanha; sem escolha, segue o aparelho.
    themeColor: theme
      ? THEME_COLOR[theme]
      : [
          { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
          { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
        ],
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Renderização dinâmica em todas as páginas: necessária para o nonce da CSP.
  await connection();
  // Tema escolhido no botão (cookie). Sem escolha, o CSS segue o modo do aparelho.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="pt-BR" className="h-full antialiased" data-theme={theme ?? undefined}>
      <body className="min-h-full font-sans">
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
