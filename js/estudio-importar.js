/* =====================================================================
 * estudio-importar.js — Importar estações para o ESTÚDIO online.
 *
 * Aceita, de uma vez: vários estacao.js (registrarEstacao(…)) e/ou .json,
 * e as imagens da pasta img/ — por seleção de arquivos ou da pasta inteira
 * (ex.: saidas/). O arquivo .js NUNCA é executado: o objeto é extraído como
 * texto (argumento de registrarEstacao), sem comentários, e lido com JSON.parse
 * (mesma regra de online/js/admin.js). Pastas versoes/ (backups) são ignoradas.
 *
 * Cada estação vira uma linha nova em estacoes_trabalho (origem "importada");
 * se já existir uma com o mesmo título e banca, pergunta: atualizar a existente
 * (nova versão, a anterior fica no histórico), importar como outra, ou pular.
 * Imagens: bucket "estudio", <id>/img/<arquivo> (casadas pela pasta e pelo nome).
 * ===================================================================== */
(function () {
  "use strict";
  var E = window.Estudio;
  if (!E) return;
  var ui = E.ui, el = ui.el;
  var RX_IMG = /^img\/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp|gif)$/i;
  var MAX_IMAGEM = 10 * 1024 * 1024;
  var MAX_TEXTO = 5 * 1024 * 1024;

  /* ---------------- leitura sem executar ---------------- */
  function lerTexto(arquivo) {
    function ler(cod) {
      return new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () { res(String(fr.result || "")); };
        fr.onerror = function () { rej(fr.error || new Error("Falha ao ler o arquivo.")); };
        fr.readAsText(arquivo, cod);
      });
    }
    return ler("utf-8").then(function (t) { return t.indexOf("�") >= 0 ? ler("windows-1252") : t; })
      .then(function (t) { return t.replace(/^﻿/, ""); });
  }
  /* Remove comentários // e /* *\/ fora de strings */
  function semComentarios(t) {
    var out = "", i = 0, n = t.length, q = null;
    while (i < n) {
      var c = t[i], d = t[i + 1];
      if (q) {
        out += c;
        if (c === "\\" && i + 1 < n) { out += d; i += 2; continue; }
        if (c === q) q = null;
        i++; continue;
      }
      if (c === '"' || c === "'" || c === "`") { q = c; out += c; i++; continue; }
      if (c === "/" && d === "/") { while (i < n && t[i] !== "\n") i++; continue; }
      if (c === "/" && d === "*") { var fim = t.indexOf("*/", i + 2); i = fim < 0 ? n : fim + 2; out += " "; continue; }
      out += c; i++;
    }
    return out;
  }
  function argumentoRegistrar(t) {
    var m = /registrarEstacao\s*\(/.exec(t);
    if (!m) throw new Error("O arquivo não contém a chamada registrarEstacao(…).");
    var ini = m.index + m[0].length, nivel = 1, q = null, i;
    for (i = ini; i < t.length; i++) {
      var c = t[i];
      if (q) { if (c === "\\") { i++; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === "`") { q = c; continue; }
      if (c === "(") nivel++;
      else if (c === ")") { nivel--; if (nivel === 0) break; }
    }
    if (nivel !== 0) throw new Error("Não encontrei o fechamento de registrarEstacao(…).");
    if (/registrarEstacao\s*\(/.test(t.slice(i + 1))) throw new Error("O arquivo chama registrarEstacao mais de uma vez.");
    return t.slice(ini, i).trim();
  }
  function estacoesDoTexto(nome, texto) {
    var lidas;
    if (/\.json$/i.test(nome)) {
      try { lidas = JSON.parse(texto); } catch (e) { throw new Error("JSON inválido (" + e.message + ")."); }
      lidas = Array.isArray(lidas) ? lidas : [lidas];
    } else {
      var arg = argumentoRegistrar(semComentarios(texto));
      try { lidas = [JSON.parse(arg)]; }
      catch (e) { throw new Error("O conteúdo de registrarEstacao(…) não é JSON estrito (" + e.message + "). Abra e salve a estação no visualizador local (o salvar normaliza o arquivo) e importe de novo."); }
    }
    lidas.forEach(function (o) {
      if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("registrarEstacao(…) não recebeu um objeto.");
      if (!o.banca || !o.titulo) throw new Error("A estação precisa ter pelo menos “banca” e “titulo”.");
    });
    return lidas;
  }

  /* ---------------- arquivos escolhidos ---------------- */
  function caminhoDe(f) { return String(f.webkitRelativePath || f.name).replace(/\\/g, "/"); }
  function pastaDe(c) { var i = c.lastIndexOf("/"); return i >= 0 ? c.slice(0, i + 1) : ""; }
  function separar(arquivos) {
    var textos = [], imagens = [], ignorados = [], pdfs = [];
    Array.prototype.slice.call(arquivos || []).forEach(function (f) {
      var c = caminhoDe(f);
      if (/(^|\/)versoes\//i.test(c) || /(^|\/)\./.test(c)) { ignorados.push(c); return; }
      if (/(^|\/)catalogo\.js$/i.test(c)) { ignorados.push(c); return; }
      if (/\.(js|json)$/i.test(f.name)) textos.push(f);
      else if (/\.pdf$/i.test(f.name)) pdfs.push(f);
      else if (/\.(png|jpe?g|webp|gif)$/i.test(f.name)) imagens.push(f);
      else ignorados.push(c);
    });
    return { textos: textos, imagens: imagens, ignorados: ignorados, pdfs: pdfs };
  }
  /* imagem para o caminho "img/x.png" da estação que veio de pastaEstacao */
  function acharImagem(imagens, pastaEstacao, ref) {
    var alvo = (pastaEstacao + ref).toLowerCase();
    var porCaminho = imagens.filter(function (f) { return caminhoDe(f).toLowerCase() === alvo; })[0];
    if (porCaminho) return porCaminho;
    var nome = ref.split("/").pop().toLowerCase();
    var candidatas = imagens.filter(function (f) { return f.name.toLowerCase() === nome; });
    return candidatas.length === 1 ? candidatas[0] : (candidatas.filter(function (f) { return caminhoDe(f).toLowerCase().indexOf(pastaEstacao.toLowerCase()) === 0; })[0] || candidatas[0] || null);
  }
  /* linhas do servidor (estudio_listar), lidas no começo de cada importação */
  var linhasServidor = [];
  /* já existe no estúdio? (mesmo título e banca, não arquivada) */
  function existente(o) {
    var tit = String(o.titulo || "").trim().toLowerCase();
    return linhasServidor.filter(function (l) {
      return String(l.titulo || "").trim().toLowerCase() === tit && l.banca === o.banca && !l.arquivada;
    })[0] || null;
  }

  function perguntarDuplicata(o, linha) {
    return ui.dialogo("Estação já existe no estúdio", [
      el("p", null, "Já há “" + (linha.titulo || o.titulo) + "” (" + (window.App ? window.App.nomeBanca(o.banca) : o.banca) + "), versão " + (linha.versao != null ? linha.versao : "?") + ", no estúdio."),
      el("p", "es-sutil", "Atualizar grava o arquivo importado como nova versão da existente (a anterior fica no histórico).")
    ], [
      { rotulo: "Pular", valor: "pular" },
      { rotulo: "Importar como outra", valor: "outra" },
      { rotulo: "Atualizar a existente", valor: "atualizar", primario: true }
    ]).then(function (v) { return v || "pular"; });
  }

  function enviarImagensDe(id, o, pastaEstacao, imagens, linha) {
    var refs = (window.App && window.App.imagensDoObjeto ? window.App.imagensDoObjeto(o) : []).filter(function (a) { return !/^(https?:|data:|blob:)/i.test(a); });
    return refs.reduce(function (p, ref) {
      return p.then(function () {
        if (!RX_IMG.test(ref)) { linha("aviso", "  " + ref + ": caminho fora do padrão img/<arquivo>.png|jpg|webp|gif (não enviado; a publicação recusaria)."); return; }
        var f = acharImagem(imagens, pastaEstacao, ref);
        if (!f) { linha("aviso", "  " + ref + ": imagem não selecionada (fica “pendente”; envie depois em “Imagens…”)."); return; }
        if (f.size > MAX_IMAGEM) { linha("erro", "  " + ref + ": maior que 10 MB."); return; }
        return E.arm.enviar(E.arm.ESTUDIO, id + "/" + ref, f, { tipo: ui.tipoArquivo(f.name), substituir: true })
          .then(function () { linha("ok", "  " + ref + " enviada."); }, function (e) { linha("erro", "  " + ref + ": " + ui.textoErro(e)); });
      });
    }, Promise.resolve());
  }

  /* Ponto de entrada. PDF (só por “Importar arquivos…”, nunca pela pasta) abre o painel de
     importação com IA, um PDF por vez; .js/.json seguem a importação direta de antes. */
  function importar(arquivos, op) {
    op = op || {};
    var sep = separar(arquivos);
    if (op.pasta && sep.pdfs.length) { sep.ignorados = sep.ignorados.concat(sep.pdfs.map(caminhoDe)); sep.pdfs = []; }
    if (!sep.pdfs.length) return importarTextos(sep);
    if (window.EditorEstacao && window.EditorEstacao.pendente && window.EditorEstacao.pendente()) {
      return ui.dialogo("Há alterações não salvas", "Salve ou descarte as alterações da estação aberta antes de importar.", [{ rotulo: "Entendi", valor: null, primario: true }]);
    }
    return sep.pdfs.reduce(function (p, f) { return p.then(function () { return painelPdf(f); }); }, Promise.resolve())
      .then(function () { if (sep.textos.length) return importarTextos(sep); });
  }

  function importarTextos(sep) {
    var App = window.App;
    if (!sep.textos.length) {
      if (sep.imagens.length && App && App.atual && App.atual()) {
        App.mensagem("Só imagens selecionadas: use “Imagens…” para enviá-las à estação aberta.", "erro");
      } else if (App) App.mensagem("Nenhum arquivo de estação (.js, .json ou .pdf) na seleção.", "erro");
      return Promise.resolve();
    }
    if (window.EditorEstacao && window.EditorEstacao.pendente && window.EditorEstacao.pendente()) {
      return ui.dialogo("Há alterações não salvas", "Salve ou descarte as alterações da estação aberta antes de importar.", [{ rotulo: "Entendi", valor: null, primario: true }]);
    }
    var log = el("ul", "es-log");
    var linha = function (cls, t) { log.appendChild(el("li", cls, t)); log.scrollTop = log.scrollHeight; };
    var fim = null, fechar = ui.botao("Fechar", "primario", function () { if (fim) fim(null); });
    fechar.disabled = true;
    ui.dialogo("Importar estações", [el("p", "es-sutil", sep.textos.length + " arquivo(s) de estação, " + sep.imagens.length + " imagem(ns)" + (sep.ignorados.length ? ", " + sep.ignorados.length + " ignorado(s) (versoes/, catálogo e outros)" : "") + "."), log],
      [], { largo: true, semEsc: true, aoAbrir: function (dlg, f) { fim = f; dlg.querySelector(".ed-dialogo-acoes").appendChild(fechar); } });
    var criados = [];
    var antes = App && App.recarregarLista ? App.recarregarLista().then(function (l) { linhasServidor = Array.isArray(l) ? l : []; }) : Promise.resolve();
    return antes.then(function () {
      return sep.textos.reduce(function (p, f) {
        return p.then(function () {
          var c = caminhoDe(f);
          if (f.size > MAX_TEXTO) { linha("erro", c + ": arquivo grande demais (máx. 5 MB)."); return; }
          return lerTexto(f).then(function (texto) {
            var lidas;
            try { lidas = estacoesDoTexto(f.name, texto); } catch (e) { linha("erro", c + ": " + e.message); return; }
            return lidas.reduce(function (p2, o) {
              return p2.then(function () {
                var dup = existente(o);
                return (dup ? perguntarDuplicata(o, dup) : Promise.resolve("nova")).then(function (escolha) {
                  if (escolha === "pular") { linha("info", c + ": “" + o.titulo + "” pulada (já existe)."); return; }
                  var acao = escolha === "atualizar"
                    ? E.api.salvar(dup.id, o, dup.versao, false, "reimportada de " + f.name).then(function (r) { linha("ok", c + ": “" + o.titulo + "” " + (r && r.sem_mudanca ? "sem mudanças (nenhuma versão nova)." : "atualizada (versão " + ((r && r.versao) || "?") + ").")); return dup.id; })
                    : E.api.criar(o, "importada").then(function (r) { linha("ok", c + ": “" + o.titulo + "” importada (" + (o.status || "sem status") + ")."); if (r && r.aviso === "id_repetido") linha("aviso", "  outra estação do estúdio tem o mesmo id no JSON (" + (r.estacao_id || o.id) + "); publicar as duas cria versões da mesma estação publicada."); return r && r.id; });
                  return acao.then(function (id) {
                    if (!id) return;
                    criados.push(id);
                    if (App && App.esquecerImagens) App.esquecerImagens(id);
                    return enviarImagensDe(id, o, pastaDe(c), sep.imagens, linha);
                  }, function (e) {
                    linha("erro", c + ": “" + o.titulo + "” não importada — " + (e && e.code === "conflito_versao" ? "a existente mudou durante a importação; recarregue e tente de novo." : ui.textoErro(e)));
                  });
                });
              });
            }, Promise.resolve());
          }, function (e) { linha("erro", c + ": não foi possível ler (" + e.message + ")."); });
        });
      }, Promise.resolve());
    }).then(function () {
      linha(criados.length ? "ok" : "info", "Concluído: " + criados.length + " estação(ões) importada(s) ou atualizada(s).");
      if (!App) return;
      return App.recarregarLista().then(function () {
        if (criados.length) return App.abrirPorId(criados[criados.length - 1], true);
      });
    }).catch(function (e) {
      linha("erro", "Importação interrompida: " + ui.textoErro(e));
    }).then(function () { linhasServidor = []; fechar.disabled = false; fechar.focus(); });
  }

  /* =====================================================================
   * PDF → pedido de IA tipo "importar" (a IA TRANSCREVE o PDF para o esquema).
   * O PDF é lido e recortado AQUI, no navegador (pdf-lib, carregado só quando
   * um PDF é escolhido); só o recorte vai ao bucket privado "referencias", em
   * pedidos/<id>/importar/<arquivo>.pdf. Depois: gerar_criar_pedido (tipo
   * "importar") e a função gerar-estacao {acao:"enviar"} — a mesma da geração.
   * ===================================================================== */
  var PDF_LIB = {
    src: "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js",
    sri: "sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI"
  };
  var MAX_RECORTE = 23 * 1024 * 1024;        // o mesmo limite de arquivos por pedido da função gerar-estacao
  var MAX_PDF_LOCAL = 300 * 1024 * 1024;     // só para ler no navegador (o que sobe é o recorte)
  var AVISO_PAGINAS = 10;
  var BANCAS_PDF = [["einstein", "Einstein"], ["sirio-libanes", "Sírio-Libanês"], ["usp-ribeirao", "USP Ribeirão"],
    ["unifesp-r1", "Unifesp R1"], ["unifesp-rmais", "Unifesp R+"], ["tradicional", "Tradicional"]];
  var AVISO_SEM_CHAVE = "A IA ainda não está ativa: falta colocar a chave da API no Supabase (a função respondeu 503).";
  var promessaPdfLib = null;

  function tamanho(n) { return n > 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  function carregarPdfLib() {
    if (window.PDFLib && window.PDFLib.PDFDocument) return Promise.resolve(window.PDFLib);
    if (promessaPdfLib) return promessaPdfLib;
    promessaPdfLib = new Promise(function (ok, falha) {
      var s = document.createElement("script");
      s.src = PDF_LIB.src; s.async = true;
      s.crossOrigin = "anonymous"; s.referrerPolicy = "no-referrer"; s.integrity = PDF_LIB.sri;
      s.onload = function () { if (window.PDFLib && window.PDFLib.PDFDocument) ok(window.PDFLib); else falha(new Error("o leitor de PDF carregou incompleto")); };
      s.onerror = function () { falha(new Error("não foi possível carregar o leitor de PDF (pdf-lib); verifique a conexão")); };
      document.head.appendChild(s);
    }).catch(function (e) { promessaPdfLib = null; throw e; });
    return promessaPdfLib;
  }
  function abrirPdf(bytes) {
    return carregarPdfLib().then(function (L) { return L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); });
  }
  /* "2-6", "2,4-5", "7" (espaços e travessão aceitos); vazio = todas.
     → { paginas: [números, 1 = primeira], texto: "2-6", todas: bool }; erro com mensagem para a tela. */
  function compactar(lista) {
    var partes = [], i = 0;
    while (i < lista.length) {
      var a = lista[i], b = a;
      while (i + 1 < lista.length && lista[i + 1] === b + 1) { i++; b = lista[i]; }
      partes.push(a === b ? String(a) : a + "-" + b);
      i++;
    }
    return partes.join(",");
  }
  function lerIntervalo(texto, total) {
    var t = String(texto == null ? "" : texto).replace(/[‒-―]/g, "-").replace(/\s+/g, "");
    var lista = [], k;
    if (!(total >= 1)) throw new Error("O PDF não tem páginas legíveis.");
    if (!t) { for (k = 1; k <= total; k++) lista.push(k); return { paginas: lista, texto: compactar(lista), todas: true }; }
    if (!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(t)) throw new Error("Use números de página e intervalos separados por vírgula, como “2-6” ou “2,4-5”.");
    var marcadas = {};
    t.split(",").forEach(function (parte) {
      var m = parte.split("-"), a = parseInt(m[0], 10), b = m.length > 1 ? parseInt(m[1], 10) : a;
      if (a < 1 || b < 1) throw new Error("As páginas começam em 1 (“" + parte + "”).");
      if (a > b) throw new Error("Intervalo invertido: “" + parte + "” (escreva o menor número primeiro).");
      if (b > total) throw new Error("O PDF tem " + total + " página(s); “" + parte + "” passa disso.");
      for (k = a; k <= b; k++) marcadas[k] = true;
    });
    lista = Object.keys(marcadas).map(Number).sort(function (x, y) { return x - y; });
    return { paginas: lista, texto: compactar(lista), todas: lista.length === total };
  }
  /* origem: bytes do PDF ou um PDFDocument já aberto; paginas: números (1 = primeira) → Promise<Uint8Array> */
  function recortarPdf(origem, paginas) {
    var doc = origem && typeof origem.getPageCount === "function" ? Promise.resolve(origem) : abrirPdf(origem);
    return doc.then(function (orig) {
      return window.PDFLib.PDFDocument.create().then(function (novo) {
        return novo.copyPages(orig, paginas.map(function (p) { return p - 1; })).then(function (pgs) {
          pgs.forEach(function (pg) { novo.addPage(pg); });
          return novo.save({ useObjectStreams: true });
        });
      });
    });
  }
  function nomeRecorte(nomeOriginal, sel) {
    var n = ui.nomeSeguro(nomeOriginal).replace(/\.pdf$/i, "");
    return (sel.todas ? n : n + "-p" + sel.texto.replace(/,/g, "_")) + ".pdf";
  }

  function painelPdf(f) {
    var st = { doc: null, total: 0, ocupado: false, concluido: false, fim: null };
    var op = { largo: true, semEsc: false };
    var nPag = el("span", "es-sutil", "lendo o PDF neste computador…");
    var cab = el("div", "es-pdf-cab", [el("b", "es-pdf-nome", f.name), el("span", "es-sutil", tamanho(f.size) + " · "), nPag]);
    var inPag = el("input"); inPag.type = "text"; inPag.id = "es-pdf-paginas"; inPag.autocomplete = "off"; inPag.inputMode = "numeric";
    inPag.placeholder = "ex.: 2-6 ou 2,4-5 (vazio = todas)"; inPag.disabled = true;
    var msgPag = el("div", "es-pdf-sel es-sutil"); msgPag.setAttribute("aria-live", "polite"); msgPag.id = "es-pdf-paginas-msg";
    inPag.setAttribute("aria-describedby", msgPag.id);
    var selBanca = el("select"); selBanca.id = "es-pdf-banca";
    var o0 = el("option", null, "Detectar automaticamente"); o0.value = ""; selBanca.appendChild(o0);
    BANCAS_PDF.forEach(function (b) { var o = el("option", null, b[1]); o.value = b[0]; selBanca.appendChild(o); });
    var obs = el("textarea"); obs.id = "es-pdf-obs"; obs.rows = 2; obs.maxLength = 2000;
    obs.placeholder = "ex.: só a estação de dor torácica; as figuras estão na página 5";
    var rot = function (texto, controle) { var l = el("label", null, texto); l.htmlFor = controle.id; return el("div", "es-pdf-campo", [l, controle]); };
    var form = el("div", "es-form-dialogo es-form-pdf", [
      rot("Páginas", inPag), msgPag, rot("Banca", selBanca), rot("Observação (opcional)", obs)
    ]);
    var dica = el("p", "es-sutil es-pdf-dica", "A IA transcreve o PDF para o formato das estações (não cria conteúdo; o que faltar ou estiver ilegível vira lacuna na revisão). Recomendação: uma estação por vez ou poucas páginas, porque cada estação gera de 10 a 15 mil tokens de saída. O PDF é lido e recortado neste computador; só as páginas escolhidas são enviadas, ao armazenamento privado do estúdio (limite de 23 MB do recorte). Cada estação encontrada volta como rascunho.");
    var estado = el("div", "es-pdf-estado"); estado.setAttribute("role", "status"); estado.setAttribute("aria-live", "polite");
    function aviso(t, tipo) { estado.textContent = t || ""; estado.className = "es-pdf-estado" + (tipo ? " " + tipo : ""); }

    var btCancelar = ui.botao("Cancelar", null, function () { if (!st.ocupado && st.fim) st.fim(null); });
    var btImportar = ui.botao("Importar com IA", "primario", function () { executar(); });
    var btVer = ui.botao("Ver pedidos", null, function () {
      if (window.App && App.mostrarAba) App.mostrarAba("ia");
      if (st.fim) st.fim(null);
    });
    btImportar.disabled = true; btVer.hidden = true;

    function selecao() {
      if (!st.total) return null;
      var sel;
      try { sel = lerIntervalo(inPag.value, st.total); }
      catch (e) { msgPag.textContent = e.message; msgPag.className = "es-pdf-sel erro"; inPag.setAttribute("aria-invalid", "true"); return null; }
      inPag.removeAttribute("aria-invalid");
      var n = sel.paginas.length;
      var t = (sel.todas && !inPag.value.trim() ? "Vazio = todas as " + st.total + " páginas." : n + " página(s) selecionada(s): " + sel.texto + ".");
      if (n > AVISO_PAGINAS) t += " Atenção: são mais de " + AVISO_PAGINAS + " páginas. Prefira uma estação por vez (poucas páginas): várias estações num pedido podem passar do limite de saída da IA e custam mais.";
      msgPag.textContent = t;
      msgPag.className = "es-pdf-sel" + (n > AVISO_PAGINAS ? " aviso" : " es-sutil");
      return sel;
    }
    inPag.addEventListener("input", function () { selecao(); });
    inPag.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); executar(); } });

    function ocupar(on) {
      st.ocupado = on; op.semEsc = on;
      btImportar.disabled = on || !st.doc; btCancelar.disabled = on;
      inPag.disabled = on || !st.doc; selBanca.disabled = on; obs.disabled = on;
    }
    function terminar() {
      st.concluido = true; ocupar(false);
      btImportar.hidden = true; inPag.disabled = selBanca.disabled = obs.disabled = true;
      btCancelar.textContent = "Fechar"; btVer.hidden = false; btVer.focus();
      if (E.ia && E.ia.carregarPedidos) E.ia.carregarPedidos();
    }

    function executar() {
      if (st.ocupado || st.concluido || !st.doc) return;
      var sel = selecao();
      if (!sel) { inPag.focus(); return; }
      ocupar(true);
      var banca = selBanca.value || null, nota = obs.value.trim() || null;
      var id = ui.uuid(), caminho, pid = id, blob;
      aviso(sel.todas ? "Preparando o PDF inteiro (" + st.total + " páginas)…" : "Recortando as páginas " + sel.texto + " neste computador…");
      (sel.todas ? Promise.resolve(f) : recortarPdf(st.doc, sel.paginas)).then(function (bytes) {
        blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: "application/pdf" });
        var resumo = "Recorte: " + sel.paginas.length + " página(s), " + tamanho(blob.size) + ".";
        if (blob.size > MAX_RECORTE) { var e = new Error(resumo + " Passa do limite de 23 MB: escolha menos páginas."); e.local = true; throw e; }
        caminho = "pedidos/" + id + "/importar/" + nomeRecorte(f.name, sel);
        aviso(resumo + " Enviando ao armazenamento privado…");
        return E.arm.enviar(E.arm.REFERENCIAS, caminho, blob, { tipo: "application/pdf", substituir: true }).then(function () {
          aviso(resumo + " Criando o pedido…");
          return E.api.criarPedido({
            id: id, tipo: "importar", banca: banca, paginas: sel.texto, arquivo_original: f.name,
            tema: ("Importar PDF: " + f.name + " (p. " + sel.texto + ")").slice(0, 500),
            observacoes: nota, referencias_tecnicas: [caminho]
          });
        }).then(function (r) {
          pid = (r && r.id) || id;
          aviso(resumo + " Pedido criado. Enviando à IA…");
          return E.gerar("enviar", pid);
        }).then(function (g) {
          if (g.ok) aviso(resumo + " Pedido enviado à IA. A transcrição em lote leva de alguns minutos a 1 hora; acompanhe na aba “IA: gerar e importar” (botão “Verificar agora”). Cada estação encontrada vira um rascunho no estúdio.", "ok");
          else if (g.semChave) aviso(resumo + " Pedido guardado (aguardando envio). " + AVISO_SEM_CHAVE + " Depois de configurada, use “Enviar” na aba “IA: gerar e importar”.", "erro");
          else aviso(resumo + " Pedido guardado, mas o envio à IA falhou: " + g.mensagem + " Tente “Enviar” na aba “IA: gerar e importar”.", "erro");
          terminar();
        });
      }).catch(function (e) {
        ocupar(false);
        aviso((e && e.local ? e.message : "Não foi possível importar: " + ui.textoErro(e)), "erro");
      });
    }

    // o diálogo lê op.semEsc na hora do Esc: enquanto envia, Esc não fecha
    op.aoAbrir = function (dlg, fim) {
      st.fim = fim;
      var acoes = dlg.querySelector(".ed-dialogo-acoes");
      acoes.appendChild(btCancelar); acoes.appendChild(btVer); acoes.appendChild(btImportar);
    };
    var promessa = ui.dialogo("Importar PDF com IA", [cab, form, dica, estado], [], op);
    if (f.size > MAX_PDF_LOCAL) {
      nPag.textContent = "grande demais para ler no navegador";
      aviso("PDF acima de 300 MB: divida o arquivo antes de importar.", "erro");
    } else {
      (f.arrayBuffer ? f.arrayBuffer() : new Response(f).arrayBuffer()).then(abrirPdf).then(function (doc) {
        st.doc = doc; st.total = doc.getPageCount();
        nPag.textContent = st.total + " página(s)";
        inPag.disabled = false; btImportar.disabled = false;
        if (doc.isEncrypted) aviso("O PDF é protegido (criptografado): o recorte pode sair ilegível para a IA. Se possível, use uma cópia sem proteção.", "aviso");
        selecao();
        inPag.focus();
      }, function (e) {
        nPag.textContent = "não foi possível ler";
        aviso("Não foi possível ler o PDF: " + ((e && e.message) || e) + ".", "erro");
      });
    }
    return promessa;
  }

  function ligar() {
    ["es-importar", "es-importar-pasta"].forEach(function (id) {
      var inp = document.getElementById(id);
      if (!inp) return;
      inp.addEventListener("change", function () {
        var fs = Array.prototype.slice.call(this.files || []);
        inp.value = "";
        importar(fs, { pasta: id === "es-importar-pasta" });
      });
    });
  }
  E.importar = importar;
  E._importacao = {
    estacoesDoTexto: estacoesDoTexto, separar: separar, acharImagem: acharImagem,
    lerIntervalo: lerIntervalo, recortarPdf: recortarPdf, abrirPdf: abrirPdf, carregarPdfLib: carregarPdfLib, nomeRecorte: nomeRecorte
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligar); else ligar();
})();
