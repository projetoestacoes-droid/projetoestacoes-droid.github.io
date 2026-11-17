/* =====================================================================
 * estudio-app.js — window.App do ESTÚDIO online (mesmo contrato de app/js/app.js)
 *
 * O editor (app/js/editor.js), a revisão (app/js/revisao.js) e a diagramação
 * A4 (app/js/render.js) são OS MESMOS do visualizador local. Este arquivo só
 * troca a fonte das estações: em vez de catálogos no disco, o banco do site
 * (RPCs estudio_* — ver online/supabase/API.md), e acrescenta as ações do
 * estúdio: nova em branco, duplicar, imagens, histórico de versões (ver e
 * restaurar), arquivar, apagar de vez, baixar .js, recarregar e publicar para aplicação.
 *
 * window.App = { STATUS, atual, renderizar, montarLista, atualizarRevisao,
 *   somaChecklist, nomeBanca, mostrarAba, estacaoPorId, selecionar,
 *   (do editor) antesDeTrocar, estaAlterada,
 *   (do estúdio) recarregarLista, abrirPorId, entradaPorId }
 *
 * Entrada (o que o editor recebe em App.atual()):
 *   { chave: "est:<uuid>", grupo: "saidas", id: "<uuid>", dados, versao, linha, arquivo, base: "" }
 *   grupo "saidas" faz o editor oferecer "Salvar" (a gravação vai para estudio-salvar.js).
 * ===================================================================== */
