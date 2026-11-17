/* =====================================================================
 * estudio-revisados.js — "Revisado" por bloco no modo edição do Estúdio.
 *
 * Como no editor do CardioAtt: com o modo edição ligado, cada bloco da estação
 * (critério, bloco de texto, caixa de filipeta, item do checklist, referência…)
 * ganha na margem direita da página A4 um quadradinho "REVISADO". Marcar grava
 * NA HORA no servidor (migração 012: estudio_revisados / estudio_marcar_revisado),
 * sem depender do "Salvar". A marca é do CONTEÚDO do bloco: a tela guarda o hash
 * SHA-256 do JSON canônico dele. Mover o bloco não desmarca; editar desmarca.
 * Nada disto vai para a estação nem para a publicação (aplicador, ator e aluno
 * nunca veem) e nada aparece na impressão.
 *
 * Trabalha por fora do editor (app/js/editor.js não muda): liga quando o body
 * tem a classe "modo-edicao", redesenha a cada "estacao-renderizada" e põe o
 * contador "Revisado NN% · X de Y" no topo do #painel-edicao.
 * ===================================================================== */
(function () {
  "use strict";
  var E = window.Estudio;
  if (!E || !E.api || !E.api.revisados) return;
  var ui = E.ui, el = ui.el;

  /* Unidades revisáveis: o caminho data-ed de cada elemento do documento é reduzido ao
     prefixo do bloco a que pertence (primeira regra que casar). O resto não é unidade. */
  var NOMES_BLOCOS = "orientacoes_ator|discussao_tecnica|discussao_banca|soft_skills|orientacoes_estacao|orientacoes_examinador|apos_filipetas|orientacoes_antes_das_filipetas";
  var REGRAS = [
    /^(titulo)$/,
    /^(local)$/,
    /^(objetivos\.\d+)(?:\.|$)/,
    /^(objetivos)$/,
    /^(criterios\.\d+)(?:\.|$)/,
    /^(roteiro)(?:\.|$)/,
    /^(filipetas\.\d+\.(?:caixas|blocos_antes|blocos_depois)\.\d+)(?:\.|$)/,
    /^(checklist\.grupos\.\d+\.itens\.\d+)(?:\.|$)/,
    new RegExp("^((?:" + NOMES_BLOCOS + ")\\.blocos\\.\\d+)(?:\\.|$)"),
    new RegExp("^((?:" + NOMES_BLOCOS + ")\\.\\d+)(?:\\.|$)"),
    /^(soft_skills\.itens\.\d+)(?:\.|$)/,
    /^((?:soft_skills\.)?referencias\.\d+)(?:\.|$)/,
    /^(referencias_imagens\.\d+)(?:\.|$)/,
    /^(sugestoes_frases\.\d+)(?:\.|$)/
  ];
  function unidadeDe(caminho) {
    for (var i = 0; i < REGRAS.length; i++) { var m = REGRAS[i].exec(caminho); if (m) return m[1]; }
    return null;
  }
  function obter(obj, c) {
    var ps = String(c).split("."), o = obj;
    for (var i = 0; i < ps.length; i++) { if (o == null || typeof o !== "object") return undefined; o = o[ps[i]]; }
    return o;
  }
  /* JSON canônico: chaves em ordem, sem espaços (o mesmo bloco dá sempre o mesmo texto) */
  function canonico(v) {
    if (Array.isArray(v)) return "[" + v.map(canonico).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
        .map(function (k) { return JSON.stringify(k) + ":" + canonico(v[k]); }).join(",") + "}";
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  function sha256(texto) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
    });
  }
  function z(n) { return (n < 10 ? "0" : "") + n; }
  function quando(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : z(d.getDate()) + "/" + z(d.getMonth() + 1) + " " + z(d.getHours()) + ":" + z(d.getMinutes());
  }

  var estado = {
    id: null,          // estação cujas marcas estão em "marcas"
    marcas: {},        // hash → {hash, caminho, por, por_nome, em}
    carregando: null,  // Promise da carga das marcas
    falta012: false,   // RPC inexistente no servidor
    erro: null,        // outra falha ao carregar
    unidades: [],      // [{caminho, hash, ancora}]
    token: 0
  };
  function ligado() { return document.body.classList.contains("modo-edicao"); }
  function atual() { var A = window.App; return A && A.atual ? A.atual() : null; }
  function ehFalta012(e) {
    var m = String((e && e.message) || e || "");
    return (e && e.code === "PGRST202") || /Could not find the function|012_revisados_estudio/.test(m);
  }

  function carregarMarcas(x, forcar) {
    if (!forcar && estado.id === x.id && estado.carregando) return estado.carregando;
    estado.id = x.id; estado.marcas = {}; estado.falta012 = false; estado.erro = null;
    var id = x.id;
    estado.carregando = E.api.revisados(id).then(function (lst) {
      if (estado.id !== id) return;
      (lst || []).forEach(function (m) { if (m && m.hash) estado.marcas[m.hash] = m; });
    }, function (e) {
      if (estado.id !== id) return;
      if (ehFalta012(e)) estado.falta012 = true; else estado.erro = ui.textoErro(e);
    });
    return estado.carregando;
  }

  /* ---------------- Desenho ---------------- */
  function limparMarcas() {
    Array.prototype.forEach.call(document.querySelectorAll(".es-rev-camada"), function (n) { n.parentNode.removeChild(n); });
  }
  function desenhar() {
    var x = atual();
    var token = ++estado.token;
    if (!ligado() || !x || !x.id || !x.dados) { limparMarcas(); estado.unidades = []; contador(); return Promise.resolve(); }
    var dados = x.dados;
    // unidades na ordem do documento; âncora = primeiro elemento de cada uma
    var vistas = {}, lst = [];
    Array.prototype.forEach.call(document.querySelectorAll("#documento [data-ed]"), function (n) {
      var u = unidadeDe(n.getAttribute("data-ed") || "");
      if (!u || vistas[u]) return;
      var v = obter(dados, u);
      if (v === undefined) return;
      vistas[u] = true;
      lst.push({ caminho: u, valor: v, ancora: n });
    });
    return Promise.all([carregarMarcas(x, false), Promise.all(lst.map(function (u) { return sha256(canonico(u.valor)); }))]).then(function (r) {
      if (token !== estado.token || !ligado()) return;
      var hashes = r[1];
      estado.unidades = lst.map(function (u, i) { return { caminho: u.caminho, hash: hashes[i], ancora: u.ancora }; });
      limparMarcas();
      var camadas = {};
      estado.unidades.forEach(function (u) {
        var pag = u.ancora.closest(".pagina");
        if (!pag) return;
        var camada = camadas[pag.dataset.esRevPag || ""];
        if (!camada || camada.parentNode !== pag) {
          camada = el("div", "es-rev-camada");
          camada.setAttribute("contenteditable", "false");
          camada.setAttribute("aria-label", "Marcas de revisão (não são impressas nem publicadas)");
          pag.appendChild(camada);
          pag.dataset.esRevPag = String(Object.keys(camadas).length + 1);
          camadas[pag.dataset.esRevPag] = camada;
        }
        var rp = pag.getBoundingClientRect(), ra = u.ancora.getBoundingClientRect();
        var escala = pag.offsetWidth ? rp.width / pag.offsetWidth : 1;
        var topo = Math.max(0, (ra.top - rp.top) / (escala || 1));
        camada.appendChild(caixa(u, topo));
      });
      contador();
    });
  }
  function caixa(u, topo) {
    var marca = estado.marcas[u.hash];
    var rot = el("label", "es-rev" + (marca ? " es-rev-sim" : ""));
    rot._u = u;
    rot.style.top = topo + "px";
    var chk = el("input");
    chk.type = "checkbox";
    chk.checked = !!marca;
    chk.disabled = estado.falta012 || !!estado.erro;
    chk.setAttribute("aria-label", "Revisado: " + u.caminho);
    rot.appendChild(chk);
    rot.appendChild(el("span", null, "REVISADO"));
    titulo(rot, u, marca);
    // o clique é só do quadradinho: não abre o balão nem a barra do editor
    ["pointerdown", "mousedown", "click", "dblclick"].forEach(function (t) {
      rot.addEventListener(t, function (ev) {
        ev.stopPropagation();
        // não tira o foco do texto em edição no mousedown (senão o editor grava e redesenha a página
        // antes do clique chegar à caixa); o marcar() encerra a edição na ordem certa
        if (t === "mousedown" || t === "pointerdown") ev.preventDefault();
      });
    });
    chk.addEventListener("change", function () { marcar(u, chk, rot); });
    return rot;
  }
  function titulo(rot, u, marca) {
    rot.title = estado.falta012 ? "Marcas de revisão indisponíveis: aplique a migração 012_revisados_estudio.sql no Supabase." :
      estado.erro ? "Marcas de revisão indisponíveis: " + estado.erro :
      marca ? "Revisado por " + (marca.por_nome || "administrador") + (marca.em ? " em " + quando(marca.em) : "") + ". Se o bloco mudar, a marca sai." :
      "Marcar este bloco como revisado (grava na hora; os alunos não veem)";
  }
  /* O hash é recalculado do conteúdo ATUAL do bloco no momento do clique: com a edição no próprio
     texto, o editor pode ter gravado o bloco (e redesenhado a página) logo antes do "change". */
  function marcar(u, chk, rot) {
    var sim = chk.checked;
    chk.disabled = true;
    var x = null;
    // texto do documento em edição no próprio lugar: encerra a edição (o editor grava ao perder o foco)
    var ativo = document.activeElement;
    var emEdicao = ativo && ativo !== document.body && ativo.isContentEditable && ativo.closest && ativo.closest("#documento");
    if (emEdicao) ativo.blur();
    var pronto = emEdicao ? new Promise(function (ok) { setTimeout(ok, 80); }) : Promise.resolve();
    pronto.then(function () {
      x = atual();
      if (!x || !x.id) { chk.disabled = false; chk.checked = !sim; return null; }
      var valor = x.dados ? obter(x.dados, u.caminho) : undefined;
      return valor === undefined ? u.hash : sha256(canonico(valor));
    }).then(function (hash) {
      if (hash == null) return;
      u.hash = hash;
      var antes = estado.marcas[hash] || null;
      // otimista
      if (sim) estado.marcas[hash] = { hash: hash, caminho: u.caminho, por_nome: "você", em: new Date().toISOString() };
      else delete estado.marcas[hash];
      depois(hash);
      return E.api.marcarRevisado(x.id, hash, u.caminho, sim).then(function (r) {
        if (sim && r) estado.marcas[hash] = r;
        chk.disabled = false;
        depois(hash);
      }, function (e) {
        if (antes) estado.marcas[hash] = antes; else delete estado.marcas[hash];
        chk.disabled = false;
        if (ehFalta012(e)) { estado.falta012 = true; desenhar(); }
        else depois(hash);
        ui.toast(ehFalta012(e) ? "Marcas de revisão indisponíveis: aplique a migração 012 no Supabase." :
          "Não foi possível gravar a marca de revisado: " + ui.textoErro(e), "erro");
      });
    });
    // a caixa clicada saiu da página (redesenho no meio do clique): redesenha a camada com o estado certo
    function depois(hash) { if (rot.isConnected) sincronizar(hash); else desenhar(); }
  }
  /* atualiza todas as caixas do mesmo hash (blocos idênticos andam juntos) e o contador */
  function sincronizar(hash) {
    Array.prototype.forEach.call(document.querySelectorAll(".es-rev-camada .es-rev"), function (rot) {
      var u = rot._u;
      if (!u || u.hash !== hash) return;
      var marca = estado.marcas[hash];
      var chk = rot.querySelector("input");
      chk.checked = !!marca;
      rot.classList.toggle("es-rev-sim", !!marca);
      titulo(rot, u, marca);
    });
    contador();
  }

  /* ---------------- Contador no painel de edição ---------------- */
  function contador() {
    var painel = document.getElementById("painel-edicao");
    if (!painel) return;
    var c = painel.querySelector(".es-rev-contador");
    if (!ligado() || painel.hidden) { if (c) c.parentNode.removeChild(c); return; }
    if (!c) {
      c = el("div", "es-rev-contador");
      c.setAttribute("role", "status");
      var cab = painel.querySelector(".ed-cab");
      if (cab && cab.nextSibling) painel.insertBefore(c, cab.nextSibling); else if (cab) painel.appendChild(c); else painel.insertBefore(c, painel.firstChild);
    }
    var total = estado.unidades.length;
    var feitos = estado.unidades.filter(function (u) { return !!estado.marcas[u.hash]; }).length;
    var pct = total ? Math.round(feitos / total * 100) : 0;
    ui.limpar(c);
    if (estado.falta012) {
      c.className = "es-rev-contador es-rev-aviso";
      ui.anexar(c, ["Marcas de revisão indisponíveis: aplique a migração ", el("b", null, "012_revisados_estudio.sql"), " no Supabase."]);
      return;
    }
    if (estado.erro) { c.className = "es-rev-contador es-rev-aviso"; c.textContent = "Marcas de revisão indisponíveis: " + estado.erro; return; }
    c.className = "es-rev-contador" + (total && feitos === total ? " es-rev-completo" : "");
    c.title = "Blocos marcados como revisados (quadradinho na margem direita de cada bloco). Grava na hora; os alunos não veem. Se o bloco mudar, a marca sai.";
    ui.anexar(c, ["Revisado ", el("b", null, pct + "%"), " · " + feitos + " de " + total]);
  }

  /* ---------------- Ligações ---------------- */
  var agendado = null;
  function agendar() {
    clearTimeout(agendado);
    agendado = setTimeout(desenhar, 30);
  }
  document.addEventListener("estacao-renderizada", agendar);
  var eraLigado = ligado();
  new MutationObserver(function () {
    var agora = ligado();
    if (agora === eraLigado) return;
    eraLigado = agora;
    if (agora) { var x = atual(); if (x && x.id) carregarMarcas(x, true); }
    agendar();
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  // o editor recria o painel (e esconde/mostra): o contador volta sempre
  (function vigiarPainel() {
    var painel = document.getElementById("painel-edicao");
    if (!painel) return;
    new MutationObserver(function () {
      if (ligado() && !painel.hidden && !painel.querySelector(".es-rev-contador")) contador();
    }).observe(painel, { childList: true, attributes: true, attributeFilter: ["hidden"] });
  })();
  // a página muda de tamanho (zoom, coluna da direita): reposiciona
  window.addEventListener("resize", function () { if (ligado()) agendar(); });
  var zoom = document.getElementById("opt-zoom");
  if (zoom) zoom.addEventListener("change", function () { if (ligado()) agendar(); });

  window.EstudioRevisados = { // para testes e depuração
    unidadeDe: unidadeDe, canonico: canonico,
    estado: function () { return { id: estado.id, marcas: Object.keys(estado.marcas).length, unidades: estado.unidades.length, falta012: estado.falta012 }; },
    redesenhar: desenhar
  };
})();
