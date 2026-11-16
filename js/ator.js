/* =====================================================================
 * ator.js — Tela do ATOR / ATRIZ (celular).
 * Minhas estações → roteiro de atuação.
 * O conteúdo chega de estacao_para_ator JÁ FILTRADO pelo servidor (lista branca):
 * sem checklist, critérios, orientações ao examinador, discussão nem notas.
 * Esta tela só desenha o que recebeu.
 * ===================================================================== */
(function () {
  "use strict";
  var O = window.Online;
  if (!O) return;
  var el = O.el, limpar = O.limpar;

  function telaMinhas(area, ctx) {
    area.appendChild(el("div", "on-cabeca", [el("h1", null, "Minhas estações"), el("p", "on-sutil", "Roteiros de atuação atribuídos a você.")]));
    var lista = el("div", "on-lista");
    area.appendChild(lista);
    lista.appendChild(el("p", "on-carregando", "Carregando…"));
    return O.rpc("minhas_estacoes").then(function (r) {
      limpar(lista);
      var minhas = (r || []).filter(function (x) { return x.papel === "ator"; });
      if (!minhas.length) { lista.appendChild(el("p", "on-vazio", "Nenhuma estação atribuída a você nas sessões abertas.")); return; }
      minhas.forEach(function (x) {
        var c = el("button", "on-cartao-estacao");
        c.type = "button";
        c.appendChild(el("span", "on-ce-num", x.estacao || ""));
        c.appendChild(el("span", "on-ce-titulo", x.titulo || ""));
        c.appendChild(el("span", "on-ce-meta", [x.area || "", x.area ? " · " : "", O.nomeBanca(x.banca)]));
        c.appendChild(el("span", "on-ce-meta", [x.sessao || "", x.data ? " · " + O.fmtData(x.data) : ""]));
        c.addEventListener("click", function () { ctx.nav.abrir(x.estacao || "Roteiro", function (a) { return telaRoteiro(a, x); }); });
        lista.appendChild(c);
      });
    });
  }

  function telaRoteiro(area, item) {
    var se = item.sessao_estacao_id;
    area.appendChild(el("p", "on-carregando", "Carregando roteiro…"));
    return Promise.all([
      O.rpc("estacao_para_ator", { p_sessao_estacao_id: se }),
      O.imagensDaEstacao(se)
    ]).then(function (r) {
      var c = (r[0] && r[0].conteudo) || r[0] || {};
      var imagens = r[1] || {};
      limpar(area);
      var raiz = el("article", "on-roteiro-ator");
      area.appendChild(raiz);

      /* título, área, banca */
      var cab = el("div");
      raiz.appendChild(cab);

      /* ficha rápida: banca, local, tempo, atores, cenário */
      var ficha = el("dl", "on-ficha");
      function linha(rot, val) { if (val == null || String(val).trim() === "") return; ficha.appendChild(el("dt", null, rot)); ficha.appendChild(el("dd", null, O.md(String(val)))); }
      linha("Banca", O.nomeBanca(c.banca));
      linha("Local", c.local && String(c.local).replace(/^(LOCAL|CEN[ÁA]RIO)\s*:\s*/i, ""));
      var rot = c.roteiro || {};
      var pad = (O.config.tempoPadraoMin || {})[c.banca];
      linha("Tempo", rot.tempo || (pad ? pad + " minutos (padrão da banca)" : null));
      linha("Atores", rot.atores);
      linha("Cenário", rot.cenario_descricao);
      if (ficha.firstChild) raiz.appendChild(ficha);

      /* orientações ao ator (falas em destaque) */
      var temOrient = c.orientacoes_ator && ((Array.isArray(c.orientacoes_ator) && c.orientacoes_ator.length) || (c.orientacoes_ator.blocos && c.orientacoes_ator.blocos.length));
      var secOr = el("section", "on-sec-ator");
      raiz.appendChild(secOr);
      if (!temOrient) secOr.appendChild(el("p", "on-aviso", "Esta estação não tem orientações ao ator."));
      var docOr = el("div");
      secOr.appendChild(docOr);

      /* O que o candidato recebe (filipetas em leitura) */
      var temFil = Array.isArray(c.filipetas) && c.filipetas.length;
      var secFil = el("section", "on-sec-ator on-sec-candidato");
      var docFil = el("div");
      if (temFil) {
        secFil.appendChild(el("h2", "on-h-candidato", "O que o candidato recebe"));
        secFil.appendChild(el("p", "on-sutil on-peq", "Só para você entender a cena. Não entregue nem leia para o candidato."));
        secFil.appendChild(docFil);
        raiz.appendChild(secFil);
      }
      return Promise.all([
        O.renderFluxo(cab, c, { secoes: ["abertura"] }),
        temOrient ? O.renderFluxo(docOr, c, { secoes: ["orientacoes_ator"], imagens: imagens }) : null,
        temFil ? O.renderFluxo(docFil, c, { secoes: ["filipetas"], imagens: imagens }) : null
      ]);
    });
  }

  O.registrarTela("ator", { titulo: "Minhas estações", montar: telaMinhas });
})();