(function () {
  "use strict";
  var E = window.Estudio;
  if (!E) return;
  var ui = E.ui, el = ui.el;

  var STATUS = { "rascunho": "Rascunho", "em-revisao": "Em revisão", "aprovada": "Aprovada" };
  var ORIGENS = { importada: "importada", nova: "nova", duplicada: "duplicada", gerada: "gerada por IA" };
  var BANCAS = [["einstein", "Einstein"], ["sirio-libanes", "Sírio-Libanês"], ["usp-ribeirao", "USP Ribeirão"],
    ["unifesp-r1", "Unifesp R1"], ["unifesp-rmais", "Unifesp R+"], ["tradicional", "Tradicional"]];
  var AREAS = ["Clínica Médica", "Cirurgia Geral", "Ginecologia e Obstetrícia", "Pediatria", "Preventiva"];
  var RX_IMG = /^img\/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp|gif)$/i;
  var MAX_IMAGEM = 10 * 1024 * 1024;
  var URL_VALIDA_MS = 10 * 60 * 1000;

  var estado = {
    entradas: [],        // { chave, grupo, id, linha, dados, versao, arquivo, base }
    atual: null,
    tokenRender: 0,
    promessaRender: null,
    urls: {},            // id -> { quando, mapa: {"img/x.png": url} }
    vista: null,         // { versao, dados, salvo_em } — versão antiga em visualização (somente leitura)
    carregou: false
  };
  var $ = function (id) { return document.getElementById(id); };

  function nomeBanca(b) { var i = window.Diagramador && window.Diagramador.BANCAS[b]; return i ? i.nome : (b || "sem banca"); }
  function msg(texto, tipo) { var m = $("es-msg"); if (!m) return; m.textContent = texto || ""; m.className = "es-msg" + (tipo ? " " + tipo : ""); }
  function editor() { return window.EditorEstacao || null; }
  function pendente() { var ed = editor(); return !!(ed && ed.pendente && ed.pendente()); }

  /* ------------------------------------------------------------------
   * Entradas
   * ------------------------------------------------------------------ */
  function campo(x, k) {
    if (x.dados && x.dados[k] != null) return x.dados[k];
    return x.linha ? x.linha[k] : null;
  }
  function entradaPorId(id) {
    for (var i = 0; i < estado.entradas.length; i++) if (estado.entradas[i].id === id) return estado.entradas[i];
    return null;
  }
  function atual() {
    for (var i = 0; i < estado.entradas.length; i++) if (estado.entradas[i].chave === estado.atual) return estado.entradas[i].dados ? estado.entradas[i] : null;
    return null;
  }
  function descreverArquivo(x) {
    return "estúdio online · versão " + (x.versao != null ? x.versao : "?") + (x.linha && x.linha.origem ? " · " + (ORIGENS[x.linha.origem] || x.linha.origem) : "");
  }
  function novaEntrada(linha) {
    return { chave: "est:" + linha.id, grupo: "saidas", id: linha.id, linha: linha, dados: null, versao: linha.versao, arquivo: "", base: "" };
  }
  /* Recarrega a lista do servidor mantendo os mesmos objetos de entrada (o editor guarda a referência) */
  function recarregarLista() {
    return E.api.listar(true).then(function (linhas) {
      var vistas = {};
      linhas.forEach(function (l) {
        if (!l || !l.id) return;
        vistas[l.id] = true;
        var x = entradaPorId(l.id);
        if (x) {
          x.linha = l;
          // a versão no servidor mudou e não há edição local pendente nesta entrada: descarta o conteúdo em cache
          if (x.dados && l.versao != null && l.versao !== x.versao && !(pendente() && estado.atual === x.chave)) { x.dados = null; }
          if (!x.dados) x.versao = l.versao;
        } else estado.entradas.push(novaEntrada(l));
      });
      estado.entradas = estado.entradas.filter(function (x) { return vistas[x.id] || x.chave === estado.atual; });
      estado.carregou = true;
      montarLista();
      return linhas;
    });
  }
  function carregarDados(x) {
    if (x.dados) return Promise.resolve(x);
    return E.api.obter(x.id).then(function (r) {
      if (!r || !r.conteudo) throw Object.assign(new Error("nao_encontrado"), { code: "nao_encontrado" });
      x.dados = typeof r.conteudo === "string" ? JSON.parse(r.conteudo) : r.conteudo;
      x.versao = r.versao != null ? r.versao : x.versao;
      x.linha = Object.assign({}, x.linha || {}, r, { conteudo: undefined });
      x.arquivo = descreverArquivo(x);
      return x;
    });
  }

  /* ------------------------------------------------------------------
   * Lista lateral
   * ------------------------------------------------------------------ */
  function montarLista() {
    var nav = $("lista");
    if (!nav) return;
    ui.limpar(nav);
    var fb = $("filtro-banca").value, fs = $("filtro-status").value, arq = $("filtro-arquivadas").checked;
    var ft = $("filtro-texto").value.trim().toLowerCase();
    var todas = estado.entradas.filter(function (x) { return arq || !(x.linha && x.linha.arquivada); });
    var vis = todas.filter(function (x) {
      if (fb && campo(x, "banca") !== fb) return false;
      if (fs && campo(x, "status") !== fs) return false;
      if (ft) {
        var t = [campo(x, "titulo"), campo(x, "area"), x.dados ? x.dados.id : (x.linha && x.linha.estacao_id), x.id].join(" ").toLowerCase();
        if (t.indexOf(ft) < 0) return false;
      }
      return true;
    });
    vis.sort(function (a, b) { return String((b.linha && b.linha.atualizado_em) || "").localeCompare(String((a.linha && a.linha.atualizado_em) || "")); });
    var h = el("h2"); h.appendChild(el("span", null, "Estações do estúdio")); h.appendChild(el("span", null, vis.length + (vis.length !== todas.length ? "/" + todas.length : "")));
    nav.appendChild(h);
    if (!estado.carregou) nav.appendChild(el("div", "vazio", "Carregando…"));
    else if (!todas.length) nav.appendChild(el("div", "vazio", "Nenhuma estação no estúdio ainda. Use “Importar arquivos…”, “Importar pasta…” ou “Nova em branco”."));
    else if (!vis.length) nav.appendChild(el("div", "vazio", "Nenhuma estação com esse filtro."));
    vis.forEach(function (x) {
      var b = el("button", "item-estacao" + (estado.atual === x.chave ? " ativo" : "") + (x.linha && x.linha.arquivada ? " es-arquivada" : ""));
      b.type = "button";
      b.setAttribute("data-chave", x.chave);
      var tit = String(campo(x, "titulo") || "(sem título)");
      var ne = campo(x, "numero_estacao");
      if (ne != null && ne !== "" && !/^Esta[çc][ãa]o\s/i.test(tit)) tit = "Estação " + ne + " - " + tit;
      b.appendChild(el("span", "tit", tit));
      var meta = el("span", "meta");
      var ed = campo(x, "edicao");
      meta.appendChild(el("span", "selo-ui banca", nomeBanca(campo(x, "banca")) + (ed ? " " + ed : "")));
      var st = campo(x, "status");
      if (st) meta.appendChild(el("span", "selo-ui st-" + st, STATUS[st] || st));
      meta.appendChild(el("span", "selo-ui", "v" + (x.versao != null ? x.versao : "?")));
      var orig = x.linha && x.linha.origem;
      if (orig) meta.appendChild(el("span", "selo-ui es-origem es-origem-" + orig, ORIGENS[orig] || orig));
      if (x.linha && x.linha.publicada_versao != null) meta.appendChild(el("span", "selo-ui es-publicada", "publicada v" + x.linha.publicada_versao));
      if (x.linha && x.linha.arquivada) meta.appendChild(el("span", "selo-ui", "arquivada"));
      if (window.App && typeof window.App.estaAlterada === "function" && window.App.estaAlterada(x.chave)) meta.appendChild(el("span", "selo-ui alterada", "não salva"));
      b.appendChild(meta);
      b.addEventListener("click", function () { selecionar(x.chave); });
      nav.appendChild(b);
    });
    atualizarBotoes();
  }

  function atualizarBotoes() {
    var x = atual();
    var aprovada = !!(x && x.dados && x.dados.status === "aprovada");
    var bp = $("btn-publicar");
    if (bp) {
      bp.disabled = !x || !x.dados || !!estado.vista;
      bp.classList.toggle("es-pendente-aprovacao", !!(x && x.dados && !aprovada));
      bp.title = !x ? "Selecione uma estação." : estado.vista ? "Volte à versão atual para publicar." :
        aprovada ? "Publicar esta estação (versão salva no estúdio) para a área de aplicação." :
        "A estação ainda não está aprovada: ao clicar, você pode aprovar e publicar de uma vez.";
    }
    var bv = $("btn-previa");
    if (bv) bv.disabled = !x || !(estado.vista ? estado.vista.dados : x.dados);
    ["es-duplicar", "es-historico", "es-baixar", "es-arquivar", "es-excluir"].forEach(function (id) { var b = $(id); if (b) b.disabled = !x; });
    var ri = $("es-imagens-rot"); if (ri) ri.classList.toggle("es-desab", !x);
    var ii = $("es-imagens"); if (ii) ii.disabled = !x;
    var ba = $("es-arquivar");
    if (ba && x) ba.textContent = x.linha && x.linha.arquivada ? "Desarquivar" : "Arquivar";
    if (estado.vista) { var be = $("btn-editar"); if (be) be.disabled = true; }
  }

  /* ------------------------------------------------------------------
   * Seleção (mesma lógica de app.js: o editor pode vetar a troca)
   * ------------------------------------------------------------------ */
  function restaurarHash() {
    var x = estado.atual ? entradaPorChave(estado.atual) : null;
    var alvo = x ? "#" + x.id : "";
    if (location.hash !== alvo) history.replaceState(null, "", location.pathname + location.search + alvo);
  }
  function entradaPorChave(k) { for (var i = 0; i < estado.entradas.length; i++) if (estado.entradas[i].chave === k) return estado.entradas[i]; return null; }
  function selecionar(chave, semPerguntar) {
    if (!semPerguntar && chave !== estado.atual && window.App && typeof window.App.antesDeTrocar === "function") {
      var r;
      try { r = window.App.antesDeTrocar(chave); } catch (err) { console.error(err); r = true; }
      if (r !== true) {
        restaurarHash();
        Promise.resolve(r).then(function (ok) { if (ok) selecionar(chave, true); }, function (err) { console.error(err); });
        return Promise.resolve(false);
      }
    }
    var x = entradaPorChave(chave);
    if (!x) return Promise.resolve(false);
    msg("");
    var ind = indicador(); ind.textContent = "Abrindo…"; ind.style.display = "";
    return carregarDados(x).then(function () {
      estado.vista = null;
      mostrarBanner(null);
      estado.atual = chave;
      history.replaceState(null, "", location.pathname + location.search + "#" + x.id);
      Array.prototype.forEach.call(document.querySelectorAll(".item-estacao"), function (b) {
        b.classList.toggle("ativo", b.getAttribute("data-chave") === chave);
      });
      document.dispatchEvent(new CustomEvent("estacao-selecionada", { detail: { chave: chave } }));
      atualizarBotoes();
      renderizar();
      return true;
    }, function (e) {
      ind.style.display = "none";
      msg("Não foi possível abrir a estação: " + ui.textoErro(e), "erro");
      return false;
    });
  }

  /* ------------------------------------------------------------------
   * Documento (o mesmo Diagramador do visualizador local)
   * ------------------------------------------------------------------ */
  function indicador() {
    return $("carregando") || (function () { var c = el("div", "carregando", "Diagramando…"); c.id = "carregando"; $("area-doc").appendChild(c); return c; })();
  }
  function aplicarZoom() {
    var z = parseFloat($("opt-zoom").value) || 1;
    var area = $("area-doc");
    if (document.body.classList.contains("com-revisao") || document.body.classList.contains("modo-edicao")) {
      var cabe = (area.clientWidth - 32) / 794;
      if (cabe < z) z = Math.max(0.4, cabe);
    }
    $("documento").style.zoom = String(z);
  }
  function carregarFontes() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var pedidos = ["400 10pt", "700 10pt", "italic 400 10pt"].reduce(function (acc, v) { return acc.concat([v + ' "Transat Text"', v + " Figtree"]); }, []);
    return Promise.all(pedidos.map(function (f) { return document.fonts.load(f).catch(function () {}); }));
  }
  /* Mesma regra do servidor (privado.imagens_do_json): todo valor string de chave "arquivo" */
  function imagensDoObjeto(o) {
    var acc = {};
    (function andar(v) {
      if (Array.isArray(v)) v.forEach(andar);
      else if (v && typeof v === "object") Object.keys(v).forEach(function (k) {
        if (k === "arquivo" && typeof v[k] === "string" && v[k].trim()) acc[v[k].trim()] = true; else if (k !== "revisao") andar(v[k]);
      });
    })(o);
    return Object.keys(acc).sort();
  }
  /* URLs assinadas das imagens da estação (bucket "estudio", <id>/<arquivo>) → mapa por nome de arquivo
     (o Diagramador procura primeiro por nome em opcoes.blobs) */
  function urlsImagens(x, dados) {
    var arqs = imagensDoObjeto(dados).filter(function (a) { return !/^(https?:|data:|blob:)/i.test(a); });
    var cache = estado.urls[x.id] || (estado.urls[x.id] = { quando: 0, mapa: {} });
    var velho = Date.now() - cache.quando > URL_VALIDA_MS;
    var faltam = arqs.filter(function (a) { return velho || !Object.prototype.hasOwnProperty.call(cache.mapa, a); });
    var p = faltam.length ? E.arm.assinar(E.arm.ESTUDIO, faltam.map(function (a) { return x.id + "/" + a; })).then(function (m) {
      if (velho) { cache.mapa = {}; cache.quando = Date.now(); }
      faltam.forEach(function (a) { cache.mapa[a] = m[x.id + "/" + a] || null; });
    }) : Promise.resolve();
    return p.then(function () {
      var blobs = {};
      arqs.forEach(function (a) { var u = cache.mapa[a]; if (u) blobs[a.split(/[\\/]/).pop()] = u; });
      return blobs;
    });
  }
  function avisarRenderizada(info) {
    document.dispatchEvent(new CustomEvent("estacao-renderizada", { detail: { chave: estado.atual, info: info || null } }));
  }
  function renderizar() {
    var x = atual();
    var doc = $("documento"), aviso = $("aviso");
    if (!x) {
      ++estado.tokenRender;
      ui.limpar(doc);
      aviso.style.display = "";
      aviso.textContent = !estado.carregou ? "Carregando…" : estado.entradas.length ? "Selecione uma estação na lista." :
        "Nenhuma estação no estúdio. Use “Importar arquivos…”, “Importar pasta…”, “Nova em branco” ou a aba “IA: gerar e importar” (inclui importar PDF).";
      $("atual").textContent = "Nenhuma estação selecionada";
      atualizarRevisao();
      atualizarBotoes();
      avisarRenderizada(null);
      return (estado.promessaRender = Promise.resolve(null));
    }
    aviso.style.display = "none";
    var token = ++estado.tokenRender;
    var ind = indicador(); ind.textContent = "Diagramando…"; ind.style.display = "";
    doc.style.zoom = "1";
    var dados = estado.vista ? estado.vista.dados : x.dados;
    var promessa = Promise.all([carregarFontes(), urlsImagens(x, dados)]).then(function (r) {
      if (token !== estado.tokenRender) return null;
      return window.Diagramador.diagramar(doc, dados, { capa: $("opt-capa").checked, base: "", blobs: r[1] });
    }).then(function (info) {
      if (token !== estado.tokenRender) return estado.promessaRender;
      if (!info) return null;
      aplicarZoom();
      ind.style.display = "none";
      x.arquivo = descreverArquivo(x);
      var at = $("atual");
      ui.limpar(at);
      at.appendChild(el("b", null, String(dados.titulo || "(sem título)")));
      at.appendChild(document.createTextNode(" · " + nomeBanca(dados.banca) + " · " + info.paginas + (info.paginas === 1 ? " página" : " páginas") + " · " +
        (estado.vista ? "versão " + estado.vista.versao + " (histórico)" : x.arquivo)));
      document.title = (dados.titulo || "Estação") + " · " + nomeBanca(dados.banca) + " · Estúdio";
      atualizarRevisao();
      atualizarBotoes();
      avisarRenderizada(info);
      atualizarBotoes();
      return info;
    }).catch(function (err) {
      if (token !== estado.tokenRender) return estado.promessaRender;
      ind.style.display = "none";
      console.error(err);
      aviso.style.display = "";
      aviso.textContent = "Erro ao diagramar: " + (err && err.message ? err.message : err);
      return null;
    });
    estado.promessaRender = promessa;
    return promessa;
  }

  /* ------------------------------------------------------------------
   * Modo revisão (o mesmo painel do visualizador local)
   * ------------------------------------------------------------------ */
  function somaChecklist(e) {
    var s = 0, n = 0;
    var ck = e && e.checklist;
    ((ck && ck.grupos) || []).forEach(function (g) {
      (g.itens || []).forEach(function (it) {
        if (typeof it.valor === "number") { s += it.negativo ? -Math.abs(it.valor) : it.valor; n++; }
      });
    });
    return { soma: Math.round(s * 100) / 100, n: n };
  }
  function listaTextos(titulo, itens, pai) {
    pai.appendChild(el("h3", null, titulo));
    var arr = Array.isArray(itens) ? itens.filter(function (s) { return s != null && String(s).trim() !== ""; }) : (itens ? [itens] : []);
    if (!arr.length) { pai.appendChild(el("div", "nada", "Nada registrado.")); return; }
    var ul = el("ul", "bloco-rev");
    arr.forEach(function (s) { ul.appendChild(el("li", null, typeof s === "string" ? s : JSON.stringify(s))); });
    pai.appendChild(ul);
  }
  function atualizarRevisao() {
    var painel = $("painel-revisao");
    if (!document.body.classList.contains("com-revisao")) return;
    ui.limpar(painel);
    var x = atual();
    painel.appendChild(el("h2", null, "Modo revisão"));
    if (!x) { painel.appendChild(el("div", "nada", "Selecione uma estação.")); return; }
    var e = estado.vista ? estado.vista.dados : x.dados;
    painel.appendChild(el("p", "sub", String(e.titulo || "") + " · " + nomeBanca(e.banca) + (estado.vista ? " · versão " + estado.vista.versao + " (histórico)" : "")));
    if (typeof window.revisarEstacao !== "function") {
      painel.appendChild(el("div", "modulo-ausente", "Módulo de revisão não carregado."));
    } else {
      var achados;
      try { achados = window.revisarEstacao(e); } catch (err) { achados = [{ nivel: "erro", secao: "Revisão automática", mensagem: "Falha ao executar: " + err.message }]; }
      achados = Array.isArray(achados) ? achados : [];
      var niveis = [["erro", "Erros"], ["aviso", "Avisos"], ["info", "Informações"]];
      var cont = el("div", "contagens");
      niveis.forEach(function (nv) {
        var q = achados.filter(function (a) { return a && a.nivel === nv[0]; }).length;
        cont.appendChild(el("span", "cont " + nv[0], q + " " + nv[1].toLowerCase()));
      });
      painel.appendChild(cont);
      niveis.forEach(function (nv) {
        var lst = achados.filter(function (a) { return a && a.nivel === nv[0]; });
        var h = el("h3", "nivel-" + nv[0]);
        h.appendChild(el("span", "marcador", String(lst.length)));
        h.appendChild(document.createTextNode(nv[1]));
        painel.appendChild(h);
        if (!lst.length) { painel.appendChild(el("div", "nada", "Nenhum item.")); return; }
        var ul = el("ul");
        lst.forEach(function (a) {
          var li = el("li", "achado");
          var sec = el("span", "secao-r", a.secao || "Geral");
          if (a.regra) sec.appendChild(el("span", "regra", "(" + a.regra + ")"));
          li.appendChild(sec);
          li.appendChild(document.createTextNode(String(a.mensagem || "")));
          ul.appendChild(li);
        });
        painel.appendChild(ul);
      });
    }
    var r = e.revisao || {};
    listaTextos("Lacunas", r.lacunas, painel);
    listaTextos("Pontos de atenção", r.pontos_atencao, painel);
    listaTextos("Ineditismo", r.ineditismo, painel);
    var sc = somaChecklist(e);
    painel.appendChild(el("h3", null, "Conferência do visualizador"));
    var ul = el("ul", "bloco-rev");
    var tot = e.checklist && e.checklist.total_esperado;
    ul.appendChild(el("li", null, "Soma dos valores do checklist: " + window.Diagramador.fmtValor(sc.soma) + " (" + sc.n + " itens pontuados)" +
      (tot != null ? " · total esperado: " + window.Diagramador.fmtValor(tot) : "")));
    if (e.soft_skills && Array.isArray(e.soft_skills.itens) && e.soft_skills.itens.length) {
      var ss = e.soft_skills.itens.reduce(function (s, it) { return s + (typeof it.valor === "number" ? it.valor : 0); }, 0);
      ul.appendChild(el("li", null, "Soma das soft skills: " + window.Diagramador.fmtValor(ss) + (e.soft_skills.total_esperado != null ? " · total esperado: " + e.soft_skills.total_esperado : "")));
    }
    var pend = document.querySelectorAll("#documento .img-pendente").length;
    ul.appendChild(el("li", null, pend ? pend + " imagem(ns) pendente(s) no documento (use “Imagens…” para enviar)." : "Nenhuma imagem pendente."));
    ul.appendChild(el("li", null, "Origem: " + x.arquivo));
    painel.appendChild(ul);
  }

  /* ------------------------------------------------------------------
   * Menu lateral único: a seção "IA: gerar e importar" é recolhível,
   * acima da lista de estações (antes eram duas abas).
   * ------------------------------------------------------------------ */
  var CHAVE_ABA = "projetoEstacoes.estudio.dobraIA"; // chave nova: a antiga (abas) não abre a seção sozinha
  function mostrarAba(nome) {
    var d = $("dobra-ia");
    if (!d) return;
    if (nome === "ia") {
      d.open = true;
      try { d.scrollIntoView({ block: "start" }); } catch (e) { /* sem rolagem */ }
    }
  }
  function ligarAbas() {
    var d = $("dobra-ia");
    if (!d) return;
    d.addEventListener("toggle", function () {
      try { localStorage.setItem(CHAVE_ABA, d.open ? "ia" : "estacoes"); } catch (e) { /* sem armazenamento */ }
      if (d.open) document.dispatchEvent(new CustomEvent("aba-lateral", { detail: "ia" }));
    });
    var salva = null;
    try { salva = localStorage.getItem(CHAVE_ABA); } catch (e) { salva = null; }
    d.open = salva === "ia";
  }

  /* ------------------------------------------------------------------
   * Ações do estúdio
   * ------------------------------------------------------------------ */
  function exigirSemPendencias(oQue) {
    if (!pendente()) return Promise.resolve(true);
    return ui.dialogo("Há alterações não salvas", "Antes de " + oQue + ", salve (Editar › Salvar) ou descarte as alterações da estação aberta.", [{ rotulo: "Entendi", valor: false, primario: true }])
      .then(function () { return false; });
  }
  /* Bancas com soft skills (o mesmo critério de COM_SOFT em estudio-ia.js) */
  var COM_SOFT = { "einstein": true, "sirio-libanes": true };
  /* chave de comparação: sem maiúsculas, acentos nem espaços sobrando */
  function chaveSS(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim(); }
  /* texto aceitável: pelo menos uma letra ou dígito (recusa "...", ";" etc.) */
  function temConteudoSS(s) { return /[\p{L}\p{N}]/u.test(String(s || "")); }
  /* textos limpos e sem duplicatas (mantém a primeira grafia) */
  function limparSoftSkills(lst) {
    var vistas = {}, out = [];
    (Array.isArray(lst) ? lst : []).forEach(function (t) {
      var s = String(t == null ? "" : t).replace(/\s+/g, " ").trim(), k = chaveSS(s);
      if (k && temConteudoSS(s) && !vistas[k]) { vistas[k] = true; out.push(s); }
    });
    return out;
  }
  /* Sugestões de soft skills já cobradas (RPC estudio_soft_skills_sugestoes, migração 008), uma vez por sessão.
     Falha não fica no cache: a próxima abertura do diálogo tenta de novo. */
  var cacheSugestoesSS = null;
  function sugestoesSoftSkills() {
    if (!cacheSugestoesSS) {
      cacheSugestoesSS = E.api.softSkillsSugestoes().then(function (r) {
        var mapa = {};
        Object.keys(COM_SOFT).forEach(function (b) { mapa[b] = limparSoftSkills(r && typeof r === "object" ? r[b] : null); });
        return mapa;
      });
      cacheSugestoesSS.catch(function () { cacheSugestoesSS = null; });
    }
    return cacheSugestoesSS;
  }
  /* Bloco "Soft skills (opcional)" do diálogo Nova em branco.
     → { no, mostrar(banca, area), valor() } ; valor() inclui o texto digitado e ainda não adicionado.
     Some na área "Procedimento" (procedimento do Einstein é só técnico). */
  function blocoSoftSkills() {
    var banca = null, ativo = false, sugestoes = null, falhou = false;
    var marcadasPorBanca = {};   // banca → { chave: true } (sugestões marcadas em cada banca)
    var proprias = [];           // { texto, sel } digitadas pelo usuário (valem para qualquer banca com soft skills)
    function marcadas() { return marcadasPorBanca[banca] || (marcadasPorBanca[banca] = {}); }
    function sugDaBanca() { return (sugestoes && banca && sugestoes[banca]) || []; }
    function propriaDe(k) { return proprias.filter(function (p) { return chaveSS(p.texto) === k; })[0] || null; }
    var rotLista = el("div", "es-ss-rot", "Já cobradas pela banca"); rotLista.id = "es-ss-rot-lista";
    var estado = el("p", "es-sutil es-peq es-ss-estado"); estado.setAttribute("aria-live", "polite");
    var lista = el("div", "es-ss-lista"); lista.setAttribute("role", "group"); lista.setAttribute("aria-labelledby", "es-ss-rot-lista");
    var rotProprias = el("div", "es-ss-rot", "Adicionadas por você"); rotProprias.id = "es-ss-rot-proprias";
    var listaP = el("div", "es-ss-lista es-ss-lista-proprias"); listaP.setAttribute("role", "group"); listaP.setAttribute("aria-labelledby", "es-ss-rot-proprias");
    var campo = el("input"); campo.type = "text"; campo.id = "es-ss-nova"; campo.maxLength = 160; campo.placeholder = "Ex.: comunicação com familiar em luto";
    campo.setAttribute("autocomplete", "off");
    var btAdd = ui.botao("Adicionar", "mini", function () { adicionar(campo.value, true); campo.focus(); });
    var rotNova = el("label", "es-ss-rot", "Outra soft skill"); rotNova.htmlFor = "es-ss-nova";
    var no = el("fieldset", "es-ss", [el("legend", null, "Soft skills (opcional)"), rotLista, estado, lista, rotProprias, listaP, rotNova, el("div", "es-ss-nova", [campo, btAdd])]);
    no.hidden = true;

    function chip(texto, sel, aoClicar) {
      var b = ui.botao(texto, "mini es-ss-op", aoClicar);
      b.setAttribute("aria-pressed", sel ? "true" : "false");
      return b;
    }
    function desenhar() {
      var ae = document.activeElement;
      var foco = ae && (lista.contains(ae) || listaP.contains(ae)) ? ae.getAttribute("data-ss") : null;
      ui.limpar(lista); ui.limpar(listaP);
      var sug = sugDaBanca(), m = marcadas(), chavesSug = {};
      sug.forEach(function (t) {
        var k = chaveSS(t), p = propriaDe(k);
        chavesSug[k] = true;
        // digitada igual a uma sugestão desta banca: aparece como a sugestão (sem duplicata), sem sair de "proprias"
        var b = chip(t, !!m[k] || !!(p && p.sel), function () {
          var sel = !!m[k] || !!(p && p.sel);
          m[k] = !sel; if (p) p.sel = !sel;
          desenhar();
        });
        b.setAttribute("data-ss", "s:" + k);
        lista.appendChild(b);
      });
      proprias.forEach(function (p, i) {
        var k = chaveSS(p.texto);
        if (chavesSug[k]) return;
        var b = chip(p.texto, p.sel, function () { p.sel = !p.sel; desenhar(); });
        b.setAttribute("data-ss", "p:" + k);
        var x = ui.botao("×", "mini es-ss-remover", function () { proprias.splice(i, 1); desenhar(); campo.focus(); }, "Remover");
        x.setAttribute("aria-label", "Remover “" + p.texto + "”");
        listaP.appendChild(el("span", "es-ss-propria", [b, x]));
      });
      lista.hidden = rotLista.hidden = !lista.firstChild;
      listaP.hidden = rotProprias.hidden = !listaP.firstChild;
      if (!sugestoes && !falhou) estado.textContent = "Carregando sugestões…";
      else if (falhou) estado.textContent = "Sugestões indisponíveis no momento; digite a soft skill abaixo.";
      else estado.textContent = sug.length ? "" : "Nenhuma soft skill registrada para esta banca; digite abaixo.";
      estado.hidden = !estado.textContent;
      if (foco) { var alvo = no.querySelector('[data-ss="' + foco.replace(/["\\]/g, "\\$&") + '"]'); if (alvo) alvo.focus(); }
    }
    function adicionar(texto, limparCampo) {
      var t = String(texto || "").replace(/\s+/g, " ").trim();
      if (limparCampo) campo.value = "";
      if (!t || !temConteudoSS(t)) return;
      var k = chaveSS(t);
      if (sugDaBanca().some(function (s) { return chaveSS(s) === k; })) marcadas()[k] = true;
      else {
        var ja = propriaDe(k);
        if (ja) ja.sel = true; else proprias.push({ texto: t, sel: true });
      }
      desenhar();
    }
    campo.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); ev.stopPropagation(); adicionar(campo.value, true); }
    });
    sugestoesSoftSkills().then(function (m) { sugestoes = m; falhou = false; desenhar(); }, function (e) {
      console.warn("Sugestões de soft skills indisponíveis:", e);
      falhou = true; desenhar();
    });
    desenhar();
    return {
      no: no,
      mostrar: function (b, area) { banca = b; ativo = !!COM_SOFT[b] && area !== "Procedimento"; no.hidden = !ativo; desenhar(); },
      valor: function () {
        if (!ativo) return [];
        if (campo.value.trim()) adicionar(campo.value, true);
        var m = marcadas(), out = [];
        sugDaBanca().forEach(function (t) { var k = chaveSS(t), p = propriaDe(k); if (m[k] || (p && p.sel)) out.push(t); });
        proprias.forEach(function (p) { if (p.sel) out.push(p.texto); });
        return limparSoftSkills(out);
      }
    };
  }
  function hoje() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function slug(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "estacao";
  }

  /* Esqueleto mínimo válido (app/esquema/ESQUEMA.md), com um elemento-modelo em cada seção
     para tudo ficar clicável no editor (inserir/duplicar/excluir a partir dele).
     softSkills: textos escolhidos no diálogo (só Einstein e Sírio-Libanês). Com escolha, viram o
     parágrafo "Eixo de soft skills" no início de soft_skills.blocos e um ponto de atenção da revisão;
     sem escolha, o esqueleto fica como antes. */
  function esqueleto(banca, titulo, area, softSkills) {
    var ESC = {
      "einstein": ["valor-pontos", 30], "sirio-libanes": ["sim-nao-valor", 100], "usp-ribeirao": ["sim-parcial-nao", null],
      "unifesp-r1": ["sim-nao-pontos", 10], "unifesp-rmais": ["sim-nao-pontos", 10], "tradicional": ["sim-nao-valor", 100]
    }[banca] || ["sim-nao-valor", 100];
    var ein = banca === "einstein", usp = banca === "usp-ribeirao";
    var item = { texto: "Novo item do checklist.", detalhes: [], valor: ESC[1], parcial: usp ? "Não se aplica" : null, obs: null, negativo: false, refs: [] };
    var criterios = [{ dominio: "Competências técnicas", texto: "Descrever o que será avaliado.", pontos: ein ? 30 : null }];
    if (ein) criterios.push({ dominio: "Comunicação", texto: "Descrever o que será avaliado.", pontos: 70 });
    var ano = String(new Date().getFullYear() + 1);
    var ss = COM_SOFT[banca] ? limparSoftSkills(softSkills) : [];
    var eixo = ss.length ? { tipo: "paragrafo", texto: "**Eixo de soft skills:** " + ss.map(function (t) { return t.replace(/[\s.;]+$/, ""); }).join("; ") + "." } : null;
    var discussaoSoft = { tipo: "paragrafo", texto: "Discussão de soft skills…" };
    var softSkillsObj = null;
    if (ein) softSkillsObj = { total_esperado: 70, itens: [{ dominio: "Comunicação", descricao: "Nova descrição.", valor: 70, refs: [] }], blocos: eixo ? [eixo, discussaoSoft] : [discussaoSoft], referencias: [] };
    // HSL: seção Soft Skills narrativa (revisao.js, perfil "texto"): sem itens nem total, para não pontuar à parte (SS-09)
    else if (eixo) softSkillsObj = { total_esperado: null, itens: [], blocos: [eixo, discussaoSoft], referencias: [] };
    var pontos = ["Estação criada em branco no estúdio: preencher todas as seções e as referências."];
    if (ss.length) pontos.push("Soft skills escolhidas na criação: " + ss.join("; ") + ".");
    return {
      versao_esquema: 1,
      id: hoje() + "-" + banca + "-" + slug(titulo),
      banca: banca, edicao: ano, status: "rascunho", eh_exemplo: false,
      titulo: titulo, area: area || "Clínica Médica", dia: ein ? "Dia 1" : null, numero_estacao: banca === "unifesp-rmais" ? 1 : null,
      orientacoes_estacao: [],
      objetivos: "Avaliar a capacidade do candidato de …",
      criterios: criterios,
      roteiro: { cenario_descricao: null, atores: "Ator: …", materiais: ["01 maca"], tempo: (ein || banca === "sirio-libanes" || banca === "tradicional" ? "8" : "5") + " minutos.", obs: null },
      local: "CONSULTÓRIO",
      filipetas: [{ rotulo: "FILIPETA 1 (enunciado)", caixas: [{ rotulo: "COMANDO INICIAL:", blocos: [{ tipo: "paragrafo", texto: "Você é o médico…" }] }, { rotulo: "TAREFA ÚNICA:", rotulo_em_linha: true, blocos: [{ tipo: "paragrafo", texto: "…" }] }] }],
      apos_filipetas: [],
      orientacoes_antes_das_filipetas: false,
      orientacoes_examinador: [{ tipo: "lista", itens: ["Nova orientação ao examinador."] }],
      orientacoes_ator: { rotulo: "ORIENTAÇÕES AO ATOR:", blocos: [{ tipo: "lista", itens: ["Responder apenas ao que for perguntado."] }, { tipo: "fala", gatilho: "Se questionado sobre…", texto: "\"Nova fala.\"" }] },
      checklist: { titulo_bloco: usp ? "Checklist fornecido pela banca examinadora" : "Competências técnicas", escala: ESC[0], total_esperado: ESC[1],
        grupos: [{ tarefa: usp ? "1" : "TAREFA 1", titulo: null, itens: [item] }] },
      soft_skills: softSkillsObj,
      discussao_banca: usp ? [{ tipo: "paragrafo", texto: "Comentário sobre o padrão da banca." }] : [],
      discussao_tecnica: { titulo: "DISCUSSÃO TÉCNICA", blocos: [{ tipo: "paragrafo", texto: "Novo parágrafo da discussão.", refs: [] }] },
      sugestoes_frases: [],
      referencias: ["Nova referência."],
      referencias_imagens: [],
      revisao: { lacunas: [], pontos_atencao: pontos, ineditismo: "" }
    };
  }
  function novaEmBranco() {
    return exigirSemPendencias("criar outra estação").then(function (ok) {
      if (!ok) return;
      var sb = el("select"); BANCAS.forEach(function (b) { var o = el("option", null, b[1]); o.value = b[0]; sb.appendChild(o); });
      var sa = el("select");
      var areas = function () {
        ui.limpar(sa);
        AREAS.concat(sb.value === "einstein" ? ["Procedimento"] : []).forEach(function (a) { var o = el("option", null, a); o.value = a; sa.appendChild(o); });
      };
      var ss = blocoSoftSkills();
      areas(); ss.mostrar(sb.value, sa.value);
      sb.addEventListener("change", function () { areas(); ss.mostrar(sb.value, sa.value); });
      sa.addEventListener("change", function () { ss.mostrar(sb.value, sa.value); });
      var ti = el("input"); ti.type = "text"; ti.placeholder = "Tema da estação";
      var erro = el("p", "es-aviso-erro"); erro.hidden = true;
      var corpo = el("div", "es-form-dialogo", [el("label", null, ["Banca", sb]), el("label", null, ["Grande área", sa]), el("label", null, ["Título", ti]), ss.no, erro]);
      return ui.dialogo("Nova estação em branco", [el("p", null, "Cria um esqueleto mínimo no formato da banca (status rascunho). Depois, edite clicando no documento."), corpo],
        [{ rotulo: "Cancelar", valor: null }, { rotulo: "Criar", primario: true, valor: function () {
          return { banca: sb.value, area: sa.value, titulo: ti.value.trim(), soft_skills: ss.valor() };
        } }],
        { validar: function (v) { return v.titulo ? null : "Informe o título."; }, aoErro: function (t) { erro.textContent = t; erro.hidden = false; ti.focus(); } })
        .then(function (v) {
          if (!v) return;
          msg("Criando…");
          return E.api.criar(esqueleto(v.banca, v.titulo, v.area, v.soft_skills), "nova").then(function (r) {
            return recarregarLista().then(function () { return abrirPorId(r && r.id, true); }).then(function () {
              msg("Estação criada." + (r && r.aviso === "id_repetido" ? " Atenção: outra estação do estúdio tem o mesmo id no JSON (mude o id antes de publicar as duas)." : ""), "ok");
              ui.toast("Estação em branco criada. Clique em “Editar” para preencher.", "ok");
            });
          });
        });
    }).catch(function (e) { msg("Não foi possível criar: " + ui.textoErro(e), "erro"); });
  }
  function abrirPorId(id, semPerguntar) {
    var x = id ? entradaPorId(id) : null;
    if (!x) return Promise.resolve(false);
    mostrarAba("estacoes");
    return selecionar(x.chave, !!semPerguntar);
  }

  /* cópia das imagens de uma estação do estúdio para outra (no bucket "estudio") */
  function copiarImagens(deId, paraId, dados) {
    var arqs = imagensDoObjeto(dados).filter(function (a) { return RX_IMG.test(a); });
    var ok = 0, falhas = [];
    return arqs.reduce(function (p, a) {
      return p.then(function () {
        return E.arm.copiar(E.arm.ESTUDIO, deId + "/" + a, E.arm.ESTUDIO, paraId + "/" + a, { substituir: true }).then(function () { ok++; }, function () { falhas.push(a); });
      });
    }, Promise.resolve()).then(function () { return { ok: ok, falhas: falhas }; });
  }
  function copiarLista(imgs) {
    var ok = 0, falhas = [];
    return imgs.reduce(function (p, im) {
      return p.then(function () {
        return E.arm.copiar(E.arm.ESTUDIO, semBucket(im.origem, E.arm.ESTUDIO), E.arm.ESTUDIO, semBucket(im.destino, E.arm.ESTUDIO), { substituir: true })
          .then(function () { ok++; }, function () { falhas.push(String(im.destino).replace(/^[^/]+\//, "")); });
      });
    }, Promise.resolve()).then(function () { return { ok: ok, falhas: falhas }; });
  }
  function duplicar() {
    var x = atual(); if (!x) return;
    return exigirSemPendencias("duplicar").then(function (ok) {
      if (!ok) return;
      return ui.confirmar("Duplicar estação?", "Cria uma cópia de “" + (x.dados.titulo || "") + "” (versão " + x.versao + ") como rascunho, com as imagens.", "Duplicar").then(function (sim) {
        if (!sim) return;
        msg("Duplicando…");
        return E.api.duplicar(x.id).then(function (r) {
          var novo = r && r.id;
          var copia = Array.isArray(r && r.imagens) ? copiarLista(r.imagens) : copiarImagens(x.id, novo, x.dados);
          return copia.then(function (c) {
            return recarregarLista().then(function () { return abrirPorId(novo, true); }).then(function () {
              msg("Cópia criada como rascunho" + (c.ok ? " (" + c.ok + " imagem(ns) copiada(s))" : "") + (c.falhas.length ? "; imagens não copiadas: " + c.falhas.join(", ") : "") + ".", c.falhas.length ? "erro" : "ok");
            });
          });
        });
      });
    }).catch(function (e) { msg("Não foi possível duplicar: " + ui.textoErro(e), "erro"); });
  }

  /* Imagens da estação aberta → bucket "estudio" (<id>/img/<arquivo>) */
  function enviarImagens(arquivos) {
    var x = atual(); if (!x) return Promise.resolve();
    var refs = imagensDoObjeto(x.dados);
    var porNome = {};
    refs.forEach(function (a) { porNome[a.split("/").pop().toLowerCase()] = a; });
    var feitos = [], erros = [], soltas = [];
    msg("Enviando imagens…");
    return Array.prototype.slice.call(arquivos || []).reduce(function (p, f) {
      return p.then(function () {
        if (f.size > MAX_IMAGEM) { erros.push(f.name + ": maior que 10 MB"); return; }
        if (!/\.(png|jpe?g|webp|gif)$/i.test(f.name)) { erros.push(f.name + ": use PNG, JPG, WEBP ou GIF"); return; }
        var destino = porNome[f.name.toLowerCase()];
        if (!destino || !RX_IMG.test(destino)) {
          if (destino) { erros.push(f.name + ": o documento usa o caminho “" + destino + "”, que não é aceito na publicação (use img/<arquivo>)"); return; }
          destino = "img/" + ui.nomeSeguro(f.name);
          soltas.push(destino);
        }
        return E.arm.enviar(E.arm.ESTUDIO, x.id + "/" + destino, f, { tipo: ui.tipoArquivo(f.name), substituir: true })
          .then(function () { feitos.push(destino); }, function (e) { erros.push(f.name + ": " + ui.textoErro(e)); });
      });
    }, Promise.resolve()).then(function () {
      delete estado.urls[x.id];
      var t = feitos.length + " imagem(ns) enviada(s)." + (soltas.length ? " Não citadas no documento (para usar, crie um bloco imagem com o caminho): " + soltas.join(", ") + "." : "") +
        (erros.length ? " Falhas: " + erros.join("; ") + "." : "");
      msg(t, erros.length ? "erro" : "ok");
      return renderizar();
    });
  }

  /* ---------------- Histórico de versões (ver e restaurar) ---------------- */
  function mostrarBanner(conteudo) {
    var b = $("es-banner");
    ui.limpar(b);
    if (!conteudo) { b.hidden = true; return; }
    ui.anexar(b, conteudo);
    b.hidden = false;
  }
  function verVersao(x, v) {
    return E.api.obterVersao(x.id, v.versao).then(function (r) {
      var dados = r && (typeof r.conteudo === "string" ? JSON.parse(r.conteudo) : r.conteudo);
      if (!dados) throw new Error("versão sem conteúdo");
      estado.vista = { versao: v.versao, dados: dados, salvo_em: r.salvo_em || v.salvo_em };
      mostrarBanner([
        el("span", null, [el("b", null, "Versão " + v.versao), " de " + ui.fmtData(estado.vista.salvo_em) + " (histórico, somente leitura)."]),
        ui.botao("Restaurar esta versão", "mini primario", function () { restaurar(x, v.versao, dados); }),
        ui.botao("Voltar à versão atual", "mini", sairDaVista)
      ]);
      return renderizar();
    });
  }
  function sairDaVista() {
    if (!estado.vista) return Promise.resolve();
    estado.vista = null;
    mostrarBanner(null);
    var be = $("btn-editar"); if (be) be.disabled = !atual();
    return renderizar();
  }
  function restaurar(x, versao, dados) {
    return ui.confirmar("Restaurar a versão " + versao + "?", "O conteúdo da versão " + versao + " vira uma NOVA versão (a atual, " + x.versao + ", continua no histórico).", "Restaurar").then(function (sim) {
      if (!sim) return;
      return E.api.salvar(x.id, dados, x.versao, false, "restaurada da versão " + versao).then(function (r) {
        x.dados = JSON.parse(JSON.stringify(dados));
        x.versao = (r && r.versao) || (x.versao + 1);
        estado.vista = null; mostrarBanner(null);
        document.dispatchEvent(new CustomEvent("estacao-selecionada", { detail: { chave: x.chave } }));  // o editor reabre a sessão com o novo conteúdo
        msg("Versão " + versao + " restaurada como versão " + x.versao + ".", "ok");
        return recarregarLista().then(renderizar);
      }, function (e) {
        msg(e && e.code === "conflito_versao" ? "Outra pessoa salvou esta estação enquanto você olhava o histórico. Clique em “Recarregar” e tente de novo." : "Não foi possível restaurar: " + ui.textoErro(e), "erro");
      });
    });
  }
  function historico() {
    var x = atual(); if (!x) return;
    return exigirSemPendencias("abrir o histórico").then(function (ok) {
      if (!ok) return;
      var ed = editor();
      return Promise.resolve(ed && ed.ativo && ed.ativo() ? ed.desligar() : true).then(function (desligou) {
        if (desligou === false) return;
        return E.api.versoes(x.id).then(function (vs) {
          vs = vs.slice().sort(function (a, b) { return b.versao - a.versao; });
          var tab = el("table", "es-tabela");
          tab.appendChild(el("thead", null, el("tr", null, [el("th", null, "Versão"), el("th", null, "Salva em"), el("th", null, "Por"), el("th", null, "Motivo"), el("th", null, "")])));
          var tb = el("tbody");
          var fechar = null;
          vs.forEach(function (v) {
            var atualV = v.versao === x.versao;
            var acoes = el("td", "es-acoes-celula");
            acoes.appendChild(ui.botao(atualV ? "Atual" : "Ver", "mini", function () { if (fechar) fechar(null); if (atualV) sairDaVista(); else verVersao(x, v).catch(function (e) { msg("Não foi possível abrir a versão: " + ui.textoErro(e), "erro"); }); }));
            if (!atualV) acoes.appendChild(ui.botao("Restaurar", "mini", function () {
              if (fechar) fechar(null);
              E.api.obterVersao(x.id, v.versao).then(function (r) { return restaurar(x, v.versao, typeof r.conteudo === "string" ? JSON.parse(r.conteudo) : r.conteudo); })
                .catch(function (e) { msg("Não foi possível restaurar: " + ui.textoErro(e), "erro"); });
            }));
            tb.appendChild(el("tr", atualV ? "es-atual" : null, [el("td", "num", "v" + v.versao), el("td", null, ui.fmtData(v.salvo_em)),
              el("td", null, String(v.salvo_por_nome || v.salvo_por || "—")), el("td", null, String(v.motivo || "")), acoes]));
          });
          tab.appendChild(tb);
          return ui.dialogo("Histórico de versões", [el("p", null, "“" + (x.dados.titulo || "") + "”. Toda gravação vira uma versão; nada é apagado. “Ver” mostra a versão no documento (somente leitura); “Restaurar” grava o conteúdo dela como versão nova."),
            vs.length ? el("div", "es-rolagem", tab) : el("p", "es-sutil", "Nenhuma versão registrada.")],
            [{ rotulo: "Fechar", valor: null, primario: true }], { largo: true, aoAbrir: function (dlg, fim) { fechar = fim; } });
        });
      });
    }).catch(function (e) { msg("Não foi possível abrir o histórico: " + ui.textoErro(e), "erro"); });
  }

  function arquivar() {
    var x = atual(); if (!x) return;
    var vai = !(x.linha && x.linha.arquivada);
    return exigirSemPendencias(vai ? "arquivar" : "desarquivar").then(function (ok) {
      if (!ok) return;
      return (vai ? ui.confirmar("Arquivar estação?", "“" + (x.dados.titulo || "") + "” sai da lista (marque “Mostrar arquivadas” para vê-la). Nada é apagado; dá para desarquivar.", "Arquivar", true) : Promise.resolve(true))
        .then(function (sim) {
          if (!sim) return;
          return E.api.arquivar(x.id, vai).then(function () {
            x.linha = Object.assign({}, x.linha, { arquivada: vai });
            msg(vai ? "Estação arquivada." : "Estação desarquivada.", "ok");
            return recarregarLista();
          });
        });
    }).catch(function (e) { msg("Não foi possível arquivar: " + ui.textoErro(e), "erro"); });
  }

  /* ---------------- Apagar de vez (migração 009) ----------------
     estudio_excluir apaga a estação e TODO o histórico numa transação só (sem lixeira); depois a tela
     apaga as imagens do prefixo <uuid>/ no bucket "estudio". A cópia já publicada para aplicação fica. */
  function semEspacosNasPontas(s) { return String(s == null ? "" : s).replace(/^ +| +$/g, ""); }
  /* mesma comparação do servidor: título sem espaços nas pontas; estação sem título → o "id" do JSON */
  function textoConfirmacao(x) {
    var t = x.dados && typeof x.dados.titulo === "string" ? semEspacosNasPontas(x.dados.titulo) : "";
    return t || semEspacosNasPontas((x.dados && x.dados.id) || (x.linha && x.linha.estacao_id) || "");
  }
  function fecharApagada(x) {
    estado.entradas = estado.entradas.filter(function (e) { return e !== x; });
    delete estado.urls[x.id];
    if (estado.atual === x.chave) {
      estado.atual = null;
      estado.vista = null;
      mostrarBanner(null);
      history.replaceState(null, "", location.pathname + location.search);
      document.title = "Estações · Estúdio";
      document.dispatchEvent(new CustomEvent("estacao-selecionada", { detail: { chave: null } }));  // o editor encerra a sessão
    }
  }
  function excluir() {
    var x = atual(); if (!x) return;
    return exigirSemPendencias("apagar a estação").then(function (ok) {
      if (!ok) return;
      var ed = editor();
      return Promise.resolve(ed && ed.ativo && ed.ativo() ? ed.desligar() : true).then(function (desligou) {
        if (desligou === false) return;
        return E.api.versoes(x.id).then(function (vs) { return vs.length; }, function () { return x.versao; }).then(function (nVersoes) {
          var esperado = textoConfirmacao(x);
          var publicada = !!(x.linha && x.linha.publicada_versao != null);
          var enviadas = x.linha && Array.isArray(x.linha.imagens_enviadas) ? x.linha.imagens_enviadas.length : null;
          var campo = el("input"); campo.type = "text"; campo.autocomplete = "off"; campo.spellcheck = false;
          var conteudo = [
            el("p", null, ["Remove a estação, ", el("b", null, (nVersoes || 0) + (nVersoes === 1 ? " versão" : " versões") + " do histórico"),
              " e " + (enviadas == null ? "as imagens enviadas a ela" : enviadas === 1 ? "1 imagem enviada a ela" : enviadas + " imagens enviadas a ela") + " no estúdio. ",
              el("b", null, "Não dá para desfazer."), " Para só tirar da lista, use “Arquivar”."]),
            el("p", "es-excluir-baixar", ["Recomendado: baixe uma cópia antes. ", ui.botao("Baixar .js", "mini", function () { baixar(); })]),
            publicada ? el("p", "es-excluir-aviso", "Esta estação foi publicada para aplicação (versão " + x.linha.publicada_versao + "). A cópia publicada continua na área de aplicação (sessões e notas dependem dela); só a estação do estúdio é apagada.") : null,
            el("div", "es-form-dialogo", el("label", null, [el("span", null, ["Digite o título para confirmar: ", el("span", "es-excluir-alvo", esperado)]), campo]))
          ];
          var bApagar = null;
          var confere = function () { return !!esperado && semEspacosNasPontas(campo.value) === esperado; };
          return ui.dialogo("Apagar de vez “" + esperado + "”?", conteudo, [
            { rotulo: "Cancelar", valor: null },
            { rotulo: "Apagar de vez", valor: function () { return confere() ? campo.value : null; }, perigo: true }
          ], { aoAbrir: function (dlg) {
            bApagar = dlg.querySelector(".ed-dialogo-acoes .perigo");
            if (bApagar) bApagar.disabled = true;
            campo.addEventListener("input", function () { if (bApagar) bApagar.disabled = !confere(); });
            campo.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && confere() && bApagar) { ev.preventDefault(); bApagar.click(); } });
          } }).then(function (confirmacao) {
            if (confirmacao == null) return;
            msg("Apagando…");
            return E.api.excluir(x.id, confirmacao).then(function (r) {
              r = r || {};
              var imgs = Array.isArray(r.imagens) ? r.imagens : imagensDoObjeto(x.dados).map(function (a) { return x.id + "/" + a; });
              return E.arm.remover(E.arm.ESTUDIO, imgs).then(function (rem) {
                fecharApagada(x);
                return recarregarLista().catch(function (e) { console.warn(e); }).then(renderizar).then(function () {
                  var nv = r.versoes_apagadas != null ? r.versoes_apagadas : nVersoes;
                  var t = "Estação apagada (" + nv + (nv === 1 ? " versão" : " versões") + " do histórico" +
                    (rem.removidos.length ? "; " + rem.removidos.length + " imagem(ns)" : "") + ")." +
                    (r.publicada ? " A cópia publicada para aplicação continua." : "") +
                    (rem.falhas.length ? " Estas imagens ficaram no Storage (bucket “estudio”; apague pelo painel do Supabase): " +
                      rem.falhas.map(function (c) { return c.replace(/^[^/]+\//, ""); }).join(", ") + "." : "");
                  msg(t, rem.falhas.length ? "erro" : "ok");
                  ui.toast("Estação apagada.", "ok");
                });
              });
            });
          });
        });
      });
    }).catch(function (e) { msg("Não foi possível apagar: " + ui.textoErro(e), "erro"); });
  }
  function baixar() {
    var x = atual(); if (!x) return;
    try { window.SalvarEstacao.baixar(x); msg("estacao.js baixado (conteúdo que está na tela).", "ok"); } catch (e) { msg("Não foi possível baixar: " + e.message, "erro"); }
  }
  function recarregar() {
    return exigirSemPendencias("recarregar").then(function (ok) {
      if (!ok) return;
      var x = atual();
      if (x) { x.dados = null; delete estado.urls[x.id]; }
      msg("Recarregando…");
      return recarregarLista().then(function () {
        msg("");
        if (x && entradaPorId(x.id)) return selecionar(x.chave, true);
        return renderizar();
      });
    }).catch(function (e) { msg("Não foi possível recarregar: " + ui.textoErro(e), "erro"); });
  }

  /* ---------------- Publicar para aplicação ----------------
     estudio_publicar → copiar imagens estudio → estacoes → confirmar_publicacao */
  function semBucket(caminho, nomeBucket) {
    var c = String(caminho || "").replace(/^\/+/, "");
    return c.indexOf(nomeBucket + "/") === 0 ? c.slice(nomeBucket.length + 1) : c;
  }
  /* Contagem do modo revisão (o mesmo revisor do painel), para avisar antes de aprovar ou publicar */
  function contagemRevisao(dados) {
    var a = [];
    try { a = window.revisarEstacao ? window.revisarEstacao(dados) || [] : []; } catch (e) { a = [{ nivel: "erro" }]; }
    var n = function (nv) { return a.filter(function (x) { return x && x.nivel === nv; }).length; };
    return { erros: n("erro"), avisos: n("aviso") };
  }
  function textoRevisao(c) {
    if (!c.erros && !c.avisos) return "O modo revisão não aponta erros nem avisos.";
    return "O modo revisão aponta " + c.erros + (c.erros === 1 ? " erro" : " erros") + " e " + c.avisos + (c.avisos === 1 ? " aviso" : " avisos") +
      (c.erros ? ": confira (botão “Modo revisão”) antes de continuar." : ".");
  }
  /* Status ≠ aprovada: oferece aprovar (grava uma versão nova com status "aprovada") e publicar em seguida.
     Resolve true (aprovou e pode publicar), "previa" (quer ver antes) ou false. */
  function aprovarParaPublicar(x) {
    var st = STATUS[x.dados.status] || x.dados.status || "sem status";
    var c = contagemRevisao(x.dados);
    return ui.dialogo("Aprovar e publicar?", [
      el("p", null, ["“" + (x.dados.titulo || "") + "” está com status ", el("b", null, st), ". Só estações aprovadas vão para a área de aplicação."]),
      el("p", null, "Aprovar grava a versão " + ((x.versao || 0) + 1) + " com status “Aprovada” (a versão " + (x.versao != null ? x.versao : "atual") + " continua no histórico) e publica em seguida."),
      el("p", c.erros ? "es-aviso-erro" : "es-sutil", textoRevisao(c))
    ], [
      { rotulo: "Cancelar", valor: false },
      { rotulo: "Ver como…", valor: "previa" },
      { rotulo: "Aprovar e publicar", valor: true, primario: true }
    ]).then(function (v) {
      if (v === "previa") { abrirPrevia(); return false; }
      if (v !== true) return false;
      var ed = editor();
      var sairEdicao = ed && ed.desligar && document.body.classList.contains("modo-edicao") ? ed.desligar() : true;
      return Promise.resolve(sairEdicao).then(function (saiu) {
        if (saiu === false) return false;
        var antes = x.dados.status;
        x.dados.status = "aprovada";
        msg("Aprovando…");
        return window.SalvarEstacao.salvar(x, {}).then(function (r) {
          msg("Aprovada: versão " + (r && r.versao != null ? r.versao : x.versao) + " do estúdio.", "ok");
          montarLista();
          renderizar();
          return true;
        }, function (e) {
          x.dados.status = antes;
          atualizarBotoes();
          msg("Não foi possível aprovar: " + ((e && e.message) || ui.textoErro(e)), "erro");
          return false;
        });
      });
    });
  }
  var publicando = false;
  function publicar() {
    var x = atual(); if (!x || !x.dados || estado.vista || publicando) return;
    publicando = true;
    var bp = $("btn-publicar"); if (bp) bp.disabled = true;
    return exigirSemPendencias("publicar").then(function (ok) {
      if (!ok) return;
      if (x.dados.status !== "aprovada") return aprovarParaPublicar(x).then(function (aprovou) { if (aprovou) return publicarAprovada(x, true); });
      return publicarAprovada(x, false);
    }).catch(function (e) { msg("Não foi possível publicar: " + ui.textoErro(e), "erro"); })
      .then(function () { publicando = false; atualizarBotoes(); });
  }
  function publicarAprovada(x, jaConfirmou) {
      var pergunta = jaConfirmou ? Promise.resolve(true) : ui.dialogo("Publicar para aplicação?", [
        el("p", null, "“" + (x.dados.titulo || "") + "” (" + nomeBanca(x.dados.banca) + "), versão " + x.versao + " do estúdio, vira uma versão congelada na área de aplicação (sessões, aplicadores e atores)."),
        el("p", contagemRevisao(x.dados).erros ? "es-aviso-erro" : "es-sutil", textoRevisao(contagemRevisao(x.dados)))
      ], [
        { rotulo: "Cancelar", valor: false },
        { rotulo: "Ver como…", valor: "previa" },
        { rotulo: "Publicar", valor: true, primario: true }
      ]).then(function (v) { if (v === "previa") { abrirPrevia(); return false; } return v === true; });
      return pergunta
        .then(function (sim) {
          if (!sim) return;
          var log = el("ul", "es-log");
          var linha = function (cls, t) { log.appendChild(el("li", cls, t)); };
          var fim = null, fechar = ui.botao("Fechar", "primario", function () { if (fim) fim(null); });
          fechar.disabled = true;
          ui.dialogo("Publicação", [log], [], { largo: true, semEsc: true, aoAbrir: function (dlg, f) { fim = f; dlg.querySelector(".ed-dialogo-acoes").appendChild(fechar); } });
          linha("info", "Enviando ao servidor…");
          return E.api.publicar(x.id).then(function (r) {
            r = r || {};
            var pubId = r.pub_id != null ? r.pub_id : r.id;
            linha("ok", (r.ja_existia ? "Conteúdo idêntico já publicado" : "Publicação criada") + (r.versao != null ? ": versão " + r.versao : "") + " (id " + pubId + ").");
            var imgs = Array.isArray(r.imagens) ? r.imagens : [];
            if (r.ja_existia && r.pronta) { linha("ok", "Essa versão já está pronta. Nada a copiar."); return; }
            if (!imgs.length) linha("info", "Sem imagens para copiar.");
            return imgs.reduce(function (p, im) {
              return p.then(function () {
                var origem = typeof im === "string" ? x.id + "/" + im : (im.caminho_origem || semBucket(im.origem, E.arm.ESTUDIO));
                var destino = semBucket(typeof im === "string" ? pubId + "/" + im : im.destino, E.arm.PUBLICADAS);
                var nome = (im && im.arquivo) || destino.replace(/^[^/]+\//, "");
                if (im && im.ja_copiada) { linha("ok", nome + " (já estava na área de aplicação)."); return; }
                if (im && im.no_estudio === false) { linha("erro", nome + ": a imagem ainda não foi enviada ao estúdio (use “Imagens…” e publique de novo)."); return; }
                return E.arm.copiar(E.arm.ESTUDIO, origem, E.arm.PUBLICADAS, destino).then(function (c) {
                  linha("ok", destino.replace(/^[^/]+\//, "") + (c && c.jaExistia ? " (já estava na área de aplicação)" : " copiada."));
                }, function (e) { linha("erro", destino.replace(/^[^/]+\//, "") + ": " + ui.textoErro(e) + " (a imagem foi enviada ao estúdio? use “Imagens…”)."); });
              });
            }, Promise.resolve()).then(function () { return E.api.confirmarPublicacao(pubId); }).then(function (c) {
              if (c && c.pronta) linha("ok", "Publicação confirmada: a estação já pode entrar em sessões (Área admin › Sessões).");
              else linha("erro", "Faltam imagens: " + ((c && c.faltam) || []).join(", ") + ". Envie-as em “Imagens…” e publique de novo (a mesma versão é reaproveitada).");
            });
          }).catch(function (e) {
            linha("erro", "Publicação recusada: " + ui.textoErro(e));
          }).then(function () { fechar.disabled = false; fechar.focus(); });
        });
  }

  /* ------------------------------------------------------------------
   * Ver como… — prévia por perfil (aplicador, ator, aluno)
   * Um iframe abre as TELAS REAIS do site de aplicação (index.html?previa=<papel>, mesma origem).
   * O conteúdo é o que está na tela (inclusive alterações não salvas, ou a versão do histórico aberta)
   * e passa pela MESMA lista branca do servidor (RPC estudio_previsualizar, migração 011).
   * Contrato com online/js/previa.js: window.EstudioPrevia.obter(papel) → Promise<{titulo, area, banca, dia,
   * resposta, imagens}>. Nada é gravado; sessão e alunos da prévia são fictícios.
   * ------------------------------------------------------------------ */
  var PERFIS_PREVIA = [["aplicador", "Aplicador(a)"], ["ator", "Ator / atriz"], ["aluno", "Aluno(a)"]];
  var TAMANHOS_PREVIA = [["390", "Celular"], ["820", "Tablet"]];
  var NOTAS_PREVIA = {
    aplicador: "Recebe o material da estação, o checklist e os critérios para avaliar, a discussão e o cronômetro. Não recebe revisão, referências nem status.",
    ator: "Recebe só o roteiro de atuação e, para entender a cena, o que o candidato recebe. Não vê checklist, critérios, orientações ao examinador, discussão nem notas.",
    aluno: "Não recebe o material (propriedade da empresa). Vê só a situação da estação e, depois da liberação, título, nota total, nota por domínio e feedback."
  };
  var previa = { papel: "aplicador", largura: "390", no: null, quadro: null, chave: null, dados: null };
  function dadosNaTela() {
    var x = atual();
    if (!x) return null;
    return { x: x, dados: estado.vista ? estado.vista.dados : x.dados };
  }
  window.EstudioPrevia = {
    fechar: function () { fecharPrevia(); },
    obter: function (papel) {
      var t = dadosNaTela();
      if (!t || !t.dados) return Promise.reject(new Error("Nenhuma estação aberta no Estúdio."));
      if (!PERFIS_PREVIA.some(function (p) { return p[0] === papel; })) return Promise.reject(new Error("Perfil inválido: " + papel));
      var copia;
      try { copia = JSON.parse(JSON.stringify(t.dados)); } catch (e) { return Promise.reject(e); }
      return E.api.previsualizar(copia, papel).then(function (r) {
        r = r || {};
        mostrarAvisosPrevia(papel, r.avisos);
        var c = r.conteudo || null;
        var arqs = c ? imagensDoObjeto(c).filter(function (a) { return !/^(https?:|data:|blob:)/i.test(a); }) : [];
        var p = arqs.length ? urlsImagens(t.x, c) : Promise.resolve({});
        return p.then(function () {
          var cache = estado.urls[t.x.id] || { mapa: {} }, imagens = {};
          arqs.forEach(function (a) { if (cache.mapa[a]) imagens[a] = cache.mapa[a]; });
          return { titulo: copia.titulo || "", area: copia.area || "", banca: copia.banca || "", dia: copia.dia || "", resposta: r, imagens: imagens };
        });
      }, function (e) { throw new Error(ui.textoErro(e)); });
    }
  };
  /* Rascunho incompleto: o servidor devolve a prévia mesmo assim e explica o que não deu para calcular */
  function mostrarAvisosPrevia(papel, avisos) {
    if (!previa.nota || papel !== previa.papel) return;
    var velho = previa.nota.querySelector(".es-previa-avisos");
    if (velho) velho.parentNode.removeChild(velho);
    var lst = (Array.isArray(avisos) ? avisos : []).filter(function (a) { return a != null && String(a).trim(); });
    if (!lst.length) return;
    previa.nota.appendChild(el("span", "es-previa-avisos", [el("br"), el("b", null, "Avisos do servidor: "), lst.map(String).join(" · ")]));
  }
  function montarPrevia() {
    if (previa.no) return previa.no;
    var titulo = el("h2", null, "Ver como…");
    var perfis = el("div", "es-previa-perfis");
    perfis.setAttribute("role", "group"); perfis.setAttribute("aria-label", "Perfil");
    PERFIS_PREVIA.forEach(function (p) {
      var b = ui.botao(p[1], "mini", function () { previa.papel = p[0]; carregarPrevia(); });
      b.dataset.papel = p[0];
      perfis.appendChild(b);
    });
    var tam = el("div", "es-previa-tamanhos");
    tam.setAttribute("role", "group"); tam.setAttribute("aria-label", "Tamanho da tela");
    TAMANHOS_PREVIA.forEach(function (t) {
      var b = ui.botao(t[1], "mini", function () { previa.largura = t[0]; ajustarPrevia(); });
      b.dataset.largura = t[0];
      tam.appendChild(b);
    });
    var atualizar = ui.botao("Atualizar", "mini", function () { carregarPrevia(); }, "Recarregar com o conteúdo que está na tela agora");
    var fechar = ui.botao("Fechar", "primario", fecharPrevia);
    var nota = el("p", "es-previa-nota");
    var aparelho = el("div", "es-previa-aparelho");
    var palco = el("div", "es-previa-palco", aparelho);
    var caixa = el("div", "es-previa-caixa", [el("div", "es-previa-cab", [titulo, perfis, tam, atualizar, fechar]), nota, palco]);
    var no = el("div", "es-previa", caixa);
    no.setAttribute("role", "dialog"); no.setAttribute("aria-modal", "true"); no.setAttribute("aria-label", "Ver como cada perfil vê a estação");
    no.hidden = true;
    no.addEventListener("click", function (ev) { if (ev.target === no) fecharPrevia(); });
    /* com a prévia aberta, nenhum atalho chega ao editor (⌘S, ⌘Z…) atrás dela; Esc fecha */
    document.addEventListener("keydown", function (ev) {
      if (!previa.no || previa.no.hidden) return;
      if (ev.key === "Escape") { ev.preventDefault(); fecharPrevia(); return; }
      if (ev.ctrlKey || ev.metaKey) ev.stopImmediatePropagation();
    }, true);
    document.body.appendChild(no);
    previa.no = no; previa.fechar = fechar; previa.titulo = titulo; previa.perfis = perfis; previa.tam = tam; previa.nota = nota; previa.aparelho = aparelho;
    return no;
  }
  function ajustarPrevia() {
    Array.prototype.forEach.call(previa.perfis.children, function (b) { b.setAttribute("aria-pressed", b.dataset.papel === previa.papel ? "true" : "false"); });
    Array.prototype.forEach.call(previa.tam.children, function (b) { b.setAttribute("aria-pressed", b.dataset.largura === previa.largura ? "true" : "false"); });
    previa.aparelho.style.width = (Number(previa.largura) + 20) + "px";
  }
  function carregarPrevia() {
    var t = dadosNaTela();
    if (!t) return;
    ajustarPrevia();
    var d = t.dados || {};
    ui.limpar(previa.titulo).appendChild(document.createTextNode("Ver como… · " + (d.titulo || "estação sem título")));
    var pend = pendente(), vista = estado.vista;
    ui.limpar(previa.nota);
    ui.anexar(previa.nota, [
      el("b", null, (PERFIS_PREVIA.filter(function (p) { return p[0] === previa.papel; })[0] || [])[1] + ": "), NOTAS_PREVIA[previa.papel] + " ",
      vista ? "Mostrando a versão " + vista.versao + " do histórico. " : pend ? "Inclui as alterações ainda não salvas. " : "",
      "Filtro do servidor (o mesmo da área de aplicação); sessão e alunos são fictícios e nada é gravado."
    ]);
    limparQuadroPrevia();
    ui.limpar(previa.aparelho);
    var f = document.createElement("iframe");
    f.title = "Prévia: tela do perfil " + previa.papel;
    f.src = "index.html?previa=" + encodeURIComponent(previa.papel);
    previa.aparelho.appendChild(f);
    previa.quadro = f;
  }
  function limparQuadroPrevia() {
    try { var w = previa.quadro && previa.quadro.contentWindow; if (w && w.Previa && w.Previa.limpar) w.Previa.limpar(); } catch (e) { /* nada */ }
  }
  function abrirPrevia() {
    if (!dadosNaTela()) { msg("Selecione uma estação.", "erro"); return; }
    montarPrevia();
    previa.no.hidden = false;
    // o resto da página fica inerte (foco e leitores de tela só dentro da prévia)
    previa.inertes = Array.prototype.filter.call(document.body.children, function (n) { return n !== previa.no && !n.inert; });
    previa.inertes.forEach(function (n) { n.inert = true; });
    carregarPrevia();
    previa.fechar.focus();
  }
  function fecharPrevia() {
    if (!previa.no) return;
    previa.no.hidden = true;
    (previa.inertes || []).forEach(function (n) { n.inert = false; });
    previa.inertes = null;
    // apaga o que a prévia guardou na aba e descarrega o iframe
    limparQuadroPrevia();
    ui.limpar(previa.aparelho);
    previa.quadro = null;
    var b = $("btn-previa"); if (b) b.focus();
  }

  /* ------------------------------------------------------------------
   * Controles e início
   * ------------------------------------------------------------------ */
  function ligarControles() {
    $("btn-imprimir").addEventListener("click", function () { window.print(); });
    $("btn-publicar").addEventListener("click", publicar);
    $("btn-previa").addEventListener("click", abrirPrevia);
    // a coluna da direita (edição/revisão) estreita o documento: reajusta o zoom quando ela abre ou fecha
    var classeAntes = document.body.className;
    new MutationObserver(function () {
      var agora = document.body.className;
      var mudou = /\bmodo-edicao\b/.test(agora) !== /\bmodo-edicao\b/.test(classeAntes);
      classeAntes = agora;
      if (mudou && estado.atual) aplicarZoom();
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    $("opt-capa").addEventListener("change", renderizar);
    $("opt-zoom").addEventListener("change", aplicarZoom);
    window.addEventListener("resize", function () { if (estado.atual) aplicarZoom(); });
    $("btn-revisao").addEventListener("click", function () {
      var on = !document.body.classList.contains("com-revisao");
      document.body.classList.toggle("com-revisao", on);
      this.setAttribute("aria-pressed", on ? "true" : "false");
      atualizarRevisao();
      aplicarZoom();
    });
    $("filtro-banca").addEventListener("change", montarLista);
    $("filtro-status").addEventListener("change", montarLista);
    $("filtro-texto").addEventListener("input", montarLista);
    $("filtro-arquivadas").addEventListener("change", montarLista);
    $("es-nova").addEventListener("click", novaEmBranco);
    $("es-duplicar").addEventListener("click", duplicar);
    $("es-historico").addEventListener("click", historico);
    $("es-baixar").addEventListener("click", baixar);
    $("es-recarregar").addEventListener("click", recarregar);
    $("es-arquivar").addEventListener("click", arquivar);
    $("es-excluir").addEventListener("click", excluir);
    $("es-imagens").addEventListener("change", function () { var fs = this.files; var inp = this; enviarImagens(fs).then(function () { inp.value = ""; }); });
    if (document.fonts && document.fonts.addEventListener) {
      var t = null;
      document.fonts.addEventListener("loadingdone", function () { clearTimeout(t); t = setTimeout(function () { if (estado.atual) renderizar(); }, 250); });
    }
    window.addEventListener("hashchange", function () {
      var id = location.hash.slice(1);
      var x = id ? entradaPorId(id) : null;
      if (x && x.chave !== estado.atual) selecionar(x.chave);
    });
    // o editor desliga o modo edição sozinho; ao entrar nele, sai da visualização do histórico
    $("btn-editar").addEventListener("click", function () { if (estado.vista) sairDaVista(); }, true);
  }

  window.App = {
    STATUS: STATUS,
    atual: atual,
    renderizar: renderizar,
    montarLista: montarLista,
    atualizarRevisao: atualizarRevisao,
    somaChecklist: somaChecklist,
    nomeBanca: nomeBanca,
    mostrarAba: mostrarAba,
    estacaoPorId: function (id) {
      var x = estado.entradas.filter(function (e) { return e.id === id || (e.dados && e.dados.id === id); })[0];
      return x ? x.chave : null;
    },
    selecionar: function (chave) { mostrarAba("estacoes"); return selecionar(chave); },
    // do estúdio
    recarregarLista: recarregarLista,
    abrirPorId: abrirPorId,
    entradaPorId: entradaPorId,
    imagensDoObjeto: imagensDoObjeto,
    mensagem: msg,
    esquecerImagens: function (id) { delete estado.urls[id]; }
  };

  ligarControles();
  ligarAbas();
  renderizar();
  E.aoPronto(function () {
    var q = new URLSearchParams(location.search);
    if (q.get("capa") === "1") $("opt-capa").checked = true;
    if (q.get("revisao") === "1") $("btn-revisao").click();
    recarregarLista().then(function () {
      var id = location.hash.slice(1);
      var alvo = (id && entradaPorId(id)) || estado.entradas.filter(function (x) { return !(x.linha && x.linha.arquivada); }).sort(function (a, b) {
        return String((b.linha && b.linha.atualizado_em) || "").localeCompare(String((a.linha && a.linha.atualizado_em) || ""));
      })[0];
      if (alvo) return selecionar(alvo.chave, true);
      return renderizar();
    }).catch(function (e) {
      estado.carregou = true;
      montarLista();
      msg("Não foi possível carregar a lista: " + ui.textoErro(e), "erro");
      $("aviso").textContent = "Não foi possível carregar as estações do estúdio: " + ui.textoErro(e);
    });
  });
})();
