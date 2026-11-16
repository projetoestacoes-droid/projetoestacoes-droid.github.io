/* =====================================================================
 * aluno.js — Tela do ALUNO (celular).
 * meus_resultados() não recebe identificador: o servidor devolve só as linhas
 * do próprio aluno. Antes da liberação chegam só "Estação N" e a situação
 * (sem título, área, nota nem feedback). Depois: título, nota total, nota por
 * domínio e feedback. Nunca checklist, itens, critérios ou discussão.
 * ===================================================================== */
(function () {
  "use strict";
  var O = window.Online;
  if (!O) return;
  var el = O.el, limpar = O.limpar, fmt = O.fmt;

  function situacaoDe(x) {
    if (x.liberada) return ["Resultado liberado", "on-tag-ok"];
    if (x.situacao === "concluida") return ["Concluída · aguardando liberação", "on-tag-andamento"];
    return ["Pendente", ""];
  }

  function telaResultados(area) {
    area.appendChild(el("div", "on-cabeca", [el("h1", null, "Meus resultados"), el("p", "on-sutil", "A nota e o feedback aparecem aqui depois que a coordenação liberar.")]));
    var lista = el("div", "on-lista");
    area.appendChild(lista);
    lista.appendChild(el("p", "on-carregando", "Carregando…"));
    return O.rpc("meus_resultados").then(function (r) {
      limpar(lista);
      var itens = Array.isArray(r) ? r : [];
      if (!itens.length) { lista.appendChild(el("p", "on-vazio", "Você ainda não está inscrito em nenhuma sessão.")); return; }
      var sessaoAtual = null;
      itens.forEach(function (x) {
        var chaveSessao = (x.sessao || "") + "|" + (x.data || "");
        if (chaveSessao !== sessaoAtual) {
          sessaoAtual = chaveSessao;
          lista.appendChild(el("h2", "on-sessao-tit", [x.sessao || "Sessão", x.data ? " · " + O.fmtData(x.data) : ""]));
        }
        var st = situacaoDe(x);
        var c = el("article", "on-resultado" + (x.liberada ? " on-resultado-lib" : ""));
        var cab = el("div", "on-res-cab", [el("span", "on-ce-num", x.estacao || "Estação"), el("span", "on-tag " + st[1], st[0])]);
        c.appendChild(cab);
        if (x.liberada) {
          if (x.titulo) c.appendChild(el("h3", "on-res-titulo", x.titulo));
          if (x.area) c.appendChild(el("p", "on-sutil", x.area));
          var nota = el("div", "on-res-nota", [
            el("span", "on-res-nota-num", x.nota_total == null ? "–" : fmt(x.nota_total)),
            el("span", "on-res-nota-max", x.nota_maxima == null ? "" : " / " + fmt(x.nota_maxima))
          ]);
          c.appendChild(nota);
          var doms = Array.isArray(x.dominios) ? x.dominios : [];
          if (doms.length > 1) {
            var tab = el("table", "on-dominios");
            var tb = el("tbody");
            doms.forEach(function (d) {
              var pct = (d.maximo && d.nota != null) ? Math.max(0, Math.min(100, d.nota / d.maximo * 100)) : 0;
              var barra = el("span", "on-barra-dom"); var ench = el("span", "on-barra-dom-ench"); ench.style.width = pct + "%"; barra.appendChild(ench);
              tb.appendChild(el("tr", null, [el("th", null, d.dominio || ""), el("td", null, [d.nota == null ? "–" : fmt(d.nota), d.maximo != null ? " / " + fmt(d.maximo) : ""]), el("td", "on-dom-barra", barra)]));
            });
            tab.appendChild(tb);
            c.appendChild(el("h4", null, "Nota por domínio"));
            c.appendChild(tab);
          }
          if (x.feedback) {
            c.appendChild(el("h4", null, "Feedback do aplicador"));
            var fb = el("div", "on-res-feedback");
            String(x.feedback).split(/\n+/).forEach(function (par) { if (par.trim()) fb.appendChild(el("p", null, par.trim())); });
            c.appendChild(fb);
          }
        }
        lista.appendChild(c);
      });
    });
  }

  O.registrarTela("aluno", { titulo: "Meus resultados", montar: telaResultados });
})();
