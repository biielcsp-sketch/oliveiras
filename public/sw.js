// Oliveira's — service worker
// Fase 0: permite instalar o app e mostra uma tela offline simples.
//
// Cache de dados pessoais: a proibição antiga foi REVOGADA pelo dono SOMENTE para as carteirinhas
// do convênio. Só o ARQUIVO da carteirinha (PDF/JPG) e o mínimo para identificá-la (operadora,
// pessoa, número) ficam no aparelho, no cache dedicado CARDS_CACHE, preenchido pelo app (janela)
// em src/lib/saude/offline-cards.ts. Aqui o SW apenas LÊ desse cache, e só quando a rede falha,
// para GET de /saude/arquivo/carteirinhas/<uuid>. Consultas, exames e páginas HTML do app nunca
// são guardados. O cache é apagado ao sair da conta, ao entrar outro usuário e ao apagar a carteirinha.
const CACHE = "oliveiras-v2";
const CARDS_CACHE = "oliveiras-carteirinhas-v1";
const OFFLINE_URL = "/offline.html";
const CARDS_PAGE = "/offline-carteirinhas.html";
// Só páginas estáticas, sem dado pessoal.
const PRECACHE = [OFFLINE_URL, CARDS_PAGE, "/offline-carteirinhas.js", "/offline-carteirinhas.css", "/icons/icon-192.png"];
const CARD_FILE = /^\/saude\/arquivo\/carteirinhas\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== CARDS_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Pedido de limpeza vindo do app (mesma origem).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "limpar-carteirinhas") event.waitUntil(caches.delete(CARDS_CACHE));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Arquivo de carteirinha: rede primeiro; só sem rede usa a cópia do aparelho.
  if (url.origin === self.location.origin && CARD_FILE.test(url.pathname)) {
    event.respondWith(
      fetch(req).catch(() =>
        caches
          .open(CARDS_CACHE)
          .then((c) => c.match(url.pathname))
          .then((res) => res || Response.error()),
      ),
    );
    return;
  }

  // Recursos estáticos da tela offline (js/css/ícone): sem eles a lista de carteirinhas não abre sem internet.
  if (url.origin === self.location.origin && req.mode !== "navigate" && PRECACHE.includes(url.pathname)) {
    event.respondWith(fetch(req).catch(() => caches.match(url.pathname).then((res) => res || Response.error())));
    return;
  }

  // Navegações: sem rede, tela offline (ou a lista de carteirinhas offline).
  if (req.mode !== "navigate") return;
  event.respondWith(fetch(req).catch(() => caches.match(url.pathname === CARDS_PAGE ? CARDS_PAGE : OFFLINE_URL)));
});

// ---------- Avisos por notificação push (Web Push) ----------
// Não guarda nada em cache. O servidor manda { title, body, tag, url }; aqui só se mostra o aviso.
// Payload ausente ou inválido vira um aviso genérico (o navegador exige mostrar algo a cada push).
const GENERIC_TITLE = "Oliveira's: você tem um aviso";
// Lista fechada de destinos: qualquer outra coisa abre /inicio.
const NOTIFICATION_PATHS = ["/saude/medicamentos", "/saude/vacinas"];

function cut(v, max) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function notificationTarget(raw) {
  try {
    if (typeof raw !== "string") return "/inicio";
    const u = new URL(raw, self.location.origin);
    return u.origin === self.location.origin && NOTIFICATION_PATHS.includes(u.pathname) ? u.pathname : "/inicio";
  } catch {
    return "/inicio";
  }
}

self.addEventListener("push", (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  if (typeof data !== "object" || data === null) data = {};
  const title = cut(data.title, 80) || GENERIC_TITLE;
  const options = {
    body: cut(data.body, 200),
    tag: cut(data.tag, 100) || "oliveiras-aviso",
    icon: "/icons/icon-192.png",
    data: { url: notificationTarget(data.url) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = notificationTarget(event.notification.data && event.notification.data.url);
  const target = self.location.origin + path;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        const open = list.find((c) => new URL(c.url).origin === self.location.origin);
        if (open) {
          return open.focus().then((c) => (c && "navigate" in c ? c.navigate(target) : self.clients.openWindow(target)));
        }
        return self.clients.openWindow(target);
      })
      .catch(() => self.clients.openWindow(target)),
  );
});
