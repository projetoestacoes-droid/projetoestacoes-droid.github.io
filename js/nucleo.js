/* =====================================================================
 * nucleo.js — Núcleo do módulo online (Projeto Estações)
 *
 * window.Online = {
 *   sb                         cliente supabase-js (no demo: um cliente falso)
 *   rpc(nome, args)            -> Promise<dados>; lança Error com .code
 *                                 ('sem_permissao', 'rede', 'nao_autenticado', …)
 *   eu()                       -> {id, nome, perfil} (cache da sessão)
 *   registrarTela(perfil, { titulo, montar(container, ctx) })
 *   el(tag, cls, texto|filhos), md(texto), toast(msg, tipo), confirmar(msg, op) -> Promise<bool>
 *   perguntar(msg, op)         -> Promise<string|null> (caixa de texto; ex.: motivo)
 *   renderFluxo(container, conteudoFiltrado, opcoes) -> Promise (Diagramador.montarFluxo)
 *   urlImagem(pub, arquivo)    -> Promise<url assinada>
 *   imagensDaEstacao(sessaoEstacaoId) -> Promise<{ "img/x.png": url }>
 *   nav.abrir(titulo, montar), nav.voltar()   navegação com o botão "voltar"
 *   nota.*                     cálculo LOCAL (só estimativa na tela; a nota oficial é do servidor)
 *   fmt(n), estaOnline(), aoMudarRede(fn), demo (bool)
 * }
 * ctx entregue a montar(container, ctx): { eu, demo, nav, Online }
 *
 * Segurança: o filtro por perfil é feito no SERVIDOR (RPCs SECURITY DEFINER com
 * lista branca). Esta interface só desenha o que chegou; nada é escondido por CSS.
 * Sem innerHTML com dados: todo texto vira nó de texto.
 * ===================================================================== */
