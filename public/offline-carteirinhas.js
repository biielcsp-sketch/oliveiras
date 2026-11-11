// Lista as carteirinhas guardadas no aparelho (cache "oliveiras-carteirinhas-v1").
// Texto sempre via textContent; nada de HTML montado a partir de dados.
(function () {
  var CARDS_CACHE = "oliveiras-carteirinhas-v1";
  var META_URL = "/__offline/carteirinhas.json";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var list = document.getElementById("lista");
  var aviso = document.getElementById("aviso");

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function render(cards) {
    if (!cards.length) {
      aviso.textContent = "Nenhuma carteirinha guardada neste aparelho. Abra Saúde com internet para guardar.";
      return;
    }
    cards.forEach(function (c) {
      if (!UUID.test(String(c.id))) return;
      var href = "/saude/arquivo/carteirinhas/" + c.id;
      var li = el("li");
      li.appendChild(el("strong", String(c.operator || "")));
      li.appendChild(el("span", String(c.person || "")));
      if (c.number) li.appendChild(el("span", String(c.number), "numero"));
      if (c.mime === "image/jpeg") {
        var img = document.createElement("img");
        img.src = href;
        img.alt = "Carteirinha " + String(c.operator || "");
        li.appendChild(img);
      }
      var a = el("a", c.mime === "application/pdf" ? "Abrir PDF" : "Abrir foto");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  if (!("caches" in window)) return render([]);
  caches
    .has(CARDS_CACHE)
    .then(function (has) {
      if (!has) return null;
      return caches.open(CARDS_CACHE).then(function (c) {
        return c.match(META_URL);
      });
    })
    .then(function (res) {
      return res ? res.json() : null;
    })
    .then(function (meta) {
      render(meta && Array.isArray(meta.cards) ? meta.cards : []);
    })
    .catch(function () {
      render([]);
    });
})();
