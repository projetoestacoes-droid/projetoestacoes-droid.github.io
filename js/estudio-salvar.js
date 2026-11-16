/* =====================================================================
 * estudio-salvar.js — window.SalvarEstacao do ESTÚDIO online.
 * Mesmo contrato de app/js/salvar.js (usado pelo editor.js), gravando no
 * banco do site em vez da pasta do projeto:
 *
 *   SalvarEstacao.salvar(entrada, {forcar, originalJSON}) → Promise<{caminho, backup, ...}>
 *       estudio_salvar(p_id, p_conteudo, p_versao_esperada = entrada.versao, p_forcar)
 *       versão diferente no servidor (e sem forçar) → erro code "CONFLITO"
 *       (o editor mostra o mesmo diálogo "Gravar mesmo assim…" do visualizador local)
 *   SalvarEstacao.prepararEdicao(entrada) → Promise<{preparado:true}>
 *   SalvarEstacao.baixar(entrada)         → baixa "estacao.js" (registrarEstacao(…))
 *   SalvarEstacao.serializar(dados)       → texto do arquivo .js
 *   SalvarEstacao.caminhoDe(entrada)      → "estúdio online · versão N"
 *   SalvarEstacao.textos.*                → textos próprios do estúdio (gancho opcional do editor.js)
 *
 * Toda gravação vira uma versão no histórico do servidor (estacoes_trabalho_versoes);
 * nada é apagado. O status do JSON (rascunho | em-revisao | aprovada) manda.
 * ===================================================================== */
(function () {
  "use strict";
  var E = window.Estudio;
  if (!E) return;

  function erro(code, msg, extra) {
    var e = new Error(msg); e.code = code;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }
  function z(n) { return (n < 10 ? "0" : "") + n; }
  function dataBR(d) { return z(d.getDate()) + "/" + z(d.getMonth() + 1) + "/" + d.getFullYear() + " " + z(d.getHours()) + ":" + z(d.getMinutes()); }

  function serializar(dados) {
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) throw erro("SEM_DADOS", "Não há dados de estação para salvar.");
    var json;
    try { json = JSON.stringify(dados, null, 2); } catch (e) { throw erro("SERIALIZACAO", "Não foi possível converter a estação em texto: " + e.message); }
    json = json.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029").replace(/<\/(script)/gi, "<\\/$1");
    return "// Exportado do estúdio online em " + dataBR(new Date()) + ".\nregistrarEstacao(" + json + ");\n";
  }
  function caminhoDe(entrada) {
    if (!entrada || !entrada.dados) throw erro("SEM_DADOS", "Nenhuma estação selecionada.");
    return "estúdio online · versão " + (entrada.versao != null ? entrada.versao : "?");
  }

  var salvando = false;
  function salvar(entrada, opcoes) {
    opcoes = opcoes || {};
    var forcar = !!opcoes.forcar;
    return Promise.resolve().then(function () {
      if (!entrada || !entrada.id || !entrada.dados) throw erro("SEM_DADOS", "Nenhuma estação do estúdio selecionada.");
      if (salvando) throw erro("GRAVACAO", "Já há uma gravação em andamento.");
      var dados = entrada.dados;
      if (typeof opcoes.originalJSON === "string" && JSON.stringify(dados) === opcoes.originalJSON && !forcar) {
        return { caminho: caminhoDe(entrada), backup: null, semMudancas: true, conferido: true, forcado: false };
      }
      // confere que o conteúdo é JSON puro (o servidor guarda jsonb)
      var copia;
      try { copia = JSON.parse(JSON.stringify(dados)); } catch (e) { throw erro("SERIALIZACAO", "Valor não serializável: " + e.message); }
      salvando = true;
      var anterior = entrada.versao;
      return E.api.salvar(entrada.id, copia, anterior, forcar, forcar ? "gravada por cima de outra versão (conflito)" : null).then(function (r) {
        salvando = false;
        if (r && r.sem_mudanca) return { caminho: caminhoDe(entrada), backup: null, semMudancas: true, conferido: true, forcado: forcar };
        var nova = r && r.versao != null ? r.versao : (anterior || 0) + 1;
        entrada.versao = nova;
        if (entrada.linha) {
          entrada.linha = Object.assign({}, entrada.linha, { versao: nova, status: dados.status, titulo: dados.titulo, banca: dados.banca, area: dados.area, dia: dados.dia, atualizado_em: new Date().toISOString() });
        }
        entrada.arquivo = "estúdio online · versão " + nova;
        if (window.App && window.App.montarLista) setTimeout(window.App.montarLista, 0);
        return { caminho: caminhoDe(entrada), backup: anterior != null ? "versão " + anterior : null, versao: nova, anterior: anterior, conferido: true, forcado: forcar };
      }, function (e) {
        salvando = false;
        if (e && e.code === "conflito_versao") throw erro("CONFLITO", "A estação foi alterada no servidor depois que você a abriu (versão " + anterior + ").", { causa: e });
        if (e && e.code === "rede") throw erro("GRAVACAO", "Sem conexão com o servidor. Nada foi gravado; as alterações continuam na tela.", { causa: e });
        throw erro("GRAVACAO", E.ui.textoErro(e), { causa: e });
      });
    });
  }

  function baixar(entrada) {
    if (!entrada || !entrada.dados) throw erro("SEM_DADOS", "Nenhuma estação selecionada.");
    var texto = serializar(entrada.dados);
    var url = URL.createObjectURL(new Blob([texto], { type: "text/javascript;charset=utf-8" }));
    var a = document.createElement("a");
    a.href = url; a.download = "estacao.js"; a.style.display = "none";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    return "estacao.js";
  }

  window.SalvarEstacao = {
    serializar: serializar,
    prepararEdicao: function () { return Promise.resolve({ preparado: true }); },
    salvar: salvar,
    baixar: baixar,
    caminhoDe: caminhoDe,
    textos: {
      destino: function (x) {
        return "Grava no estúdio online (banco do site). Aberta na versão " + (x && x.versao != null ? x.versao : "?") +
          "; cada gravação vira uma versão nova no histórico (nada é apagado). Para aprovar: Status › Aprovada › Salvar.";
      },
      salvo: function (res, x) {
        if (res && res.semMudancas) return "Sem mudanças em relação à versão " + (x && x.versao) + " do estúdio: nada foi gravado.";
        return "Salvo no estúdio online: versão " + (res && res.versao) + (res && res.anterior != null ? " (a versão " + res.anterior + " continua no histórico)" : "") + "." +
          (res && res.forcado ? " Gravado por cima da versão de outra pessoa; a dela também ficou no histórico." : "") +
          (x && x.dados && x.dados.status === "aprovada" ? " Status: aprovada — já pode ser publicada." : "");
      },
      conflito: function () { return "Outra pessoa (ou outra aba) salvou esta estação depois que você a abriu. Nada foi gravado."; },
      conflitoTitulo: function () { return "A estação mudou no servidor"; },
      conflitoTexto: function (x) {
        return "Alguém salvou uma versão mais nova que a versão " + (x && x.versao) + " que você abriu. Se gravar mesmo assim, a sua vira a mais recente e a outra continua no histórico (dá para ver e restaurar em “Histórico”). " +
          "Se preferir, cancele, baixe uma cópia (.js) e clique em “Recarregar” para ver a versão do servidor.";
      }
    }
  };
})();
