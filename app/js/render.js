/* =====================================================================
 * render.js — Transforma o objeto da estação (app/esquema/ESQUEMA.md)
 * em páginas A4 diagramadas, fiéis a analises/modelo-diagramacao.md.
 *
 * API (script clássico, sem módulos):
 *   window.Diagramador.diagramar(container, estacao, opcoes) -> Promise<{paginas}>
 *     opcoes: { capa: bool, base: "pasta/da/estacao/", blobs: {nomeArquivo: blobURL} }
 *   window.Diagramador.BANCAS  — rótulos e layout de cada banca
 *
 * Segurança: todo texto do conteúdo vira nó de texto (createTextNode);
 * o mini-markdown (**negrito**, *itálico*) é interpretado aqui, sem innerHTML.
 * ===================================================================== */
(function () {
  "use strict";

  /* ------------------------------------------------------------------
   * 1. Bancas
   * ------------------------------------------------------------------ */
  var BANCAS = {
    "einstein":      { nome: "Einstein",      rodape: "EINSTEIN",      capa: "EINSTEIN",      layout: "einstein", escala: "valor-pontos",    local: "CENÁRIO:" },
    "sirio-libanes": { nome: "Sírio-Libanês", rodape: "SÍRIO LIBANÊS", capa: "SÍRIO LIBANÊS", layout: "hsl",      escala: "sim-nao-valor",   local: "LOCAL:" },
    "usp-ribeirao":  { nome: "USP Ribeirão",  rodape: "USP-RP",        capa: "USP-RP",        layout: "usp",      escala: "sim-parcial-nao", local: "CENÁRIO:" },
    "unifesp-r1":    { nome: "Unifesp R1",    rodape: "UNIFESP",       capa: "UNIFESP",       layout: "unifesp",  escala: "sim-nao-pontos",  local: "CENÁRIO:" },
    "unifesp-rmais": { nome: "Unifesp R+",    rodape: "UNIFESP",       capa: "UNIFESP R+",    layout: "unifesp",  escala: "sim-nao-pontos",  local: "CENÁRIO:" },
    "tradicional":   { nome: "Tradicional",   rodape: "TRADICIONAL",   capa: "TRADICIONAL",   layout: "hsl",      escala: "sim-nao-valor",   local: "LOCAL:" }
  };
  function infoBanca(b) { return BANCAS[b] || { nome: b || "?", rodape: String(b || "").toUpperCase(), capa: String(b || "").toUpperCase(), layout: "hsl", escala: "sim-nao-valor", local: "CENÁRIO:" }; }

  /* Colunas do checklist (larguras em % da largura útil — seção 5.7) */
  var ESCALAS = {
    "sim-nao-valor":   { cols: ["SIM", "NÃO", "VALOR"],      larg: [9.3, 9.3, 10],  item: 61.4, valorEm: 2 },
    "valor-pontos":    { cols: ["VALOR", "PONTOS"],          larg: [9.7, 9.7],      item: 70.6, valorEm: 0 },
    "sim-parcial-nao": { cols: ["SIM", "PARCIAL", "NÃO"],    larg: [8.6, 9.7, 8.7], item: 63,   valorEm: -1, parcialEm: 1 },
    "sim-nao-pontos":  { cols: ["SIM", "NÃO", "PONTOS"],     larg: [6.5, 6.5, 9.8], item: 67.2, valorEm: 2 }
  };

  /* ------------------------------------------------------------------
   * 2. Utilidades de DOM e mini-markdown
   * ------------------------------------------------------------------ */
  function el(tag, cls, filhos) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    anexar(n, filhos);
    return n;
  }
  function anexar(n, filhos) {
    if (filhos == null) return n;
    if (!Array.isArray(filhos)) filhos = [filhos];
    filhos.forEach(function (f) {
      if (f == null || f === false) return;
      if (typeof f === "string" || typeof f === "number") n.appendChild(document.createTextNode(String(f)));
      else n.appendChild(f);
    });
    return n;
  }
  function txt(v) { return v == null ? "" : String(v); }
  function vazio(v) { return v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0); }
  function arr(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }

  /* **negrito**, *itálico*, quebra de linha "\n" -> <br>. Marcadores sem par ficam literais
     (ex.: "Artéria Coronária Direita*"). */
  function md(texto) {
    var frag = document.createDocumentFragment();
    var s = txt(texto);
    if (!s) return frag;
    var tokens = s.split(/(\*\*|\*|\n)/);
    // emparelha marcadores
    var abre = { "**": [], "*": [] }, valido = {};
    tokens.forEach(function (t, i) {
      if (t === "**" || t === "*") {
        var pilha = abre[t];
        if (pilha.length) { var j = pilha.pop(); valido[i] = valido[j] = true; }
        else pilha.push(i);
      }
    });
    var negrito = false, italico = false;
    tokens.forEach(function (t, i) {
      if (t === "") return;
      if ((t === "**" || t === "*") && valido[i]) {
        if (t === "**") negrito = !negrito; else italico = !italico;
        return;
      }
      if (t === "\n") { frag.appendChild(document.createElement("br")); return; }
      t.split(/([\u2080-\u2089\u208A\u208B]+|[\u2070\u00B9\u00B2\u00B3\u2074-\u2079\u207A\u207B]+)/).forEach(function (parte, k) {
        if (parte === "") return;
        var no;
        if (k % 2 === 1) { // subscrito/sobrescrito: a fonte de reserva não tem esses glifos
          var ehSub = /[\u2080-\u208B]/.test(parte);
          no = document.createElement(ehSub ? "sub" : "sup");
          no.appendChild(document.createTextNode(normalizarIndice(parte)));
        } else no = document.createTextNode(parte);
        if (italico) { var ie = document.createElement("i"); ie.appendChild(no); no = ie; }
        if (negrito) { var be = document.createElement("b"); be.appendChild(no); no = be; }
        frag.appendChild(no);
      });
    });
    return frag;
  }
  var INDICES = { "\u2080": "0", "\u2081": "1", "\u2082": "2", "\u2083": "3", "\u2084": "4", "\u2085": "5", "\u2086": "6", "\u2087": "7", "\u2088": "8", "\u2089": "9", "\u208A": "+", "\u208B": "\u2212",
    "\u2070": "0", "\u00B9": "1", "\u00B2": "2", "\u00B3": "3", "\u2074": "4", "\u2075": "5", "\u2076": "6", "\u2077": "7", "\u2078": "8", "\u2079": "9", "\u207A": "+", "\u207B": "\u2212" };
  function normalizarIndice(s) { return s.split("").map(function (c) { return INDICES[c] || c; }).join(""); }
  /* Soft Skills e Sugestões de frases: o *itálico* sai em itálico azul (ESQUEMA.md, convenções) */
  function italicoAzul(nos) {
    arr(nos).forEach(function (n) {
      if (!n || !n.querySelectorAll) return;
      if (n.tagName === "I") n.classList.add("fala-azul");
      Array.prototype.forEach.call(n.querySelectorAll("i"), function (i) { i.classList.add("fala-azul"); });
    });
    return nos;
  }
  function p(cls, filhos) { return el("p", cls, filhos); }
  function rotuloInline(rot, texto, caminho) {
    return p(null, [el("b", "rotulo-inline", rot), " ", caminho != null ? edSpan(md(texto), caminho, texto) : md(texto)]);
  }
  function junto(n) { n.setAttribute("data-junto", "1"); return n; }
  function fmtValor(v) {
    if (typeof v !== "number" || !isFinite(v)) return txt(v);
    var s = Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? v.toFixed(1) : String(v);
    return s.replace(".", ",");
  }
  function semPontoFinal(s) { return /[.;:!?]$/.test(s.trim()) ? s.trim() : s.trim() + "."; }

  /* Modo edição (contrato do editor): o elemento que exibe um valor dos dados recebe
     data-ed="<caminho>" (ex.: "checklist.grupos.0.itens.4.texto"). O caminho aponta sempre
     para o valor bruto (string ou número), mesmo que o texto exibido seja transformado.
     Só atributos e <span> neutros: o visual e a paginação não mudam. */
  function cj(base, k) { return base == null ? null : base + "." + k; }
  function cArr(v, c) { return Array.isArray(v) ? c : null; } // arr() embrulha não-arrays: aí não há índice
  function ed(n, caminho, valor) {
    if (n && n.setAttribute && caminho != null && (typeof valor === "string" || typeof valor === "number")) n.setAttribute("data-ed", caminho);
    return n;
  }
  function edSpan(filhos, caminho, valor) { return ed(el("span", null, filhos), caminho, valor); }
  /* md() aplicado a pedaços separados dá o mesmo resultado que no texto inteiro
     quando cada pedaço tem marcadores ** e * em número par */
  function mdEquilibrado(s) {
    var t = txt(s).split(/(\*\*|\*)/), n2 = 0, n1 = 0;
    t.forEach(function (x) { if (x === "**") n2++; else if (x === "*") n1++; });
    return n2 % 2 === 0 && n1 % 2 === 0;
  }

  /* ------------------------------------------------------------------
   * 3. Ícones e ornamentos (aproximações em SVG; a marca ainda não enviou os arquivos)
   * ------------------------------------------------------------------ */
  var SVGNS = "http://www.w3.org/2000/svg";
  var uid = 0;
  function svgDe(markup) {
    // markup é fixo (definido aqui), nunca vem do conteúdo da estação
    var doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    return document.importNode(doc.documentElement, true);
  }
  function gotaPath(cx, cy, r, rc) {
    // "gota": círculo com o canto superior direito quase reto (raio rc)
    return "M" + cx + " " + (cy - r) + " H" + (cx + r - rc) + " Q" + (cx + r) + " " + (cy - r) + " " + (cx + r) + " " + (cy - r + rc) +
      " V" + cy + " A" + r + " " + r + " 0 0 1 " + cx + " " + (cy + r) + " A" + r + " " + r + " 0 0 1 " + (cx - r) + " " + cy +
      " A" + r + " " + r + " 0 0 1 " + cx + " " + (cy - r) + " Z";
  }
  function iconeEstacao() {
    var id = "ge" + (++uid);
    var faixas = "";
    for (var k = -3; k <= 3; k++) {
      faixas += '<rect x="20" y="' + (43 + k * 7.6) + '" width="76" height="3.2" rx="1.6" fill="#fff" transform="rotate(-24 57 45)"/>';
    }
    return svgDe('<svg xmlns="' + SVGNS + '" viewBox="0 0 100 100" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4C86DC"/><stop offset=".45" stop-color="#3867C6"/><stop offset="1" stop-color="#120B7F"/></linearGradient>' +
      '<clipPath id="' + id + 'c"><circle cx="57" cy="45" r="22"/></clipPath></defs>' +
      '<path d="' + gotaPath(50, 50, 48, 6) + '" fill="url(#' + id + ')"/>' +
      '<path d="' + gotaPath(57, 44, 36, 3) + '" fill="#fff"/>' +
      '<g clip-path="url(#' + id + 'c)"><circle cx="57" cy="45" r="22" fill="#120B7F"/>' + faixas + '</g>' +
      '<path d="M36 34 q6 -9 15 -11" stroke="#120B7F" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
      '</svg>');
  }
  function iconeBloco() {
    var id = "gb" + (++uid);
    return svgDe('<svg class="icone-bloco" xmlns="' + SVGNS + '" viewBox="0 0 20 20" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3867C6"/><stop offset="1" stop-color="#120B7F"/></linearGradient></defs>' +
      '<path fill-rule="evenodd" fill="url(#' + id + ')" d="' + gotaPath(10, 10, 9.6, 0.9) + " " + gotaPath(11.1, 8.9, 6.1, 0.5) + '"/>' +
      '</svg>');
  }
  function rabicho() {
    // seta "<" de ~14 pt de altura e ~11 pt de profundidade; o fio azul da borda é interrompido nela
    return svgDe('<svg class="rabicho" xmlns="' + SVGNS + '" viewBox="0 0 14 16" aria-hidden="true">' +
      '<rect x="11.9" y="1" width="1.1" height="14" fill="#fff"/><rect x="13" y="1" width="1" height="14" fill="#EEEEEF"/>' +
      '<path d="M13 0 L2 8 L13 16" fill="none" stroke="#23428D" stroke-width="2" stroke-linejoin="miter" stroke-miterlimit="10"/></svg>');
  }
  function ornamentoFim() {
    var id = "of" + (++uid), linhas = "";
    for (var i = 0; i < 6; i++) {
      var x = 18 + i * 30, y = 14 + i * 34, r = 34;
      linhas += '<path d="M' + x + ' 340 V' + (y + r) + ' A' + r + ' ' + r + ' 0 0 1 ' + (x + r) + ' ' + y + ' H250" />';
    }
    var d = el("div", "ornamento fim");
    d.appendChild(svgDe('<svg xmlns="' + SVGNS + '" viewBox="0 0 247 337" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="247" y2="337"><stop offset="0" stop-color="#C5CDDD" stop-opacity=".95"/><stop offset=".55" stop-color="#DDE2EC" stop-opacity=".7"/><stop offset="1" stop-color="#E6EAF1" stop-opacity=".15"/></linearGradient></defs>' +
      '<g fill="none" stroke="url(#' + id + ')" stroke-width="1.6">' + linhas + '</g></svg>'));
    return d;
  }
  function ornamentoGrande() {
    var id = "og" + (++uid), linhas = "";
    for (var i = 0; i < 6; i++) {
      var x = 402 - i * 37, y = 3 + i * 42, r = 50 - i * 3;
      linhas += '<path d="M-10 ' + y + ' H' + (x - r) + ' A' + r + ' ' + r + ' 0 0 1 ' + x + ' ' + (y + r) + ' V480" />';
    }
    var d = el("div", "ornamento grande");
    d.appendChild(svgDe('<svg xmlns="' + SVGNS + '" viewBox="0 0 498 473" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="430" y1="0" x2="60" y2="420"><stop offset="0" stop-color="#C5CDDD" stop-opacity=".9"/><stop offset=".6" stop-color="#E1E5EE" stop-opacity=".45"/><stop offset="1" stop-color="#EEF0F5" stop-opacity="0"/></linearGradient></defs>' +
      '<g fill="none" stroke="url(#' + id + ')" stroke-width="1.6">' + linhas + '</g></svg>'));
    return d;
  }
  function arcosCapa() {
    var linhas = "";
    for (var i = 0; i < 7; i++) {
      var r = 40 + i * 16;
      linhas += '<path d="' + gotaPath(70, 70, r, 8) + '"/>' + '<path d="' + gotaPath(525, 70, r, 8) + '"/>';
    }
    return svgDe('<svg class="arcos-capa" xmlns="' + SVGNS + '" viewBox="0 0 595 340" preserveAspectRatio="xMidYMin slice" aria-hidden="true">' +
      '<g fill="none" stroke="#1E2A50" stroke-width="1.2">' + linhas + '</g></svg>');
  }

  /* ------------------------------------------------------------------
   * 4. Imagens (pré-carregadas para a paginação medir a altura certa)
   * ------------------------------------------------------------------ */
  function resolverImagem(arquivo, ctx) {
    var a = txt(arquivo).trim();
    if (!a) return "";
    var nome = a.split(/[\\/]/).pop();
    if (ctx.blobs && ctx.blobs[nome]) return ctx.blobs[nome];
    if (/^(data:|blob:|https?:|file:)/i.test(a) || a.charAt(0) === "/") return a;
    return (ctx.base || "") + a;
  }
  function coletarImagens(valor, saida) {
    if (Array.isArray(valor)) { valor.forEach(function (v) { coletarImagens(v, saida); }); return saida; }
    if (valor && typeof valor === "object") {
      if (valor.tipo === "imagem" && valor.arquivo) saida.push(valor.arquivo);
      Object.keys(valor).forEach(function (k) { if (k !== "revisao") coletarImagens(valor[k], saida); });
    }
    return saida;
  }
  function preCarregar(url, limiteMs) {
    return new Promise(function (ok) {
      if (!url) { ok({ ok: false }); return; }
      var im = new Image(), feito = false;
      var fim = function (r) { if (!feito) { feito = true; ok(r); } };
      im.onload = function () { fim({ ok: true, w: im.naturalWidth, h: im.naturalHeight }); };
      im.onerror = function () { fim({ ok: false }); };
      setTimeout(function () { fim({ ok: false, timeout: true }); }, limiteMs || 8000);
      im.src = url;
    });
  }
  function imagemOuPendente(bloco, ctx, c) {
    var url = resolverImagem(bloco.arquivo, ctx);
    var st = ctx.imagens[url];
    var pend = function () { return ed(el("div", "img-pendente", "Imagem pendente: " + txt(bloco.arquivo)), cj(c, "arquivo"), bloco.arquivo); };
    if (!st || !st.ok) return pend();
    var im = document.createElement("img");
    im.alt = txt(bloco.titulo || bloco.arquivo);
    im.setAttribute("width", st.w); im.setAttribute("height", st.h);
    im.onerror = function () { if (im.parentNode) im.parentNode.replaceChild(pend(), im); };
    im.src = url;
    return im;
  }
  function largura(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return (v <= 1 ? v * 100 : v) + "%";
    return String(v);
  }
  function fonteLinha(fonte, cls, caminho) {
    var s = txt(fonte).trim();
    var m = s.match(/^\**\s*(Fonte(?:\s+d[aeo]s?\s+\S+)?)\s*:\s*\**\s*([\s\S]*)$/i);
    var d = el("div", cls || "fonte-img");
    anexar(d, [el("b", null, (m ? m[1] : "Fonte") + ":"), " ", md(m ? m[2] : s)]);
    return ed(d, caminho, fonte);
  }
  /* envolver: o conteúdo vai num <span data-ed> (quando a mesma legenda recebe outro valor depois) */
  function legendaComPrefixo(texto, caminho, envolver) {
    var s = txt(texto).trim();
    var m = s.match(/^((?:Tabela|Figura|Quadro|Gráfico)\s*\d+[A-Za-z]?\.)\s*([\s\S]*)$/i);
    var d = el("div", "legenda");
    var alvo = envolver ? el("span") : d;
    if (m && s.indexOf("**") !== 0) anexar(alvo, [el("b", null, m[1]), " ", md(m[2])]); else anexar(alvo, md(s));
    ed(alvo, caminho, texto);
    if (envolver) d.appendChild(alvo);
    return d;
  }

  /* ------------------------------------------------------------------
   * 5. Blocos genéricos (paragrafo, subtitulo, rotulo, lista, sinais,
   *    tarefa, tabela, imagem, fala, nota) -> lista plana de unidades
   * ------------------------------------------------------------------ */
  /* c = caminho do item (ex.: "...blocos.2.itens.3") */
  function itemLista(it, c) {
    var li = el("li");
    if (it && typeof it === "object" && !Array.isArray(it)) {
      var chave = it.subitens ? "subitens" : "itens";
      var subs = arr(it.subitens || it.itens);
      if (subs.length) {
        // texto + sublista: o texto ganha um <span> próprio (o <li> contém também os subitens)
        li.appendChild(edSpan(md(it.texto), cj(c, "texto"), it.texto));
        li.appendChild(listaMarcadores(subs, null, cArr(it[chave], cj(c, chave))));
      } else ed(anexar(li, md(it.texto)), cj(c, "texto"), it.texto);
    } else ed(anexar(li, md(it)), c, it);
    return li;
  }
  /* cItens = caminho do array de itens (ex.: "checklist.grupos.0.itens.4.detalhes") */
  function listaMarcadores(itens, cls, cItens) {
    var ul = el("ul", "marcadores" + (cls ? " " + cls : ""));
    itens.forEach(function (s, i) { ul.appendChild(itemLista(s, cj(cItens, i))); });
    return ul;
  }
  function lista(bloco, cItens) {
    var ordenada = !!bloco.ordenada;
    var ul = el(ordenada ? "ol" : "ul", ordenada ? "numerada" : "gota");
    var ultimo = null;
    cItens = cArr(bloco.itens, cItens);
    arr(bloco.itens).forEach(function (it, i) {
      // "• texto" vira subitem do item anterior (sublista com marcador "•")
      if (typeof it === "string" && /^\s*[•·]\s+/.test(it) && ultimo) {
        var sub = ultimo.querySelector(":scope > ul.marcadores");
        if (!sub) { sub = el("ul", "marcadores"); ultimo.appendChild(sub); }
        // o caminho aponta para o item original (com o "• ")
        sub.appendChild(ed(itemLista(it.replace(/^\s*[•·]\s+/, ""), null), cj(cItens, i), it));
        return;
      }
      ultimo = itemLista(it, cj(cItens, i));
      ul.appendChild(ultimo);
    });
    if (ordenada) ul.setAttribute("data-inicio", "0");
    return ul;
  }
  /* c = caminho do bloco tabela */
  function linhasTabela(t, bloco, c) {
    if (arr(bloco.cabecalho).length) {
      var tr = el("tr");
      var cCab = cArr(bloco.cabecalho, cj(c, "cabecalho"));
      bloco.cabecalho.forEach(function (x, k) { tr.appendChild(ed(el("th", null, md(x)), cj(cCab, k), x)); });
      t.appendChild(el("thead", null, tr));
    }
    var tb = el("tbody");
    var cLin = cArr(bloco.linhas, cj(c, "linhas"));
    arr(bloco.linhas).forEach(function (l, r) {
      var tr2 = el("tr");
      var cL = cArr(l, cj(cLin, r));
      arr(l).forEach(function (x, k) { tr2.appendChild(ed(el("td", null, md(x)), cj(cL, k), x)); });
      tb.appendChild(tr2);
    });
    t.appendChild(tb);
  }
  function tabelaExames(bloco, c) {
    var mold = el("div", "tab-exames-moldura" + (arr(bloco.cabecalho).length > 3 ? " larga" : ""));
    var t = el("table", "tab-exames");
    linhasTabela(t, bloco, c);
    mold.appendChild(t);
    return mold;
  }
  function tabelaDiscussao(bloco, c) {
    var g = el("div", "tabela-grupo");
    var t = el("table", "tab-discussao");
    linhasTabela(t, bloco, c);
    g.appendChild(t);
    if (!vazio(bloco.legenda)) g.appendChild(legendaComPrefixo(bloco.legenda, cj(c, "legenda")));
    return g;
  }
  function figuraCaixa(bloco, ctx, c) {
    var d = el("div", "figura-caixa");
    if (!vazio(bloco.titulo)) d.appendChild(ed(el("div", "rotulo-caixa centro", md(bloco.titulo)), cj(c, "titulo"), bloco.titulo));
    var im = imagemOuPendente(bloco, ctx, c);
    var w = largura(bloco.largura);
    if (w) { im.style.maxWidth = w; if (im.classList.contains("img-pendente")) im.style.width = w; }
    d.appendChild(im);
    if (!vazio(bloco.fonte)) d.appendChild(fonteLinha(bloco.fonte, null, cj(c, "fonte")));
    return d;
  }
  function figuraDiscussao(bloco, ctx, c) {
    var titulo = txt(bloco.titulo).trim();
    var ehLegenda = /^(\*\*)?(Figura|Imagem|Quadro)\s*\d+/i.test(titulo);
    var im = imagemOuPendente(bloco, ctx, c);
    var w = largura(bloco.largura);
    // HSL/Tradicional: figura com legenda lateral (5.10)
    if (ctx.layout === "hsl" && ehLegenda) {
      var g = el("div", "figura-lateral");
      if (w) g.style.gridTemplateColumns = w + " 1fr";
      g.appendChild(el("div", null, im));
      var leg = el("div");
      var temFonte = !vazio(bloco.fonte);
      var lg = legendaComPrefixo(titulo, cj(c, "titulo"), temFonte);
      if (temFonte) {
        var fs = txt(bloco.fonte).trim().replace(/^\*\*(Fonte[^*]*)\*\*/i, "$1");
        if (!/^Fonte/i.test(fs)) fs = "Fonte: " + fs;
        anexar(lg, [" ", edSpan(md(fs), cj(c, "fonte"), bloco.fonte)]);
      }
      leg.appendChild(lg);
      g.appendChild(leg);
      return g;
    }
    // Einstein / Unifesp / USP-RP (e HSL sem legenda): figura em moldura arredondada
    var f = el("div", "figura");
    if (titulo && !ehLegenda) f.appendChild(ed(el("div", "titulo-figura", md(titulo)), cj(c, "titulo"), bloco.titulo));
    var mold = el("div", "moldura");
    if (im.classList && im.classList.contains("img-pendente")) mold.style.width = w || "100%";
    else { mold.style.width = "fit-content"; mold.style.maxWidth = w || "100%"; im.style.maxWidth = "100%"; }
    mold.appendChild(im);
    f.appendChild(mold);
    if (titulo && ehLegenda) f.appendChild(legendaComPrefixo(titulo, cj(c, "titulo")));
    if (!vazio(bloco.fonte)) {
      if (ctx.layout === "einstein") {
        var lin = el("div", "fonte-pilula-linha");
        lin.appendChild(fonteLinha(bloco.fonte, "fonte-pilula", cj(c, "fonte")));
        f.appendChild(lin);
      } else f.appendChild(fonteLinha(bloco.fonte, null, cj(c, "fonte")));
    }
    return f;
  }
  /* o <p> inteiro vem do valor (a letra "A)" é tirada do texto ou gerada) */
  function itemLetra(s, i, caminho) {
    var t = txt(s);
    var m = t.match(/^\s*(\(?[A-Za-z]\))\s*([\s\S]*)$/);
    if (m) return ed(p(null, [el("b", "item-letra", m[1].toUpperCase()), " ", md(m[2])]), caminho, s);
    return ed(p(null, [el("b", "item-letra", String.fromCharCode(65 + i) + ")"), " ", md(t)]), caminho, s);
  }
  function fala(bloco, c) {
    var grupo = el("div", "fala-grupo");
    if (!vazio(bloco.gatilho)) {
      var g = txt(bloco.gatilho).trim();
      grupo.appendChild(el("ul", "gota", ed(el("li", null, md(/[:.;]$/.test(g) ? g : g + ":")), cj(c, "gatilho"), bloco.gatilho)));
    }
    // a caixa de fala inteira exibe o "texto" (uma linha por parágrafo)
    var caixa = ed(el("div", "fala"), cj(c, "texto"), bloco.texto);
    caixa.appendChild(rabicho());
    txt(bloco.texto).split(/\n+/).forEach(function (linha) {
      if (linha.trim()) caixa.appendChild(p(null, md(linha.trim())));
    });
    grupo.appendChild(caixa);
    return grupo;
  }
  function tarefaBloco(bloco, ctx, c) {
    var out = [];
    var rot = txt(bloco.rotulo).trim();
    var subs = arr(bloco.subitens);
    if (rot && !vazio(bloco.texto) && !subs.length) {
      // em linha: "TAREFA 1: texto"
      out.push(p("em-linha", [ed(el("b", "rotulo-caixa-inline", rot), cj(c, "rotulo"), bloco.rotulo), " ", edSpan(md(bloco.texto), cj(c, "texto"), bloco.texto)]));
      return out;
    }
    if (rot) out.push(ed(el("div", "rotulo-caixa", md(rot)), cj(c, "rotulo"), bloco.rotulo));
    if (!vazio(bloco.texto)) out.push(ed(p(null, md(bloco.texto)), cj(c, "texto"), bloco.texto));
    var cSubs = cArr(bloco.subitens, cj(c, "subitens"));
    subs.forEach(function (s, i) { out.push(itemLetra(s, i, cj(cSubs, i))); });
    return out;
  }

  /* Converte uma lista de blocos em unidades (elementos de nível superior).
     caminho = caminho do array de blocos (ex.: "filipetas.0.caixas.1.blocos");
     ini = índice do primeiro bloco de lista_ dentro desse array (quando lista_ é um pedaço dele). */
  function blocos(lista_, ctx, caminho, ini) {
    var out = [];
    var base = cArr(lista_, caminho);
    ini = ini || 0;
    arr(lista_).forEach(function (b, i) {
      if (b == null) return;
      var c = cj(base, ini + i);
      if (typeof b === "string") { out.push(ed(p(null, md(b)), c, b)); return; }
      var ct = cj(c, "texto");
      switch (b.tipo) {
        case "paragrafo":
          // dentro de caixa, "A) texto" ganha a letra em negrito (itens de tarefa)
          if (ctx.dentroCaixa && /^\s*\(?[A-Za-z]\)\s/.test(txt(b.texto))) out.push(itemLetra(b.texto, 0, ct));
          else out.push(ed(p(null, md(b.texto)), ct, b.texto));
          break;
        case "subtitulo": out.push(junto(ed(el("div", "subtitulo", md(b.texto)), ct, b.texto))); break;
        case "rotulo":
          out.push(junto(ed(el("div", ctx.dentroCaixa ? "rotulo-caixa" : "rotulo-solto", md(b.texto)), ct, b.texto))); break;
        case "lista": out.push(lista(b, cj(c, "itens"))); break;
        case "sinais": out.push(ed(p("sinais", md(b.texto)), ct, b.texto)); break;
        case "tarefa": tarefaBloco(b, ctx, c).forEach(function (n) { out.push(n); }); break;
        case "tabela": out.push(ctx.dentroCaixa ? tabelaExames(b, c) : tabelaDiscussao(b, c)); break;
        case "imagem": out.push(ctx.dentroCaixa ? figuraCaixa(b, ctx, c) : figuraDiscussao(b, ctx, c)); break;
        case "fala": out.push(fala(b, c)); break;
        case "nota": out.push(ed(p("nota", md(b.texto)), ct, b.texto)); break;
        default:
          if (b.texto != null) out.push(ed(p(null, md(b.texto)), ct, b.texto));
      }
    });
    return out;
  }

  /* ------------------------------------------------------------------
   * 6. Seções
   * ------------------------------------------------------------------ */
  function secao(forte, leve) {
    var d = el("div", "secao", el("b", null, forte));
    if (leve) { d.appendChild(document.createTextNode(" ")); d.appendChild(el("span", "leve", leve)); }
    return junto(d);
  }
  function blocoIcone(titulo, caminho, valor) {
    var d = el("div", "bloco-icone");
    d.appendChild(iconeBloco());
    d.appendChild(ed(el("span", null, titulo), caminho, valor));
    return junto(d);
  }
  function rotuloAzul(texto, extra) { return junto(el("div", "rotulo-azul" + (extra ? " " + extra : ""), md(texto))); }

  /* Título com o prefixo "Estação N - " (Unifesp R+): o título bruto fica num <span data-ed> */
  function tituloComNumero(e) {
    var titulo = txt(e.titulo);
    if (e.numero_estacao != null && e.numero_estacao !== "" && !/^Esta[çc][ãa]o\s/i.test(titulo)) {
      return ["Estação " + e.numero_estacao + " - ", edSpan(titulo, "titulo", e.titulo)];
    }
    return null;
  }

  function abertura(e, ctx) {
    var d = el("div", "abertura");
    var ic = el("div", "icone-estacao"); ic.appendChild(iconeEstacao()); d.appendChild(ic);
    var comNumero = tituloComNumero(e);
    d.appendChild(comNumero ? el("h1", null, comNumero) : ed(el("h1", null, txt(e.titulo)), "titulo", e.titulo));
    var pil = el("div", "pilula-area", ed(el("span", null, txt(e.area)), "area", e.area));
    if (!vazio(e.dia)) pil.appendChild(ed(el("span", "dia", " | " + txt(e.dia)), "dia", e.dia));
    d.appendChild(el("div", null, pil));
    return junto(d);
  }

  function criterios(e, ctx) {
    var out = [];
    var lst = arr(e.criterios);
    if (!lst.length) return out;
    var cBase = cArr(e.criterios, "criterios");
    out.push(secao("CRITÉRIOS DE AVALIAÇÃO"));
    // "Domínio (N pontos):" — domínio e pontos em <span data-ed> dentro do <b>
    var rot = function (c, cc) {
      var d = txt(c.dominio).trim();
      if (!d) return null;
      var r = [edSpan(d, cj(cc, "dominio"), c.dominio)];
      if (c.pontos != null && c.pontos !== "") r.push(" (", edSpan(fmtPontos(c.pontos), cj(cc, "pontos"), c.pontos), ")");
      r.push(":");
      return r;
    };
    var conteudo = function (c, i, cls) {
      var cc = cj(cBase, i);
      if (typeof c === "string") return ed(el(cls ? "li" : "p", null, md(c)), cc, c);
      var r = rot(c, cc);
      var n = el(cls ? "li" : "p", null, r ? [el("b", cls ? null : "rotulo-inline", r), " ", edSpan(md(c.texto), cj(cc, "texto"), c.texto)] : md(c.texto));
      return r ? n : ed(n, cj(cc, "texto"), c.texto);
    };
    if (ctx.layout === "einstein" || ctx.layout === "unifesp") {
      var ul = el("ul", "gota");
      lst.forEach(function (c, i) { ul.appendChild(conteudo(c, i, true)); });
      out.push(ul);
    } else {
      lst.forEach(function (c, i) { out.push(conteudo(c, i, false)); });
    }
    return out;
  }
  function fmtPontos(v) {
    if (typeof v === "number") return (Number.isInteger(v) ? String(v) : fmtValor(v)) + (v === 1 ? " ponto" : " pontos");
    return txt(v);
  }

  function roteiro(e, ctx) {
    var r = e.roteiro;
    var out = [];
    if (!r || typeof r !== "object") return out;
    var linhas = [];
    if (!vazio(r.cenario_descricao)) linhas.push(rotuloInline("Cenário:", r.cenario_descricao, "roteiro.cenario_descricao"));
    if (!vazio(r.atores)) {
      var a = txt(r.atores).trim();
      var m = a.match(/^((?:Atores|Atrizes|Ator\/Atriz|Ator|Atriz)[^:\n]{0,30}):\s*([\s\S]*)$/i);
      // rótulo tirado do próprio texto: o <p> inteiro exibe o valor
      linhas.push(m ? ed(rotuloInline(m[1] + ":", m[2]), "roteiro.atores", r.atores) : rotuloInline("Ator(es):", a, "roteiro.atores"));
    }
    var mats = r.materiais;
    if (!vazio(mats)) {
      if (Array.isArray(mats)) {
        var pedacos = mats.map(function (s) { return txt(s).trim().replace(/[;.]$/, ""); });
        var junta = pedacos.join(", ");
        if (ctx.layout === "unifesp") {
          linhas.push(p(null, el("b", "rotulo-inline", "Materiais:")));
          // os itens são cópias em texto do array: o caminho aponta para roteiro.materiais.i
          linhas.push(lista({ itens: mats.map(function (s) { return txt(s); }) }, "roteiro.materiais"));
        } else if (ctx.layout === "einstein" && junta.length > 170) {
          linhas.push(p(null, el("b", "rotulo-inline", "Materiais:")));
          linhas.push(listaMarcadores(mats.map(function (s, i) {
            var t = txt(s).trim().replace(/[;.]$/, "");
            return t + (i === mats.length - 1 ? "." : ";");
          }), "materiais", "roteiro.materiais"));
        } else {
          var final = semPontoFinal(junta);
          if (junta === junta.trim() && pedacos.every(mdEquilibrado) && pedacos.every(function (s) { return s !== ""; })) {
            // um <span data-ed> por material, separados por ", " (mesmo texto e mesmo md)
            var filhosM = [];
            pedacos.forEach(function (s, i) {
              if (i) filhosM.push(", ");
              filhosM.push(edSpan(md(s), "roteiro.materiais." + i, mats[i]));
            });
            if (final.length > junta.length) filhosM.push(final.slice(junta.length));
            linhas.push(p(null, [el("b", "rotulo-inline", "Materiais:"), " "].concat(filhosM)));
          } else linhas.push(rotuloInline("Materiais:", final));
        }
      } else linhas.push(rotuloInline("Materiais:", mats, "roteiro.materiais"));
    }
    if (!vazio(r.tempo)) linhas.push(rotuloInline("Tempo:", r.tempo, "roteiro.tempo"));
    if (!vazio(r.obs)) linhas.push(rotuloInline("Obs.:", r.obs, "roteiro.obs"));
    if (!linhas.length) return out;
    out.push(secao("ROTEIRO", "DA ESTAÇÃO"));
    return out.concat(linhas);
  }

  function linhaLocal(e, ctx) {
    if (vazio(e.local)) return [];
    var info = infoBanca(e.banca);
    var t = txt(e.local).trim().replace(/^(LOCAL|CEN[ÁA]RIO)\s*:\s*/i, "");
    // equivale a rotuloAzul(info.local + " " + t): o rótulo fixo não tem marcadores de md
    return [junto(el("div", "rotulo-azul local", [info.local + " ", edSpan(md(t), "local", e.local)]))];
  }

  /* c = { rotulo: caminho do rótulo, blocos: caminho do array de blocos, ini: índice do 1º bloco } */
  function caixaFilipeta(cx, ctx, c) {
    c = c || {};
    var box = el("div", "filipeta");
    var c2 = Object.assign({}, ctx, { dentroCaixa: true });
    var bl = arr(cx.blocos);
    var cBl = cArr(cx.blocos, c.blocos), ini = c.ini || 0;
    var rot = txt(cx.rotulo).trim();
    if (rot && cx.rotulo_em_linha) {
      var primeiro = bl[0];
      var resto = bl, iniResto = ini;
      var pp = p("em-linha", ed(el("b", "rotulo-caixa-inline", rot), c.rotulo, cx.rotulo));
      if (primeiro && (primeiro.tipo === "paragrafo" || typeof primeiro === "string")) {
        pp.appendChild(document.createTextNode(" "));
        var c0 = cj(cBl, ini);
        if (typeof primeiro === "string") pp.appendChild(edSpan(md(primeiro), c0, primeiro));
        else pp.appendChild(edSpan(md(primeiro.texto), cj(c0, "texto"), primeiro.texto));
        resto = bl.slice(1); iniResto = ini + 1;
      }
      box.appendChild(pp);
      blocos(resto, c2, cBl, iniResto).forEach(function (n) { box.appendChild(n); });
      return box;
    }
    if (rot) {
      var soMidia = bl.length > 0 && bl.every(function (b) { return b && (b.tipo === "imagem" || b.tipo === "tabela"); });
      box.appendChild(ed(el("div", "rotulo-caixa" + (soMidia ? " centro" : ""), md(rot)), c.rotulo, cx.rotulo));
    }
    blocos(bl, c2, cBl, ini).forEach(function (n) { box.appendChild(n); });
    return box;
  }
  function caminhoCaixa(base) { return { rotulo: cj(base, "rotulo"), blocos: cj(base, "blocos"), ini: 0 }; }
  /* o <div> inteiro exibe o valor (dividido em <b> + <span class="compl">) */
  function rotuloFilipeta(texto, caminho) {
    var s = txt(texto).trim();
    var d = ed(el("div", "rotulo-filipeta"), caminho, texto);
    if (s.indexOf("**") >= 0) { anexar(d, md(s)); return junto(d); }
    var m = s.match(/^(FILIPETAS?\s*[\dA-Z]*\s*:?)([\s\S]*)$/i);
    if (m && m[2].trim()) anexar(d, [el("b", null, m[1].trim()), " ", el("span", "compl", m[2].trim())]);
    else anexar(d, el("b", null, s));
    return junto(d);
  }
  function filipetas(e, ctx) {
    var out = [];
    var fs = arr(e.filipetas);
    if (!fs.length) return out;
    var cFs = cArr(e.filipetas, "filipetas");
    var caixas = function (f, cf) {
      var cCx = cArr(f.caixas, cj(cf, "caixas"));
      arr(f.caixas).forEach(function (cx, j) { out.push(caixaFilipeta(cx, ctx, caminhoCaixa(cj(cCx, j)))); });
    };
    if (ctx.layout === "unifesp") {
      out.push(junto(el("div", "rotulo-filipeta", el("b", null, "FILIPETAS:"))));
      fs.forEach(function (f, i) {
        var cf = cj(cFs, i);
        out = out.concat(blocos(f.blocos_antes, ctx, cj(cf, "blocos_antes")));
        caixas(f, cf);
        // blocos soltos depois das caixas (ex.: parágrafo explicativo)
        out = out.concat(blocos(f.blocos, ctx, cj(cf, "blocos"))).concat(blocos(f.blocos_depois, ctx, cj(cf, "blocos_depois")));
      });
      return out;
    }
    fs.forEach(function (f, i) {
      var cf = cj(cFs, i);
      out = out.concat(blocos(f.blocos_antes, ctx, cj(cf, "blocos_antes")));
      out.push(f.rotulo ? rotuloFilipeta(f.rotulo, cj(cf, "rotulo")) : rotuloFilipeta("FILIPETA " + (i + 1) + ":"));
      caixas(f, cf);
      out = out.concat(blocos(f.blocos, ctx, cj(cf, "blocos"))).concat(blocos(f.blocos_depois, ctx, cj(cf, "blocos_depois")));
    });
    return out;
  }

  /* Blocos entre filipetas e orientações. Um "rotulo" seguido de tabela(s)/imagem(ns)
     vira caixa de filipeta com o rótulo centralizado (USP-RP: HEMOGRAMA:, RADIOGRAFIA...);
     um "rotulo" sem mídia logo depois fica como rótulo solto preto. */
  function aposFilipetas(e, ctx) {
    var bl = arr(e.apos_filipetas), out = [], i = 0;
    var cAp = cArr(e.apos_filipetas, "apos_filipetas");
    var ehMidia = function (b) { return b && (b.tipo === "tabela" || b.tipo === "imagem"); };
    while (i < bl.length) {
      var b = bl[i];
      if (b && b.tipo === "rotulo" && ehMidia(bl[i + 1])) {
        var j = i + 1, midia = [];
        while (j < bl.length && ehMidia(bl[j])) { midia.push(bl[j]); j++; }
        // caixa montada aqui: o rótulo é apos_filipetas.i.texto e as mídias seguem a partir de i+1
        out.push(caixaFilipeta({ rotulo: b.texto, blocos: midia }, ctx, { rotulo: cj(cj(cAp, i), "texto"), blocos: cAp, ini: i + 1 }));
        i = j; continue;
      }
      out = out.concat(blocos([b], ctx, cAp, i));
      i++;
    }
    return out;
  }

  function orientacoes(e, ctx) {
    var out = [];
    if (!vazio(e.orientacoes_examinador)) {
      out.push(rotuloAzul("ORIENTAÇÕES AO EXAMINADOR:", "rotulo-orient"));
      out = out.concat(blocos(e.orientacoes_examinador, ctx, "orientacoes_examinador"));
    }
    var oa = e.orientacoes_ator;
    if (oa) {
      var bl = Array.isArray(oa) ? oa : oa.blocos;
      if (!vazio(bl)) {
        var doDado = !Array.isArray(oa) && !vazio(oa.rotulo);
        var rot = doDado ? txt(oa.rotulo).trim() : "ORIENTAÇÕES AO ATOR:";
        if (!/:$/.test(rot)) rot += ":";
        var ra = rotuloAzul(rot, "rotulo-orient");
        if (doDado) ed(ra, "orientacoes_ator.rotulo", oa.rotulo);
        out.push(ra);
        out = out.concat(blocos(bl, ctx, Array.isArray(oa) ? "orientacoes_ator" : "orientacoes_ator.blocos"));
      }
    }
    return out;
  }

  /* ----- Checklist ----- */
  function checklist(e, ctx) {
    var ck = e.checklist;
    var out = [];
    if (!ck || !arr(ck.grupos).length) return out;
    var tituloPadrao = ctx.layout === "usp" ? "Checklist fornecido pela banca examinadora" : "Competências técnicas";
    out.push(vazio(ck.titulo_bloco) ? blocoIcone(tituloPadrao) : blocoIcone(txt(ck.titulo_bloco), "checklist.titulo_bloco", ck.titulo_bloco));
    if (ctx.layout !== "usp") out.push(secao("CHECKLIST", "ESPERADO"));
    out.push(tabelaChecklist(ck, ctx));
    return out;
  }
  function tabelaChecklist(ck, ctx) {
    var info = infoBanca(ctx.banca);
    var nomeEscala = ESCALAS[ck.escala] ? ck.escala : info.escala;
    var esc = ESCALAS[nomeEscala];
    var cols = esc.cols.slice(), larg = esc.larg.slice(), itemL = esc.item, valorEm = esc.valorEm;
    var grupos = arr(ck.grupos);
    var todosItens = [];
    grupos.forEach(function (g) { arr(g.itens).forEach(function (it) { todosItens.push(it); }); });
    // USP-RP com pesos: acrescenta coluna VALOR (o modelo da banca não tem; ver relatório)
    if (valorEm < 0 && todosItens.some(function (it) { return typeof it.valor === "number"; })) {
      cols.push("VALOR"); larg.push(9); itemL -= 9; valorEm = cols.length - 1;
    }
    var usaTarefa = grupos.some(function (g) { return !vazio(g.tarefa); });
    if (!usaTarefa) itemL += 10;
    var nCols = (usaTarefa ? 2 : 1) + cols.length;

    var mold = el("div", "checklist-moldura");
    var t = el("table", "checklist esc-" + nomeEscala);
    t.setAttribute("data-tarefas", usaTarefa ? "1" : "0");
    var cg = el("colgroup");
    var colW = (usaTarefa ? [10] : []).concat([itemL]).concat(larg);
    colW.forEach(function (w) { var c = el("col"); c.style.width = w + "%"; cg.appendChild(c); });
    t.appendChild(cg);
    var trh = el("tr");
    if (usaTarefa) trh.appendChild(el("th", null, "TAREFA"));
    trh.appendChild(el("th", null, "ITENS AVALIADOS"));
    cols.forEach(function (c) { trh.appendChild(el("th", null, c)); });
    t.appendChild(el("thead", null, trh));

    var tb = el("tbody");
    var cGr = cArr(ck.grupos, "checklist.grupos");
    grupos.forEach(function (g, gi) {
      var cg_ = cj(cGr, gi);
      if (!vazio(g.titulo)) {
        var trg = el("tr", "grupo");
        var tdg = ed(el("td", null, md(g.titulo)), cj(cg_, "titulo"), g.titulo); tdg.colSpan = nCols;
        trg.appendChild(tdg); tb.appendChild(trg);
      }
      var cIt = cArr(g.itens, cj(cg_, "itens"));
      arr(g.itens).forEach(function (it, ii) {
        var ci_ = cj(cIt, ii);
        var tr = el("tr", "item");
        tr.setAttribute("data-g", String(gi));
        tr.setAttribute("data-tarefa", txt(g.tarefa));
        // normalizarTarefas recria a célula TAREFA a partir destes atributos
        if (typeof g.tarefa === "string" || typeof g.tarefa === "number") { if (cg_ != null) tr.setAttribute("data-ed-tarefa", cj(cg_, "tarefa")); }
        var parcialTxt = txt(it.parcial).trim();
        var naoSeAplica = /^n[ãa]o se aplica\.?$/i.test(parcialTxt);
        var temParcial = parcialTxt && !naoSeAplica;
        var td = el("td", "item");
        var texto = txt(it.texto);
        var temDetalhes = arr(it.detalhes).length > 0;
        var cTexto = cj(ci_, "texto");
        if (ctx.layout === "usp" && (temParcial || !vazio(it.obs)) && texto.indexOf("**") < 0) td.appendChild(ed(el("span", "pergunta", md(texto)), cTexto, it.texto));
        else if (temDetalhes || temParcial || !vazio(it.obs)) td.appendChild(edSpan(md(texto), cTexto, it.texto));
        else ed(anexar(td, md(texto)), cTexto, it.texto); // célula só com o texto
        if (temDetalhes) td.appendChild(listaMarcadores(it.detalhes, null, cArr(it.detalhes, cj(ci_, "detalhes"))));
        if (temParcial) td.appendChild(el("span", "nota-item", [el("b", null, "Parcial:"), " ", edSpan(md(parcialTxt), cj(ci_, "parcial"), it.parcial)]));
        if (!vazio(it.obs)) td.appendChild(el("span", "nota-item", [el("b", null, "Obs.:"), " ", edSpan(md(it.obs), cj(ci_, "obs"), it.obs)]));
        tr.appendChild(td);
        cols.forEach(function (c, ci) {
          var cell = el("td", "marca");
          if (ci === valorEm && it.valor != null && it.valor !== "") {
            cell.className = "valor";
            var v = it.valor;
            var s = fmtValor(typeof v === "number" ? Math.abs(v) : v);
            if (it.negativo || (typeof v === "number" && v < 0)) s = "−" + s;
            cell.textContent = s;
            ed(cell, cj(ci_, "valor"), v);
          }
          if (esc.parcialEm === ci) {
            // "Não se aplica" = célula PARCIAL com fundo K20 (como no PDF); null = célula em branco
            if (naoSeAplica) cell.className = "marca na";
          }
          tr.appendChild(cell);
        });
        tb.appendChild(tr);
      });
    });
    var trt = el("tr", "total");
    var tdr = el("td", "rotulo-total", "PONTUAÇÃO FINAL:"); tdr.colSpan = usaTarefa ? 2 : 1;
    var tdv = el("td", "valor-total"); tdv.colSpan = cols.length;
    trt.appendChild(tdr); trt.appendChild(tdv); tb.appendChild(trt);
    t.appendChild(tb);
    normalizarTarefas(t);
    mold.appendChild(t);
    return mold;
  }
  /* (Re)cria as células TAREFA mescladas conforme as linhas presentes no fragmento */
  function normalizarTarefas(t) {
    if (t.getAttribute("data-tarefas") !== "1") return;
    Array.prototype.slice.call(t.querySelectorAll("td.tarefa")).forEach(function (c) { c.parentNode.removeChild(c); });
    var linhas = Array.prototype.slice.call(t.querySelectorAll("tbody > tr.item"));
    var i = 0;
    while (i < linhas.length) {
      var g = linhas[i].getAttribute("data-g"), j = i;
      while (j + 1 < linhas.length && linhas[j + 1].getAttribute("data-g") === g && linhas[j + 1].previousElementSibling === linhas[j]) j++;
      var td = el("td", "tarefa", linhas[i].getAttribute("data-tarefa"));
      if (linhas[i].hasAttribute("data-ed-tarefa")) td.setAttribute("data-ed", linhas[i].getAttribute("data-ed-tarefa"));
      td.rowSpan = j - i + 1;
      linhas[i].insertBefore(td, linhas[i].firstChild);
      i = j + 1;
    }
  }

  function discussao(e, ctx) {
    var out = [];
    if (!vazio(e.discussao_banca)) {
      out.push(blocoIcone("Discussão"));
      out = out.concat(blocos(e.discussao_banca, ctx, "discussao_banca"));
    }
    var dt = e.discussao_tecnica;
    if (dt) {
      var bl = Array.isArray(dt) ? dt : dt.blocos;
      if (!vazio(bl)) {
        var doDado = !Array.isArray(dt) && !vazio(dt.titulo);
        var tit = doDado ? txt(dt.titulo) : "DISCUSSÃO TÉCNICA";
        var sec = secao(tit);
        if (doDado) ed(sec.firstChild, "discussao_tecnica.titulo", dt.titulo);
        out.push(sec);
        out = out.concat(blocos(bl, ctx, Array.isArray(dt) ? "discussao_tecnica" : "discussao_tecnica.blocos"));
      }
    }
    return out;
  }
  /* caminho do item de lista simples (string) ou do seu .texto (objeto) */
  function caminhoItemTexto(s, c) { return typeof s === "string" ? [c, s] : [cj(c, "texto"), s && s.texto]; }
  function sugestoes(e, ctx) {
    var lst = arr(e.sugestoes_frases);
    if (!lst.length) return [];
    var cSu = cArr(e.sugestoes_frases, "sugestoes_frases");
    var out = [rotuloAzul("SUGESTÕES DE FRASES:")];
    lst.forEach(function (s, i) {
      var t = typeof s === "string" ? s : txt(s && s.texto);
      t = t.trim();
      if (!/^[-–]\s/.test(t)) t = "- " + t;
      var ci = caminhoItemTexto(s, cj(cSu, i));
      out.push(italicoAzul(ed(p("frase-sugerida", md(t)), ci[0], ci[1])));
    });
    return out;
  }
  function referencias(lista_, rotForte, rotLeve, inicio, caminho) {
    var lst = arr(lista_);
    if (!lst.length) return [];
    var r = el("div", "referencias rotulo-ref", el("b", null, rotForte));
    if (rotLeve) { r.appendChild(document.createTextNode(" ")); r.appendChild(el("span", "leve", rotLeve)); }
    r.appendChild(el("b", null, ":"));
    var ol = el("ol", "lista-ref referencias");
    ol.setAttribute("data-inicio", String(inicio || 0));
    if (inicio) ol.style.setProperty("--inicio", String(inicio));
    var cL = cArr(lista_, caminho);
    lst.forEach(function (s, i) {
      var ci = caminhoItemTexto(s, cj(cL, i));
      ol.appendChild(ed(el("li", null, md(typeof s === "string" ? s : txt(s && s.texto))), ci[0], ci[1]));
    });
    return [junto(r), ol];
  }
  function secaoReferencias(e, ctx) {
    var refs = arr(e.referencias), imgs = arr(e.referencias_imagens);
    var out = [];
    if (refs.length) out = out.concat(referencias(refs, "REFERÊNCIAS", imgs.length ? "(discussão técnica)" : null, 0, "referencias"));
    if (imgs.length) out = out.concat(referencias(imgs, "REFERÊNCIAS", "(imagens utilizadas na estação)", refs.length, "referencias_imagens"));
    return out;
  }
  function softSkills(e, ctx) {
    var s = e.soft_skills;
    if (!s || typeof s !== "object") return [];
    var temAlgo = arr(s.itens).length || arr(s.blocos).length || arr(s.referencias).length;
    if (!temAlgo) return [];
    var out = [blocoIcone("Soft Skills")];
    if (arr(s.itens).length) {
      var ul = el("ul", "gota");
      var cSi = cArr(s.itens, "soft_skills.itens");
      s.itens.forEach(function (it, i) {
        var ci = cj(cSi, i);
        var d = txt(it.dominio).trim();
        var cDesc = cj(ci, "descricao");
        if (d) {
          var rb = [edSpan(d, cj(ci, "dominio"), it.dominio)];
          if (it.valor != null && it.valor !== "") rb.push(" (", edSpan(fmtPontos(it.valor), cj(ci, "valor"), it.valor), ")");
          rb.push(":");
          ul.appendChild(el("li", null, [el("b", null, rb), " ", edSpan(md(it.descricao), cDesc, it.descricao)]));
        } else ul.appendChild(ed(el("li", null, md(it.descricao)), cDesc, it.descricao));
      });
      out.push(ul);
    }
    out = out.concat(italicoAzul(blocos(s.blocos, ctx, "soft_skills.blocos")));
    out = out.concat(referencias(s.referencias, "REFERÊNCIAS", null, 0, "soft_skills.referencias"));
    return out;
  }

  /* Ordem das seções por banca (seção 6 da especificação) */
  function montarUnidades(e, ctx) {
    var u = [];
    var add = function (x) { u = u.concat(x); };
    add(abertura(e, ctx));
    if (ctx.layout === "einstein" && !vazio(e.orientacoes_estacao)) {
      add(secao("ORIENTAÇÕES DA ESTAÇÃO"));
      add(blocos(e.orientacoes_estacao, ctx, "orientacoes_estacao"));
    }
    if (!vazio(e.objetivos)) {
      add(secao("OBJETIVOS"));
      add(Array.isArray(e.objetivos) ? blocos(e.objetivos, ctx, "objetivos") : [ed(p(null, md(e.objetivos)), "objetivos", e.objetivos)]);
    }
    add(criterios(e, ctx));
    add(roteiro(e, ctx));
    add(linhaLocal(e, ctx));
    if (e.orientacoes_antes_das_filipetas) add(orientacoes(e, ctx));
    add(filipetas(e, ctx));
    add(aposFilipetas(e, ctx));
    if (!e.orientacoes_antes_das_filipetas) add(orientacoes(e, ctx));
    add(checklist(e, ctx));
    add(discussao(e, ctx));
    add(sugestoes(e, ctx));
    add(secaoReferencias(e, ctx));
    add(softSkills(e, ctx));
    // Einstein procedimento sem "orientacoes_estacao" mas com o campo noutra banca: exibe mesmo assim
    if (ctx.layout !== "einstein" && !vazio(e.orientacoes_estacao)) {
      var ab = u.shift();
      u = [ab, secao("ORIENTAÇÕES DA ESTAÇÃO")].concat(blocos(e.orientacoes_estacao, ctx, "orientacoes_estacao")).concat(u);
    }
    // parágrafo que anuncia a figura/tabela (termina em ":") fica junto dela
    u.forEach(function (n, i) {
      var prox = u[i + 1];
      if (n.tagName === "P" && prox && prox.matches && prox.matches(".figura, .figura-lateral, .tabela-grupo") && /:\s*$/.test(n.textContent)) junto(n);
    });
    return u;
  }

  /* ------------------------------------------------------------------
   * 7. Capa provisória
   * ------------------------------------------------------------------ */
  function capa(e, ctx) {
    var info = infoBanca(e.banca);
    var pg = el("section", "pagina capa");
    var arte = ctx.imagens["__capa__"];
    if (arte && arte.ok) {
      pg.classList.add("com-arte");
      var im = document.createElement("img");
      im.className = "arte"; im.alt = ""; im.src = arte.url;
      pg.appendChild(im);
    }
    pg.appendChild(arcosCapa());
    pg.appendChild(el("div", "logo-capa", ["IMERSÃO PRÁTICA", el("br"), el("span", "hands", "HANDS ON")]));
    var oCheck = el("span", "o-check", "O");
    oCheck.appendChild(svgDe('<svg class="check" xmlns="' + SVGNS + '" viewBox="0 0 40 30" aria-hidden="true"><path d="M3 15 L15 26 L37 3" fill="none" stroke="#3E93C9" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>'));
    pg.appendChild(el("div", "titulo-capa", ["CHECKLISTS", el("br"), "DOMINAD", oCheck, "S"]));
    pg.appendChild(el("div", "pilula-banca", [el("b", null, info.capa), ed(el("span", null, "| " + txt(e.edicao)), "edicao", e.edicao)]));
    var comNumero = tituloComNumero(e);
    pg.appendChild(comNumero ? el("div", "titulo-estacao-capa", comNumero) : ed(el("div", "titulo-estacao-capa", txt(e.titulo)), "titulo", e.titulo));
    pg.appendChild(el("div", "ilustracao-reservada so-tela", ["Espaço reservado para a ilustração da banca.", el("br"),
      "Arquivo esperado: app/marca/capa-" + txt(e.banca) + ".png"]));
    pg.appendChild(el("div", "marca-capa", "Grupo MedCof"));
    return pg;
  }
  function numeroTitulo(e) {
    var t = txt(e.titulo);
    if (e.numero_estacao != null && e.numero_estacao !== "" && !/^Esta[çc][ãa]o\s/i.test(t)) t = "Estação " + e.numero_estacao + " - " + t;
    return t;
  }

  /* ------------------------------------------------------------------
   * 8. Paginação (páginas explícitas de 210 × 297 mm; seção 7)
   * ------------------------------------------------------------------ */
  function novaPagina(container, e) {
    var pg = el("section", "pagina");
    var ct = el("div", "conteudo");
    pg.appendChild(ct);
    container.appendChild(pg);
    return { pagina: pg, conteudo: ct };
  }
  function limite(pag) { return pag.conteudo.getBoundingClientRect().bottom; }
  function cabe(pag, u) {
    var r = u.getBoundingClientRect();
    return r.bottom <= limite(pag) + 0.5;
  }
  function filhos(n) { return Array.prototype.slice.call(n.children); }

  function dividirLista(u, pag) {
    var itens = filhos(u).filter(function (c) { return c.tagName === "LI"; });
    var minimo = u.matches("ol.lista-ref") ? 2 : 1;
    if (itens.length < minimo * 2) return null;
    var resto = u.cloneNode(false);
    var inicio = parseInt(u.getAttribute("data-inicio") || "0", 10);
    var movidos = 0;
    while ((!cabe(pag, u) || movidos < minimo) && itens.length - movidos > minimo) {
      var li = itens[itens.length - 1 - movidos];
      resto.insertBefore(li, resto.firstChild);
      movidos++;
    }
    if (!cabe(pag, u) || movidos < minimo) { // não deu para dividir: devolve tudo
      filhos(resto).forEach(function (li) { u.appendChild(li); });
      return null;
    }
    var novoInicio = inicio + (itens.length - movidos);
    resto.setAttribute("data-inicio", String(novoInicio));
    resto.style.setProperty("--inicio", String(novoInicio));
    resto.style.marginTop = "0";
    return resto;
  }

  function dividirChecklist(u, pag) {
    var t = u.querySelector("table.checklist");
    var tb = t.tBodies[0];
    var linhas = filhos(tb);
    var dados = linhas.filter(function (r) { return !r.classList.contains("total"); });
    if (dados.length < 3) return null;
    var resto = u.cloneNode(false);
    var t2 = t.cloneNode(false);
    t2.appendChild(t.querySelector("colgroup").cloneNode(true));
    var tb2 = el("tbody");
    t2.appendChild(tb2); resto.appendChild(t2);
    var movidos = 0;
    var mover = function () {
      var r = tb.lastElementChild;
      tb2.insertBefore(r, tb2.firstChild);
      movidos++;
      normalizarTarefas(t); normalizarTarefas(t2);
    };
    while (!cabe(pag, u)) {
      if (filhos(tb).filter(function (r) { return !r.classList.contains("total"); }).length <= 2) break;
      mover();
    }
    // a continuação precisa de pelo menos 2 linhas de dados (além da PONTUAÇÃO FINAL)
    var dadosEm = function (corpo) { return filhos(corpo).filter(function (r) { return r.classList.contains("item"); }).length; };
    while (tb2.children.length > 0 && dadosEm(tb2) < 2 && dadosEm(tb) > 2) mover();
    // a linha de agrupamento (USP-RP) não pode ficar sozinha no fim do fragmento
    while (tb.lastElementChild && tb.lastElementChild.classList.contains("grupo") && filhos(tb).length > 2) mover();
    if (!cabe(pag, u) || tb2.children.length === 0) {
      filhos(tb2).forEach(function (r) { tb.appendChild(r); });
      normalizarTarefas(t);
      return null;
    }
    resto.style.marginTop = "0";
    return resto;
  }

  /* Divide um parágrafo por palavras (mín. 2 linhas em cada página).
     As palavras são contadas no texto concatenado do parágrafo (um "token" pode atravessar
     <i>, <b>: ex. "plano?”</i>)." é uma palavra só); <br> conta como espaço. */
  function segmentos(raiz) {
    var segs = [], texto = "";
    var w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    while (w.nextNode()) {
      var n = w.currentNode;
      if (n.nodeType === 3) { segs.push({ no: n, ini: texto.length }); texto += n.data; }
      else if (n.nodeName === "BR") { segs.push({ no: n, ini: texto.length, br: true }); texto += "\n"; }
    }
    return { segs: segs, texto: texto };
  }
  function contarPalavras(no) {
    var m = segmentos(no).texto.match(/\S+/g);
    return m ? m.length : 0;
  }
  function cortar(orig, n, parte) {
    var c = orig.cloneNode(true);
    var sg = segmentos(c);
    var re = /\S+/g, m, k = 0, fimN = sg.texto.length, iniProx = sg.texto.length;
    while ((m = re.exec(sg.texto))) {
      k++;
      if (k === n) fimN = m.index + m[0].length;
      if (k === n + 1) { iniProx = m.index; break; }
    }
    sg.segs.forEach(function (sgm) {
      if (sgm.br) {
        if ((parte === 0 && sgm.ini >= fimN) || (parte === 1 && sgm.ini < iniProx)) sgm.no.parentNode.removeChild(sgm.no);
        return;
      }
      var d = sgm.no.data, a = sgm.ini, b = a + d.length;
      if (parte === 0) sgm.no.data = d.slice(0, Math.max(0, Math.min(b, fimN) - a));
      else sgm.no.data = b <= iniProx ? "" : d.slice(Math.max(0, iniProx - a));
    });
    if (parte === 0) { // remove espaços e <br> pendentes no fim
      var ult = c.lastChild;
      while (ult && ((ult.nodeType === 3 && !ult.data.trim()) || ult.nodeName === "BR")) { var a2 = ult.previousSibling; c.removeChild(ult); ult = a2; }
    }
    return c;
  }
  function dividirParagrafo(u, pag) {
    if (u.classList.contains("nota") && false) return null;
    var lh = parseFloat(getComputedStyle(u).lineHeight) || 16;
    var r = u.getBoundingClientRect();
    var escala = r.height / (u.offsetHeight || r.height || 1); // tolera zoom
    lh = lh * (isFinite(escala) && escala > 0 ? escala : 1);
    var total = Math.round(r.height / lh);
    var disp = Math.floor((limite(pag) - r.top + 0.5) / lh);
    if (disp > total - 2) disp = total - 2;
    if (disp < 2) return null;
    var orig = u.cloneNode(true);
    var nPal = contarPalavras(orig);
    if (nPal < 6) return null;
    var aplicar = function (k) {
      var parteA = cortar(orig, k, 0);
      while (u.firstChild) u.removeChild(u.firstChild);
      while (parteA.firstChild) u.appendChild(parteA.firstChild);
    };
    u.classList.add("continua");
    var lo = 1, hi = nPal - 1, melhor = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      aplicar(mid);
      if (u.getBoundingClientRect().height <= disp * lh + 1) { melhor = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (!melhor) {
      while (u.firstChild) u.removeChild(u.firstChild);
      while (orig.firstChild) u.appendChild(orig.firstChild);
      u.classList.remove("continua");
      return null;
    }
    aplicar(melhor);
    var resto = cortar(orig, melhor, 1);
    resto.classList.remove("continua");
    resto.style.marginTop = "0";
    return resto;
  }
  function tentarDividir(u, pag) {
    if (u.matches(".checklist-moldura")) return dividirChecklist(u, pag);
    if (u.matches("ul.gota, ol.numerada, ol.lista-ref, ul.marcadores")) return dividirLista(u, pag);
    if (u.tagName === "P" && !u.closest(".filipeta")) return dividirParagrafo(u, pag);
    return null;
  }

  function paginar(container, unidades) {
    var paginas = [];
    var pag = novaPagina(container); paginas.push(pag);
    var fila = unidades.slice();
    var guarda = 0;
    while (fila.length && guarda++ < 5000) {
      var u = fila.shift();
      pag.conteudo.appendChild(u);
      if (cabe(pag, u)) continue;
      var resto = tentarDividir(u, pag);
      if (resto) {
        fila.unshift(resto);
        pag = novaPagina(container); paginas.push(pag);
        continue;
      }
      var irmaos = filhos(pag.conteudo);
      if (irmaos.length === 1) { // sozinho e maior que a página: fica (cortado) e segue
        if (fila.length) { pag = novaPagina(container); paginas.push(pag); }
        continue;
      }
      // move a unidade e os rótulos "manter com o próximo" que a precedem
      var mover = [u];
      var k = irmaos.length - 2;
      while (k >= 0 && irmaos[k].getAttribute("data-junto") === "1") { mover.unshift(irmaos[k]); k--; }
      if (k < 0) { // a página inteira seria movida: aceita o estouro
        if (fila.length) { pag = novaPagina(container); paginas.push(pag); }
        continue;
      }
      mover.forEach(function (n) { pag.conteudo.removeChild(n); });
      pag = novaPagina(container); paginas.push(pag);
      fila = mover.concat(fila);
    }
    return paginas;
  }

  function rodape(e, numero) {
    var info = infoBanca(e.banca);
    var d = el("div", "rodape");
    d.appendChild(el("span", null, [el("b", null, "CHECKLIST DOMINADO |"), " " + info.rodape + (vazio(e.edicao) ? "" : " " + txt(e.edicao))]));
    d.appendChild(el("span", "selo", String(numero)));
    return d;
  }

  /* ------------------------------------------------------------------
   * 9. Entrada principal
   * ------------------------------------------------------------------ */
  function diagramar(container, e, opcoes) {
    opcoes = opcoes || {};
    var ctx = {
      banca: e.banca, layout: infoBanca(e.banca).layout,
      base: opcoes.base || "", blobs: opcoes.blobs || {}, imagens: {}, dentroCaixa: false
    };
    var urls = coletarImagens(e, []).map(function (a) { return resolverImagem(a, ctx); });
    var tarefas = urls.map(function (url) {
      return preCarregar(url).then(function (r) { r.url = url; ctx.imagens[url] = r; });
    });
    if (opcoes.capa) {
      var urlCapa = opcoes.urlCapa || ("marca/capa-" + e.banca + ".png");
      tarefas.push(preCarregar(urlCapa, 4000).then(function (r) { r.url = urlCapa; ctx.imagens.__capa__ = r; }));
    }
    var fontes = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    return Promise.all(tarefas.concat([fontes])).then(function () {
      while (container.firstChild) container.removeChild(container.firstChild);
      container.classList.add("documento");
      Object.keys(BANCAS).forEach(function (b) { container.classList.remove("banca-" + b); });
      container.classList.add("banca-" + e.banca);
      var numero = 1;
      if (opcoes.capa) { container.appendChild(capa(e, ctx)); numero = 2; }
      var unidades = montarUnidades(e, ctx);
      var paginas = paginar(container, unidades);
      paginas.forEach(function (pg, i) {
        pg.pagina.appendChild(rodape(e, numero + i));
      });
      // ornamento de arcos na última página da estação (5.12)
      var ult = paginas[paginas.length - 1];
      if (ult) {
        ult.pagina.insertBefore(ornamentoFim(), ult.pagina.firstChild);
        var last = ult.conteudo.lastElementChild;
        if (last) {
          var usado = last.getBoundingClientRect().bottom - ult.conteudo.getBoundingClientRect().top;
          var mm = ult.pagina.getBoundingClientRect().width / 210;
          if (usado < 100 * mm) ult.pagina.insertBefore(ornamentoGrande(), ult.pagina.firstChild);
        }
      }
      return { paginas: paginas.length + (opcoes.capa ? 1 : 0), imagens: ctx.imagens };
    });
  }

  /* ------------------------------------------------------------------
   * 10. Fluxo contínuo (módulo online) — ACRÉSCIMO de 16/11/2026
   * Desenha as seções pedidas em blocos corridos, SEM paginação A4, para as
   * telas de ator e aplicador. Recebe o objeto JÁ FILTRADO pelo servidor:
   * esta função não esconde nada, só desenha o que chegou.
   * Nada acima foi alterado: diagramar() e a impressão seguem iguais.
   *   montarFluxo(container, estacao, opcoes) -> Promise<{unidades, imagens}>
   *   opcoes.secoes  : nomes, na ordem desejada (padrão: a mesma ordem do impresso)
   *       abertura, orientacoes_estacao, objetivos, criterios, roteiro, local,
   *       filipetas, apos_filipetas, orientacoes, orientacoes_examinador,
   *       orientacoes_ator, checklist, discussao, sugestoes, referencias,
   *       soft_skills, soft_skills_blocos
   *   opcoes.imagens : { "img/x.png": "https://…assinada" } — troca o caminho
   *                    pela URL antes de desenhar (imagem sem URL = "pendente")
   *   opcoes.base    : prefixo para caminhos relativos (padrão: nenhum)
   *   opcoes.manterEd: true mantém os atributos data-ed (padrão: retira)
   * ------------------------------------------------------------------ */
  function trocarImagens(valor, mapa) {
    if (Array.isArray(valor)) return valor.map(function (v) { return trocarImagens(v, mapa); });
    if (valor && typeof valor === "object") {
      var novo = {};
      Object.keys(valor).forEach(function (k) {
        if (k === "arquivo" && typeof valor[k] === "string") {
          novo[k] = Object.prototype.hasOwnProperty.call(mapa, valor[k]) ? mapa[valor[k]] : valor[k];
        } else novo[k] = trocarImagens(valor[k], mapa);
      });
      return novo;
    }
    return valor;
  }
  function secaoFluxo(nome, e, ctx) {
    switch (nome) {
      case "abertura": return [abertura(e, ctx)];
      case "orientacoes_estacao":
        return vazio(e.orientacoes_estacao) ? [] : [secao("ORIENTAÇÕES DA ESTAÇÃO")].concat(blocos(e.orientacoes_estacao, ctx, "orientacoes_estacao"));
      case "objetivos":
        if (vazio(e.objetivos)) return [];
        return [secao("OBJETIVOS")].concat(Array.isArray(e.objetivos) ? blocos(e.objetivos, ctx, "objetivos") : [p(null, md(e.objetivos))]);
      case "criterios": return criterios(e, ctx);
      case "roteiro": return roteiro(e, ctx);
      case "local": return linhaLocal(e, ctx);
      case "filipetas": return filipetas(e, ctx);
      case "apos_filipetas": return aposFilipetas(e, ctx);
      case "orientacoes": return orientacoes(e, ctx);
      case "orientacoes_examinador": return orientacoes(Object.assign({}, e, { orientacoes_ator: null }), ctx);
      case "orientacoes_ator": return orientacoes(Object.assign({}, e, { orientacoes_examinador: null }), ctx);
      case "checklist": return checklist(e, ctx);
      case "discussao": return discussao(e, ctx);
      case "sugestoes": return sugestoes(e, ctx);
      case "referencias": return secaoReferencias(e, ctx);
      case "soft_skills": return softSkills(e, ctx);
      case "soft_skills_blocos":
        var s = e.soft_skills;
        return (s && typeof s === "object") ? italicoAzul(blocos(s.blocos, ctx, "soft_skills.blocos")) : [];
      default: return [];
    }
  }
  function montarFluxo(container, estacao, opcoes) {
    opcoes = opcoes || {};
    var e = trocarImagens(estacao || {}, opcoes.imagens || {});
    var ctx = {
      banca: e.banca, layout: infoBanca(e.banca).layout,
      base: opcoes.base || "", blobs: {}, imagens: {}, dentroCaixa: false
    };
    var urls = coletarImagens(e, []).map(function (a) { return resolverImagem(a, ctx); });
    var tarefas = urls.map(function (url) {
      return preCarregar(url).then(function (r) { r.url = url; ctx.imagens[url] = r; });
    });
    return Promise.all(tarefas).then(function () {
      while (container.firstChild) container.removeChild(container.firstChild);
      container.classList.add("documento", "fluxo", "layout-" + ctx.layout);
      Object.keys(BANCAS).forEach(function (b) { container.classList.remove("banca-" + b); });
      if (e.banca) container.classList.add("banca-" + e.banca);
      var unidades;
      if (Array.isArray(opcoes.secoes)) {
        unidades = [];
        opcoes.secoes.forEach(function (nome) { unidades = unidades.concat(secaoFluxo(nome, e, ctx)); });
      } else unidades = montarUnidades(e, ctx);
      unidades.forEach(function (u) { if (u) container.appendChild(u); });
      if (!opcoes.manterEd) {
        Array.prototype.forEach.call(container.querySelectorAll("[data-ed],[data-junto]"), function (n) {
          n.removeAttribute("data-ed"); n.removeAttribute("data-junto");
        });
      }
      return { unidades: unidades.length, imagens: ctx.imagens };
    });
  }

  window.Diagramador = {
    BANCAS: BANCAS,
    ESCALAS: ESCALAS,
    infoBanca: infoBanca,
    diagramar: diagramar,
    montarFluxo: montarFluxo,
    md: md,
    fmtValor: fmtValor,
    _teste: { cortar: cortar, contarPalavras: contarPalavras } // só para testes automatizados
  };
})();