(function () {
  "use strict";
  var params = new URLSearchParams(location.search);
  /* Modo prévia (?previa=aplicador|ator|aluno): as telas reais de cada perfil, com o conteúdo
     que o Estúdio passa, SÓ dentro de um iframe do próprio Estúdio (mesma origem, com
     window.EstudioPrevia). Nada vai ao servidor a partir daqui: os dados vêm do Estúdio (js/previa.js). */
  var PAPEIS_PREVIA = { aplicador: true, ator: true, aluno: true };
  var papelPrevia = PAPEIS_PREVIA.hasOwnProperty(params.get("previa") || "") ? params.get("previa") : null;
  var dentroDoEstudio = false;
  if (papelPrevia && window.top !== window.self) {
    try {
      dentroDoEstudio = window.parent.location.origin === location.origin &&
        !!window.parent.EstudioPrevia && typeof window.parent.EstudioPrevia.obter === "function";
    } catch (e) { dentroDoEstudio = false; }   /* pai de outra origem: o acesso lança */
  }
  /* Proteção contra exibir o site dentro de outra página (clickjacking); o GitHub Pages não envia cabeçalhos.
     Única exceção: a prévia dentro do Estúdio (conferida acima). */
  if (window.top !== window.self && !dentroDoEstudio) { document.documentElement.style.display = "none"; try { window.top.location = window.self.location; } catch (e) { /* nada */ } return; }

  var CFG = window.ONLINE_CONFIG || {};
  var MODO_PREVIA = !!(papelPrevia && dentroDoEstudio);
  var PREVIA_FORA = !!(papelPrevia && !dentroDoEstudio);       /* ?previa=… aberto fora do Estúdio */
  var MODO_DEMO = !MODO_PREVIA && !PREVIA_FORA && params.get("demo") === "1";
  var telas = {};
  var estado = { eu: null, iniciado: false };
  var ouvintesRede = [];
  var antesDeSair = [];

  /* ------------------------------------------------------------------
   * Utilidades de DOM (sem innerHTML)
   * ------------------------------------------------------------------ */
  function anexar(n, filhos) {
    if (filhos == null || filhos === false) return n;
    if (!Array.isArray(filhos)) filhos = [filhos];
    filhos.forEach(function (f) {
      if (f == null || f === false) return;
      if (typeof f === "string" || typeof f === "number") n.appendChild(document.createTextNode(String(f)));
      else n.appendChild(f);
    });
    return n;
  }
  function el(tag, cls, filhos) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return anexar(n, filhos);
  }
  function limpar(n) { while (n && n.firstChild) n.removeChild(n.firstChild); return n; }
  function md(texto) {
    if (window.Diagramador && window.Diagramador.md) return window.Diagramador.md(texto);
    return document.createTextNode(texto == null ? "" : String(texto));
  }
  function botao(texto, cls, aoClicar) {
    var b = el("button", "on-btn" + (cls ? " " + cls : ""), texto);
    b.type = "button";
    if (aoClicar) b.addEventListener("click", aoClicar);
    return b;
  }
  /* número com vírgula; inteiros sem casas */
  function fmt(n, casas) {
    if (n == null || n === "" || isNaN(Number(n))) return "–";
    var v = Number(n);
    var s = Number.isInteger(v) ? String(v) : v.toFixed(casas == null ? 2 : casas).replace(/0+$/, "").replace(/\.$/, "");
    return s.replace(".", ",");
  }
  function fmtData(d) {
    if (!d) return "";
    var m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + "/" + m[2] + "/" + m[1] : String(d);
  }

  /* ------------------------------------------------------------------
   * Avisos (toast) e diálogos
   * ------------------------------------------------------------------ */
  function toast(msg, tipo) {
    var area = document.getElementById("on-toasts");
    if (!area) { area = el("div", "on-toasts"); area.id = "on-toasts"; area.setAttribute("aria-live", "polite"); document.body.appendChild(area); }
    var t = el("div", "on-toast " + (tipo ? "on-toast-" + tipo : ""), msg);
    area.appendChild(t);
    setTimeout(function () { t.classList.add("sai"); }, tipo === "erro" ? 6000 : 3500);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, tipo === "erro" ? 6600 : 4100);
  }
  function dialogo(conteudo, botoes) {
    return new Promise(function (ok) {
      var fundo = el("div", "on-dialogo-fundo");
      var caixa = el("div", "on-dialogo");
      caixa.setAttribute("role", "dialog"); caixa.setAttribute("aria-modal", "true");
      anexar(caixa, conteudo);
      var linha = el("div", "on-dialogo-botoes");
      var fechar = function (v) { document.removeEventListener("keydown", tecla); if (fundo.parentNode) fundo.parentNode.removeChild(fundo); ok(v); };
      var tecla = function (ev) { if (ev.key === "Escape") fechar(botoes.cancelar); };
      botoes.lista.forEach(function (b) { linha.appendChild(botao(b.texto, b.cls, function () { fechar(b.valor()); })); });
      caixa.appendChild(linha);
      fundo.appendChild(caixa);
      document.body.appendChild(fundo);
      document.addEventListener("keydown", tecla);
      var foco = caixa.querySelector("textarea, input") || linha.lastChild;
      if (foco) foco.focus();
    });
  }
  function confirmar(msg, op) {
    op = op || {};
    return dialogo([el("p", "on-dialogo-msg", msg)], { cancelar: false, lista: [
      { texto: op.cancelar || "Cancelar", cls: "on-btn-sec", valor: function () { return false; } },
      { texto: op.ok || "Confirmar", cls: op.perigo ? "on-btn-perigo" : "on-btn-pri", valor: function () { return true; } }
    ] });
  }
  function perguntar(msg, op) {
    op = op || {};
    var campo = el("textarea", "on-campo");
    campo.rows = 3; campo.placeholder = op.placeholder || ""; if (op.valor) campo.value = op.valor;
    return dialogo([el("p", "on-dialogo-msg", msg), campo], { cancelar: null, lista: [
      { texto: "Cancelar", cls: "on-btn-sec", valor: function () { return null; } },
      { texto: op.ok || "OK", cls: "on-btn-pri", valor: function () { return campo.value.trim() || null; } }
    ] });
  }

  /* ------------------------------------------------------------------
   * Rede
   * ------------------------------------------------------------------ */
  function estaOnline() {
    if (window.Demo && window.Demo.semConexao) return false;
    return navigator.onLine !== false;
  }
  function avisarRede() { var on = estaOnline(); ouvintesRede.forEach(function (fn) { try { fn(on); } catch (e) { console.error(e); } }); atualizarSelo(); }
  window.addEventListener("online", avisarRede);
  window.addEventListener("offline", avisarRede);
  window.addEventListener("estacoes:rede", avisarRede);
  function aoMudarRede(fn) { ouvintesRede.push(fn); return function () { ouvintesRede = ouvintesRede.filter(function (f) { return f !== fn; }); }; }
  function atualizarSelo() {
    var s = document.getElementById("on-selo-rede");
    if (!s) return;
    var on = estaOnline();
    s.textContent = on ? "" : "Sem conexão";
    s.hidden = on;
  }

  /* ------------------------------------------------------------------
   * Backend: Supabase real ou demonstração (demo.js, só com ?demo=1)
   * ------------------------------------------------------------------ */
  function carregarScript(src) {
    return new Promise(function (ok, falha) {
      var s = document.createElement("script");
      s.src = src; s.async = false;
      if (/^https:/.test(src)) { s.crossOrigin = "anonymous"; s.referrerPolicy = "no-referrer"; }
      // integridade (SRI): o navegador recusa o arquivo do CDN se ele for alterado
      if (src === CFG.supabaseJs && CFG.supabaseJsSri) s.integrity = CFG.supabaseJsSri;
      s.onload = function () { ok(); };
      s.onerror = function () { falha(new Error("Não foi possível carregar " + src)); };
      document.head.appendChild(s);
    });
  }
  function erroDe(e, nomeRpc) {
    var msg = (e && (e.message || e.msg)) || String(e || "erro");
    var err = new Error(msg);
    err.pgcode = e && e.code;
    err.detalhes = e && (e.details || e.hint);
    var token = (msg.match(/^([a-z_]+)(?::|$)/) || [])[1];
    if (/failed to fetch|networkerror|load failed|network request failed|fetch/i.test(msg) && !token) err.code = "rede";
    else if (token) err.code = token;
    else if (e && e.code === "PGRST301") err.code = "nao_autenticado";
    else err.code = (e && e.code) || "erro";
    if (!estaOnline()) err.code = err.code === "erro" ? "rede" : err.code;
    err.rpc = nomeRpc;
    return err;
  }
  function rpc(nome, args) {
    if (MODO_PREVIA) {
      if (!window.Previa) return Promise.reject(Object.assign(new Error("previa_indisponivel"), { code: "previa_indisponivel" }));
      return Promise.resolve().then(function () { return window.Previa.rpc(nome, args || {}); })
        .catch(function (e) { throw erroDe(e, nome); }).then(function (d) { return d; }, tratarSemPermissao);
    }
    if (MODO_DEMO) {
      if (!window.Demo) return Promise.reject(Object.assign(new Error("demo_indisponivel"), { code: "demo_indisponivel" }));
      return window.Demo.rpc(nome, args || {}).catch(function (e) { throw erroDe(e, nome); }).then(function (d) { return d; }, tratarSemPermissao);
    }
    if (!Online.sb) return Promise.reject(Object.assign(new Error("sem_cliente"), { code: "sem_cliente" }));
    return Promise.resolve().then(function () {
      return Online.sb.rpc(nome, args || {});
    }).then(function (r) {
      if (r.error) throw erroDe(r.error, nome);
      return r.data;
    }, function (e) { throw erroDe(e, nome); }).catch(tratarSemPermissao);
  }
  function tratarSemPermissao(err) {
    if (err && err.code === "sem_permissao") toast("Você não tem permissão para isso.", "erro");
    if (err && err.code === "nao_autenticado" && !MODO_DEMO && !MODO_PREVIA) { toast("Sua sessão expirou. Entre de novo.", "erro"); }
    throw err;
  }

  function imagensDaEstacao(sessaoEstacaoId) {
    return rpc("imagens_permitidas", { p_sessao_estacao_id: sessaoEstacaoId }).then(function (caminhos) {
      caminhos = Array.isArray(caminhos) ? caminhos : [];
      if (!caminhos.length) return {};
      return Online.sb.storage.from(CFG.bucket || "estacoes").createSignedUrls(caminhos, CFG.validadeUrlImagem || 900).then(function (r) {
        var mapa = {};
        if (r.error) { console.warn("URLs assinadas:", r.error.message); return mapa; }
        (r.data || []).forEach(function (x) {
          if (!x || !x.signedUrl) return;
          var rel = String(x.path || "").replace(/^[^/]+\//, ""); /* "<pub>/img/x.png" -> "img/x.png" */
          mapa[rel] = x.signedUrl;
        });
        return mapa;
      });
    }).catch(function (e) { console.warn("imagens_permitidas:", e.message); return {}; });
  }
  function urlImagem(pub, arquivo) {
    var caminho = String(pub) + "/" + String(arquivo).replace(/^\/+/, "");
    return Online.sb.storage.from(CFG.bucket || "estacoes").createSignedUrl(caminho, CFG.validadeUrlImagem || 900).then(function (r) {
      if (r.error) throw erroDe(r.error, "createSignedUrl");
      return r.data.signedUrl;
    });
  }
  function renderFluxo(container, conteudo, opcoes) {
    if (!window.Diagramador || !window.Diagramador.montarFluxo) {
      limpar(container).appendChild(el("p", "on-erro", "Não foi possível carregar o diagramador."));
      return Promise.resolve();
    }
    return window.Diagramador.montarFluxo(container, conteudo, opcoes || {});
  }

  /* ------------------------------------------------------------------
   * Nota — cálculo LOCAL só para o "total parcial" na tela do aplicador.
   * A nota oficial é recalculada no servidor (privado.calcular_nota).
   * Regras provisórias (contrato, D1–D7 — confirmar com o Alexandre).
   * ------------------------------------------------------------------ */
  var NIVEIS = ["Inapropriado", "Algo insatisfatório", "Algo satisfatório", "Adequado", "Acima das expectativas"];
  var RE_TECNICA = /^compet[eê]ncias? t[eé]cnicas?$/;
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function ehNaoSeAplica(t) { return /^n[ãa]o se aplica/.test(String(t || "").trim().toLowerCase()); }
  /* "regras" = objeto "pontuacao" que o servidor devolve em estacao_para_aplicador
     (privado.regras_pontuacao). Quando vem, ele manda; sem ele (ex.: pré-visualização),
     o cálculo local usa as mesmas regras provisórias D1–D7. */
  function itensDoChecklist(c, regras) {
    var ck = (c && c.checklist) || {};
    var escala = ck.escala;
    var ri = (regras && regras.itens) || null;
    var lista = [];
    (ck.grupos || []).forEach(function (g, gi) {
      (g.itens || []).forEach(function (it, ii) {
        lista.push({ chave: gi + "." + ii, g: gi, i: ii, grupo: g, item: it, negativo: !!it.negativo, valor: num(it.valor) != null ? Math.abs(it.valor) : null });
      });
    });
    var semPeso = regras && typeof regras.sem_pesos === "boolean" ? regras.sem_pesos :
                  (escala === "sim-parcial-nao" && lista.every(function (x) { return x.valor == null; }));
    var credito = regras && typeof regras.credito_parcial === "boolean" ? regras.credito_parcial : (escala === "valor-pontos" || escala === "sim-nao-valor");
    lista.forEach(function (x) {
      var r = ri && ri[x.chave];
      if (x.valor == null && semPeso) x.valor = 1;                       /* D1: sem pesos, cada item vale 1 */
      var pt = x.item.parcial;
      var temTexto = typeof pt === "string" && pt.trim() !== "";
      /* D1b: parcial null também oferece Parcial; "Não se aplica" -> só Sim/Não */
      x.permiteParcial = escala === "sim-parcial-nao" && !x.negativo && (temTexto ? !ehNaoSeAplica(pt) : true);
      x.textoParcial = temTexto && !ehNaoSeAplica(pt) ? pt : null;
      /* D5: crédito parcial em pontos nas escalas com valor por item */
      x.permitePontos = credito && !x.negativo && (x.valor || 0) > 0;
      if (r) {
        if (num(r.valor) != null) x.valor = r.valor;
        x.negativo = !!r.negativo;
        x.permiteParcial = !!r.permite_parcial;
        x.permitePontos = !!r.credito_parcial && (x.valor || 0) > 0;
      }
    });
    return { escala: escala, itens: lista, semPeso: semPeso, titulo: nomeTecnica(c),
             fracao: regras && num(regras.parcial_fracao) != null ? regras.parcial_fracao : 0.5,
             normalizar: regras && num(regras.normalizar_para) != null ? regras.normalizar_para : 10,
             piso: regras && typeof regras.negativo_piso_zero === "boolean" ? regras.negativo_piso_zero : true };
  }
  /* nome do domínio técnico: o de "criterios", ou "Técnica" (igual ao servidor) */
  function nomeTecnica(c) {
    var t = ((c && c.criterios) || []).filter(function (x) { return x && typeof x === "object" && RE_TECNICA.test(String(x.dominio || "").trim().toLowerCase()); })[0];
    return t ? t.dominio : "Técnica";
  }
  /* D4b: sem soft_skills.itens (e com soft_skills presente), deriva os domínios de "criterios" */
  function dominiosSoft(c, regras) {
    if (regras && Array.isArray(regras.soft)) {
      var s0 = c && c.soft_skills, itens0 = (s0 && Array.isArray(s0.itens)) ? s0.itens : [];
      var derivado = !itens0.length || !!(itens0[0] && itens0[0].derivado_de_criterios);
      return regras.soft.map(function (d) {
        var orig = itens0[d.indice] || ((c.criterios || []).filter(function (cr) { return cr && cr.dominio === d.dominio; })[0] || {});
        return { k: d.indice, dominio: d.dominio, descricao: (orig.descricao || orig.texto) || "", valor: num(d.maximo), derivado: derivado,
                 niveis: (d.niveis || []).map(function (n) { return n.pontos; }), rotulos: (d.niveis || []).map(function (n) { return n.rotulo; }) };
      });
    }
    var s = c && c.soft_skills;
    if (s && Array.isArray(s.itens) && s.itens.length) {
      return s.itens.map(function (it, k) { return { k: k, dominio: it.dominio || ("Domínio " + (k + 1)), descricao: it.descricao || "", valor: num(it.valor) }; });
    }
    if (!(s && typeof s === "object")) return [];
    return (c.criterios || []).filter(function (cr) {
      return cr && typeof cr === "object" && num(cr.pontos) != null && String(cr.dominio || "").trim() && !RE_TECNICA.test(String(cr.dominio).trim().toLowerCase());
    }).map(function (cr, k) { return { k: k, dominio: cr.dominio, descricao: cr.texto || "", valor: cr.pontos, derivado: true }; });
  }
  /* D4: 5 níveis -> pontos (o servidor manda a tabela em "regras"; aqui, a mesma regra provisória) */
  function pontosDosNiveis(valor, dominio) {
    if (dominio && Array.isArray(dominio.niveis) && dominio.niveis.length) return dominio.niveis;
    if (valor === 20) return [0, 5, 10, 15, 20];
    if (valor === 30) return [0, 10, 20, 25, 30];
    return [0, 0.25, 0.5, 0.75, 1].map(function (f) { return Math.round(valor * f * 100) / 100; });
  }
  /* marc = { itens: {"g.i": "sim"|"nao"|"parcial"|{pontos}|número}, soft: {"k": {nivel}|nivel} } */
  function calcular(c, marc, regras) {
    marc = marc || {};
    var itensM = marc.itens || {}, softM = marc.soft || {};
    var ck = itensDoChecklist(c, regras);
    var pts = 0, desc = 0, max = 0, semMarca = 0;
    ck.itens.forEach(function (x) {
      var m = itensM[x.chave];
      var v = x.valor || 0;
      if (m == null) semMarca++;
      if (x.negativo) { if (m === "sim") desc += v; return; }      /* D2: fora do máximo; desconta */
      max += v;
      var p = typeof m === "number" ? m : (m && typeof m === "object" ? num(m.pontos) : null);
      if (m === "sim") pts += v;
      else if (m === "parcial") pts += v * ck.fracao;                /* D1: Parcial = fração (0,5) */
      else if (p != null) pts += Math.max(0, Math.min(v, p));       /* D5: limitado a 0..valor */
    });
    var tec = pts - desc;
    if (tec < 0 && ck.piso) tec = 0;                                 /* D2: piso 0 */
    var tecMax = max;
    if (ck.semPeso && max > 0) { tec = tec / max * ck.normalizar; tecMax = ck.normalizar; } /* D1: 0–10 */
    var doms = [{ dominio: ck.titulo, nota: arred(tec), maximo: arred(tecMax) }];
    var soft = 0, softMax = 0;
    dominiosSoft(c, regras).forEach(function (d) {
      var s = softM[String(d.k)];
      var nivel = typeof s === "number" ? s : (s && typeof s === "object" ? num(s.nivel) : null);
      var p = nivel == null || nivel < 0 || d.valor == null ? null : pontosDosNiveis(d.valor, d)[nivel];
      if (nivel == null || nivel < 0) semMarca++;
      soft += p || 0; softMax += d.valor || 0;
      doms.push({ dominio: d.dominio, nota: p == null ? null : p, maximo: d.valor });
    });
    return { tecnica: arred(tec), tecnicaMax: arred(tecMax), soft: arred(soft), softMax: arred(softMax),
             total: arred(tec + soft), maximo: arred(tecMax + softMax), dominios: doms, semMarca: semMarca };
  }
  function arred(n) { return Math.round(n * 100) / 100; }

  /* ------------------------------------------------------------------
   * Navegação (pilha simples ligada ao botão "voltar" do aparelho)
   * ------------------------------------------------------------------ */
  var pilha = [];
  var nav = {
    abrir: function (titulo, montar, op) {
      op = op || {};
      var antes = pilha[pilha.length - 1];
      if (antes && antes.aoSair) { try { antes.aoSair(); } catch (e) { console.error(e); } }
      pilha.push({ titulo: titulo, montar: montar, aoSair: null });
      if (!op.raiz && !MODO_PREVIA) history.pushState({ estacoes: pilha.length }, "");
      desenharTopo();
      return desenharAtual();
    },
    voltar: function () { if (pilha.length > 1) { if (MODO_PREVIA) voltarNaMemoria(); else history.back(); } },
    raiz: function (titulo, montar) {
      pilha.forEach(function (x) { if (x.aoSair) try { x.aoSair(); } catch (e) { console.error(e); } });
      pilha = [];
      return nav.abrir(titulo, montar, { raiz: true });
    },
    /* a tela registra uma limpeza (cronômetro, intervalos) para quando sair */
    aoSair: function (fn) { var t = pilha[pilha.length - 1]; if (t) t.aoSair = fn; },
    atualizar: function () { return desenharAtual(); },
    titulo: function (t) { var x = pilha[pilha.length - 1]; if (x) { x.titulo = t; desenharTopo(); } }
  };
  function voltarNaMemoria() {
    if (pilha.length <= 1) return;
    var saiu = pilha.pop();
    if (saiu && saiu.aoSair) { try { saiu.aoSair(); } catch (e) { console.error(e); } }
    desenharTopo(); desenharAtual();
  }
  window.addEventListener("popstate", function () { if (!MODO_PREVIA) voltarNaMemoria(); });
  function desenharAtual() {
    var area = document.getElementById("on-area");
    var t = pilha[pilha.length - 1];
    if (!area || !t) return Promise.resolve();
    limpar(area);
    window.scrollTo(0, 0);
    try {
      return Promise.resolve(t.montar(area, contexto())).catch(mostrarErro(area));
    } catch (e) { mostrarErro(area)(e); return Promise.resolve(); }
  }
  function mostrarErro(area) {
    return function (e) {
      console.error(e);
      var msg = e && e.code === "rede" ? "Sem conexão. Tente de novo quando a internet voltar." :
                e && e.code === "sem_permissao" ? "Você não tem acesso a este conteúdo." :
                "Não foi possível carregar: " + ((e && e.message) || e);
      area.appendChild(el("div", "on-aviso on-aviso-erro", [el("p", null, msg), botao("Tentar de novo", "on-btn-sec", function () { desenharAtual(); })]));
    };
  }
  function contexto() { return { eu: estado.eu, demo: MODO_DEMO, previa: MODO_PREVIA, nav: nav, Online: Online }; }

  /* ------------------------------------------------------------------
   * Casca da página: topo, área, rodapé
   * ------------------------------------------------------------------ */
  var NOMES_PERFIL = { admin: "Administração", aplicador: "Aplicador(a)", ator: "Ator / atriz", aluno: "Aluno(a)" };
  function desenharTopo() {
    var topo = document.getElementById("on-topo");
    if (!topo) return;
    limpar(topo);
    var esq = el("div", "on-topo-esq");
    if (pilha.length > 1) {
      var v = botao("‹ Voltar", "on-btn-voltar", function () { nav.voltar(); });
      v.setAttribute("aria-label", "Voltar");
      esq.appendChild(v);
    } else esq.appendChild(el("span", "on-marca", "Estações"));
    var t = pilha[pilha.length - 1];
    esq.appendChild(el("span", "on-topo-titulo", t ? t.titulo : ""));
    topo.appendChild(esq);
    var dir = el("div", "on-topo-dir");
    var selo = el("span", "on-selo-rede"); selo.id = "on-selo-rede"; dir.appendChild(selo);
    var slot = el("span", "on-topo-slot"); slot.id = "on-topo-slot"; dir.appendChild(slot);
    if (estado.eu) {
      dir.appendChild(el("span", "on-quem", [el("b", null, estado.eu.nome || ""), el("span", "on-quem-perfil", NOMES_PERFIL[estado.eu.perfil] || estado.eu.perfil)]));
      if (!MODO_PREVIA) dir.appendChild(botao("Sair", "on-btn-sec on-btn-peq", sair));
    }
    topo.appendChild(dir);
    atualizarSelo();
  }
  function casca() {
    var raiz = document.getElementById("on-app");
    limpar(raiz);
    var topo = el("header", "on-topo"); topo.id = "on-topo";
    var area = el("main", "on-area"); area.id = "on-area";
    raiz.appendChild(topo); raiz.appendChild(area);
    desenharTopo();
    return area;
  }

  /* ------------------------------------------------------------------
   * Entrada (login por código ou link) e roteamento por perfil
   * ------------------------------------------------------------------ */
  /* Entrada em tela cheia (visual: css/tema-editorial.css, seção ".on-hero").
     A nota "Foto: …" marca onde entra a fotografia; ao definir --ed-hero-foto no CSS, apague a linha da nota. */
  function heroEntrada() {
    var foto = el("div", "on-hero-foto"); foto.setAttribute("aria-hidden", "true");
    return el("section", "on-hero", [
      foto,
      el("p", "on-hero-nota", "Foto: sala de estação em uso (examinador, ator e candidato), luz lateral, espaço livre à esquerda"),
      el("p", "on-hero-rotulo", "Hands-on · 2ª fase da residência médica"),
      el("p", "on-hero-titulo", "Prova prática, ensaiada."),
      el("p", "on-hero-texto", "Estações aplicadas e avaliadas no perfil de cada banca.")
    ]);
  }

  function telaLogin(erroLink) {
    erroLink = typeof erroLink === "string" ? erroLink : null;
    estado.eu = null; pilha = [];
    try { sessionStorage.removeItem("estacoes-eu"); } catch (x) { /* nada */ }
    var area = casca();
    var cartao = el("section", "on-cartao on-login");
    cartao.appendChild(el("h1", null, "Entrar"));
    cartao.appendChild(el("p", "on-sutil", "Acesso restrito. Entre com o e-mail e a senha cadastrados pela coordenação."));
    if (erroLink) cartao.appendChild(el("p", "on-aviso on-aviso-erro", erroLink));
    var form = el("form", "on-form");
    var lbl = el("label", null, "E-mail");
    var email = el("input", "on-campo"); email.type = "email"; email.autocomplete = "username"; email.required = true; email.inputMode = "email";
    lbl.appendChild(email); form.appendChild(lbl);
    var lblS = el("label", null, "Senha");
    var senha = el("input", "on-campo"); senha.type = "password"; senha.autocomplete = "current-password"; senha.required = true;
    lblS.appendChild(senha); form.appendChild(lblS);
    var entrar = el("button", "on-btn on-btn-pri", "Entrar"); entrar.type = "submit";
    form.appendChild(entrar);
    var msg = el("p", "on-msg"); msg.setAttribute("aria-live", "polite");
    cartao.appendChild(form); cartao.appendChild(msg);
    cartao.appendChild(el("p", "on-sutil on-peq", "Esqueceu a senha? Fale com a coordenação. Em aparelho compartilhado, toque em \"Sair\" ao terminar."));
    area.appendChild(heroEntrada());
    area.appendChild(cartao);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var e = email.value.trim().toLowerCase();
      if (!e || !senha.value) return;
      if (!estaOnline()) { msg.textContent = "Sem conexão. Conecte-se para entrar."; return; }
      entrar.disabled = true; msg.textContent = "Entrando…";
      Online.sb.auth.signInWithPassword({ email: e, password: senha.value }).then(function (r) {
        entrar.disabled = false;
        if (r.error) {
          var m = r.error.message || "";
          senha.value = "";
          msg.textContent = /invalid login|credentials|not found/i.test(m) ? "E-mail ou senha incorretos." :
                            /rate|limit|seconds|too many/i.test(m) ? "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo." :
                            "Não foi possível entrar: " + m;
          return;
        }
        senha.value = "";
        rotear();
      });
    });
    email.focus();
  }

  function rotear() {
    var area = casca();
    area.appendChild(el("p", "on-carregando", "Carregando…"));
    /* sem conexão: usa o "eu" já confirmado nesta aba (a fila de avaliações continua funcionando) */
    return rpc("eu").then(function (eu) {
      if (MODO_PREVIA) return eu;            /* a prévia não guarda o "eu" na aba */
      try { if (eu) sessionStorage.setItem("estacoes-eu", JSON.stringify(eu)); else sessionStorage.removeItem("estacoes-eu"); } catch (x) { /* nada */ }
      return eu;
    }, function (e) {
      var c = null;
      if (e && e.code === "rede") { try { c = JSON.parse(sessionStorage.getItem("estacoes-eu") || "null"); } catch (x) { /* nada */ } }
      if (c) { toast("Sem conexão: usando os dados desta aba. O que você marcar fica guardado no aparelho.", "aviso"); return c; }
      throw e;
    }).then(function (eu) {
      if (!eu || !eu.perfil) {
        limpar(area).appendChild(el("section", "on-cartao", [
          el("h1", null, "Acesso não liberado"),
          el("p", null, "Seu e-mail entrou, mas não há cadastro ativo para ele. Fale com a coordenação."),
          botao("Sair", "on-btn-sec", sair)
        ]));
        return;
      }
      estado.eu = eu;
      var tela = telas[eu.perfil];
      if (!tela) {
        desenharTopo();
        limpar(area).appendChild(el("p", "on-aviso", "A tela do perfil \"" + eu.perfil + "\" não está disponível nesta versão."));
        return;
      }
      return nav.raiz(tela.titulo || NOMES_PERFIL[eu.perfil], tela.montar);
    }).catch(function (e) {
      limpar(area);
      if (e && e.code === "rede") {
        area.appendChild(el("div", "on-aviso on-aviso-erro", [el("p", null, "Sem conexão. Assim que a internet voltar, toque em tentar de novo."), botao("Tentar de novo", "on-btn-sec", rotear)]));
      } else if (!MODO_DEMO && !MODO_PREVIA && e && /jwt|auth|token/i.test(e.message || "")) {
        telaLogin();
      } else mostrarErro(area)(e);
    });
  }

  function sair() {
    var pend = antesDeSair.reduce(function (n, fn) { try { return n + (fn() || 0); } catch (e) { return n; } }, 0);
    var p = pend ? confirmar("Há " + pend + " avaliação(ões) aguardando conexão neste aparelho. Elas ficam guardadas aqui e serão enviadas quando você entrar de novo. Sair mesmo assim?", { ok: "Sair" }) : Promise.resolve(true);
    p.then(function (ok) {
      if (!ok) return;
      pilha.forEach(function (x) { if (x.aoSair) try { x.aoSair(); } catch (e) { console.error(e); } });
      pilha = []; estado.eu = null;
      try { sessionStorage.removeItem("estacoes-eu"); } catch (x) { /* nada */ }
      limparAparelho();
      if (MODO_DEMO) { window.Demo.sair(); iniciarDemo(); return; }
      // "local": apaga a sessão do aparelho mesmo sem internet (o "global" desiste se a rede falha)
      Online.sb.auth.signOut({ scope: "local" })
        .catch(function () { /* nada */ })
        .finally(function () {
          try { localStorage.removeItem(CFG.chaveSessao); localStorage.removeItem(CFG.chaveSessao + "-code-verifier"); } catch (x) { /* nada */ }
          telaLogin();
        });
    });
  }
  /* Ao sair: apaga do aparelho o material e as cópias da estação (a fila offline
     de avaliações "estacoes-fila:*" fica, de propósito, para ser enviada no próximo login) */
  function limparAparelho() {
    try {
      Object.keys(sessionStorage).forEach(function (k) { if (/^estacoes-/.test(k)) sessionStorage.removeItem(k); });
      Object.keys(localStorage).forEach(function (k) { if (/^estacoes-crono/.test(k)) localStorage.removeItem(k); });
    } catch (x) { /* nada */ }
  }

  var erroDoLink = null;
  function limparUrlDeRetorno() {
    var q = new URLSearchParams(location.search);
    ["code", "error", "error_code", "error_description"].forEach(function (k) { q.delete(k); });
    var qs = q.toString();
    var temHashAuth = /access_token|refresh_token|error_description|error_code|type=/.test(location.hash);
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + (temHashAuth ? "" : location.hash));
  }
  function iniciarReal() {
    var area = casca();
    area.appendChild(el("p", "on-carregando", "Carregando…"));
    return carregarScript(CFG.supabaseJs).then(function () {
      if (!window.supabase || !window.supabase.createClient) throw new Error("supabase-js indisponível");
      Online.sb = window.supabase.createClient(CFG.supabaseUrl, CFG.chavePublicavel, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: CFG.chaveSessao, flowType: "implicit" }
      });
      Online.sb.auth.onAuthStateChange(function (ev) {
        if (ev === "SIGNED_OUT") limparAparelho();
        if (ev === "SIGNED_OUT" && estado.eu) { estado.eu = null; telaLogin(); }
      });
      /* Retorno do link mágico: fluxo implicit (#access_token=…) é lido pelo
         detectSessionInUrl; fluxo pkce (?code=…) é trocado aqui. Erros do link
         (#error_description=…, ex.: link vencido) viram aviso na tela de entrada. */
      var hash = new URLSearchParams(location.hash.replace(/^#/, ""));
      var codigoUrl = params.get("code");
      erroDoLink = hash.get("error_description") || params.get("error_description");
      return Online.sb.auth.getSession().then(function (r) {
        if (r && r.data && r.data.session) return r;
        if (codigoUrl) return Online.sb.auth.exchangeCodeForSession(codigoUrl).then(function (x) {
          if (x.error) erroDoLink = "O link não pôde ser usado neste navegador (" + x.error.message + "). Peça um novo.";
          return Online.sb.auth.getSession();
        });
        return r;
      });
    }).then(function (r) {
      limparUrlDeRetorno();
      if (r && r.data && r.data.session) return rotear();
      telaLogin(erroDoLink ? (/expired|invalid/i.test(erroDoLink) ? "O link de acesso venceu ou já foi usado. Peça um novo abaixo." : String(erroDoLink)) : null);
    }).catch(function (e) {
      limpar(area).appendChild(el("div", "on-aviso on-aviso-erro", [el("p", null, "Não foi possível iniciar: " + e.message + ". Verifique a conexão e recarregue a página."), botao("Recarregar", "on-btn-sec", function () { location.reload(); })]));
    });
  }

  /* ----- Modo prévia do Estúdio: dados do Estúdio (iframe da mesma origem), sem login nem servidor ----- */
  function iniciarPrevia() {
    var area = casca();
    area.appendChild(el("p", "on-carregando", "Montando a prévia…"));
    document.body.classList.add("on-modo-previa");
    var faixa = document.getElementById("on-faixa-demo");
    if (faixa) {
      limpar(faixa).appendChild(el("span", null, [el("b", null, "Prévia do Estúdio: "), "sessão e alunos fictícios; nada é gravado."]));
      faixa.hidden = false;
    }
    return carregarScript("js/previa.js").then(function () {
      if (!window.Previa) throw new Error("js/previa.js não carregou");
      return window.Previa.iniciar(papelPrevia);
    }).then(function () { return rotear(); }, function (e) {
      limpar(area).appendChild(el("div", "on-aviso on-aviso-erro", [
        el("p", null, el("b", null, "Não foi possível montar a prévia.")),
        el("p", null, String((e && e.message) || e || "erro"))
      ]));
    });
  }
  function telaPreviaFora() {
    var area = casca();
    area.appendChild(el("section", "on-cartao", [
      el("h1", null, "Prévia"),
      el("p", null, "A prévia só abre dentro do Estúdio.")
    ]));
  }

  /* ----- Modo demonstração: backend falso em memória (demo.js), perfis fictícios ----- */
  function iniciarDemo() {
    var area = casca();
    if (!window.Demo) {
      area.appendChild(el("p", "on-carregando", "Carregando a demonstração…"));
      return carregarScript("js/demo.js").then(function () { return window.Demo.iniciar(); }).then(iniciarDemo, function (e) {
        limpar(area).appendChild(el("div", "on-aviso on-aviso-erro", el("p", null, "Modo demonstração indisponível nesta publicação. (" + e.message + ")")));
      });
    }
    Online.sb = window.Demo.sb;
    document.body.classList.add("on-modo-demo");
    window.Demo.montarFaixa(document.getElementById("on-faixa-demo"));
    var atual = window.Demo.usuarioAtual();
    if (atual) return rotear();
    limpar(area);
    var cartao = el("section", "on-cartao on-demo-perfis");
    cartao.appendChild(el("h1", null, "Demonstração: escolha um perfil"));
    cartao.appendChild(el("p", "on-sutil", "Pessoas e alunos fictícios. Nada sai deste navegador. A segurança real (filtro por perfil) é feita pelo servidor; aqui ela é só imitada."));
    var grupos = {};
    window.Demo.usuarios().forEach(function (u) { (grupos[u.perfil] = grupos[u.perfil] || []).push(u); });
    ["admin", "aplicador", "ator", "aluno"].forEach(function (p) {
      if (!grupos[p]) return;
      cartao.appendChild(el("h2", null, NOMES_PERFIL[p]));
      var l = el("div", "on-grade-botoes");
      grupos[p].forEach(function (u) {
        l.appendChild(botao(u.nome, "on-btn-sec", function () { try { sessionStorage.removeItem("estacoes-eu"); } catch (x) { /* nada */ } window.Demo.entrar(u.id); rotear(); }));
      });
      cartao.appendChild(l);
    });
    area.appendChild(heroEntrada());
    area.appendChild(cartao);
  }

  /* ------------------------------------------------------------------
   * API pública
   * ------------------------------------------------------------------ */
  var Online = window.Online = {
    sb: null,
    demo: MODO_DEMO,
    previa: MODO_PREVIA,
    config: CFG,
    rpc: rpc,
    eu: function () { return estado.eu; },
    registrarTela: function (perfil, def) { telas[perfil] = def; },
    el: el, md: md, limpar: limpar, botao: botao, fmt: fmt, fmtData: fmtData,
    toast: toast, confirmar: confirmar, perguntar: perguntar,
    renderFluxo: renderFluxo,
    urlImagem: function (pub, arq) { return MODO_PREVIA ? window.Previa.urlImagem(pub, arq) : MODO_DEMO ? window.Demo.urlImagem(pub, arq) : urlImagem(pub, arq); },
    imagensDaEstacao: function (se) { return MODO_PREVIA ? window.Previa.imagensDaEstacao(se) : MODO_DEMO ? window.Demo.imagensDaEstacao(se) : imagensDaEstacao(se); },
    estaOnline: estaOnline, aoMudarRede: aoMudarRede,
    antesDeSair: function (fn) { antesDeSair.push(fn); },
    nav: nav,
    nomeBanca: function (b) { return window.Diagramador ? window.Diagramador.infoBanca(b).nome : b; },
    nota: { NIVEIS: NIVEIS, itensDoChecklist: itensDoChecklist, dominiosSoft: dominiosSoft, pontosDosNiveis: pontosDosNiveis, calcular: calcular },
    _avisarRede: avisarRede
  };

  function iniciar() {
    if (estado.iniciado) return; estado.iniciado = true;
    if (PREVIA_FORA) { telaPreviaFora(); return; }
    if (MODO_PREVIA) { iniciarPrevia(); return; }
    if (MODO_DEMO) {
      var local = /^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(location.hostname);
      if (!local) { casca().appendChild(el("p", "on-aviso", "O modo demonstração só funciona no computador local.")); return; }
      iniciarDemo();
    } else iniciarReal();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else setTimeout(iniciar, 0);
})();
