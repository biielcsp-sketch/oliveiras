import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Tudo, exceto arquivos estáticos, ícones, manifest e service worker
    "/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|offline.html|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
