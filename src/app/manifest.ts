import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Oliveira's",
    short_name: "Oliveira's",
    description: "A vida da família Oliveira Rodrigues em um só lugar.",
    lang: "pt-BR",
    start_url: "/inicio",
    scope: "/",
    display: "standalone",
    background_color: "#f7f7f3",
    theme_color: "#f7f7f3",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
