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
    var textos = [], imagens = [], ignorados = [];
    Array.prototype.slice.call(arquivos || []).forEach(function (f) {
      var c = caminhoDe(f);
      if (/(^|\/)versoes\//i.test(c) || /(^|\/)\./.test(c)) { ignorados.push(c); return; }
      if (/(^|\/)catalogo\.js$/i.test(c)) { ignorados.push(c); return; }
      if (/\.(js|json)$/i.test(f.name)) textos.push(f);
      else if (/\.(png|jpe?g|webp|gif)$/i.test(f.name)) imagens.push(f);
      else ignorados.push(c);
    });
    return { textos: textos, imagens: imagens, ignorados: ignorados };
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

  function importar(arquivos) {
    var App = window.App;
    var sep = separar(arquivos);
    if (!sep.textos.length) {
      if (sep.imagens.length && App && App.atual && App.atual()) {
        App.mensagem("Só imagens selecionadas: use “Imagens…” para enviá-las à estação aberta.", "erro");
      } else if (App) App.mensagem("Nenhum arquivo de estação (.js ou .json) na seleção.", "erro");
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

  function ligar() {
    ["es-importar", "es-importar-pasta"].forEach(function (id) {
      var inp = document.getElementById(id);
      if (!inp) return;
      inp.addEventListener("change", function () {
        var fs = Array.prototype.slice.call(this.files || []);
        inp.value = "";
        importar(fs);
      });
    });
  }
  E.importar = importar;
  E._importacao = { estacoesDoTexto: estacoesDoTexto, separar: separar, acharImagem: acharImagem };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligar); else ligar();
})();
