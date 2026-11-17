/* =====================================================================
 * previa.js — MODO PRÉVIA do Estúdio (index.html?previa=aplicador|ator|aluno).
 *
 * As TELAS REAIS de cada perfil (aplicador.js, ator.js, aluno.js), abertas
 * dentro de um iframe do Estúdio (mesma origem). O conteúdo vem do Estúdio:
 * window.parent.EstudioPrevia.obter(papel), que chama a RPC do servidor
 * estudio_previsualizar (filtro por perfil feito no SERVIDOR, só administrador).
 *
 * Aqui só há uma sessão, uma estação e alunos FICTÍCIOS, em memória. Nada é
 * enviado ao servidor e nada fica no aparelho: ao sair da página, as chaves do
 * usuário de prévia são apagadas do localStorage/sessionStorage.
 *
 * Este arquivo vai para a casca pública: não pode conter dado de estação.
 * ===================================================================== */
(function () {
  "use strict";
  var O = window.Online;
  var SE = 990000001;                     /* sessao_estacao_id fictício da prévia */
  var PUB = "previa";                     /* "publicação" fictícia (só para urlImagem) */
  var ALUNOS = [
    { aluno_id: "00000000-0000-4000-8000-00000000a001", nome: "Aluno(a) de exemplo 1", turma: "Turma de prévia" },
    { aluno_id: "00000000-0000-4000-8000-00000000a002", nome: "Aluno(a) de exemplo 2", turma: "Turma de prévia" },
    { aluno_id: "00000000-0000-4000-8000-00000000a003", nome: "Aluno(a) de exemplo 3", turma: "Turma de prévia" }
  ];
  var papel = null, dados = null;
  var avaliacoes = {};                    /* aluno_id -> avaliação em memória */
  var revExistia = true;

  function erro(code) { var e = new Error(code); e.code = code; return e; }
  function copia(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function hoje() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function euId() { return "previa-" + papel; }

  /* ----- limpeza: tudo o que as telas gravam no aparelho em nome do usuário de prévia ----- */
  function limpar() {
    var pre = ["estacoes-fila:previa-", "estacoes-copia:previa-", "estacoes-espelho:previa-", "estacoes-crono:" + SE + ":"];
    [window.localStorage, window.sessionStorage].forEach(function (st) {
      try {
        var lixo = [];
        for (var i = 0; i < st.length; i++) {
          var k = st.key(i);
          if (k && pre.some(function (p) { return k.indexOf(p) === 0; })) lixo.push(k);
        }
        lixo.forEach(function (k) { st.removeItem(k); });
      } catch (e) { /* sem armazenamento */ }
    });
    if (!revExistia) { try { localStorage.removeItem("estacoes-rev"); } catch (e) { /* nada */ } }
  }

  function conteudo() { return (dados.resposta && dados.resposta.conteudo) || {}; }
  function regras() { return (dados.resposta && dados.resposta.pontuacao) || null; }

  /* ----- nota (estimativa local, a mesma do total parcial; a oficial é do servidor) ----- */
  function nota(itens, soft) {
    var n = O.nota.calcular(conteudo(), { itens: itens || {}, soft: soft || {} }, regras());
    return {
      total: { nota: n.semMarca ? null : n.total, maximo: n.maximo },
      dominios: n.dominios.map(function (d) { return { dominio: d.dominio, nota: d.nota, maximo: d.maximo }; }),
      itens_sem_marcacao: n.semMarca
    };
  }

  /* ----- RPCs imitadas (mesmo formato das reais; só o que as telas de perfil chamam) ----- */
  var R = {};
  R.eu = function () { return { id: euId(), nome: "Prévia do Estúdio", perfil: papel, email: null, turma: null }; };
  R.minhas_estacoes = function () {
    if (papel !== "aplicador" && papel !== "ator") return [];
    var c = conteudo(), r = dados.resposta || {};
    return [{
      sessao_estacao_id: SE, papel: papel, sessao_id: SE, sessao: "Sessão de prévia", data: hoje(), turma: "Turma de prévia",
      situacao_sessao: "aberta", ordem: 1, estacao: r.estacao || "Estação N",
      titulo: dados.titulo || c.titulo || "", area: dados.area || c.area || "", banca: dados.banca || c.banca || "",
      tempo: (c.roteiro && c.roteiro.tempo) || null, tempo_minutos: typeof r.tempo_minutos === "number" ? r.tempo_minutos : null,
      tem_roteiro_ator: !!(c.orientacoes_ator && typeof c.orientacoes_ator === "object" && !Array.isArray(c.orientacoes_ator)),
      inscritos: papel === "aplicador" ? ALUNOS.length : null,
      avaliadas: papel === "aplicador" ? Object.keys(avaliacoes).filter(function (k) { return avaliacoes[k].situacao !== "rascunho"; }).length : null
    }];
  };
  function exigirSe(a, quem) {
    if (papel !== quem || Number(a.p_sessao_estacao_id) !== SE) throw erro("sem_permissao");
  }
  R.estacao_para_ator = function (a) { exigirSe(a, "ator"); return copia(dados.resposta); };
  R.estacao_para_aplicador = function (a) { exigirSe(a, "aplicador"); return copia(dados.resposta); };
  R.imagens_permitidas = function (a) {
    if (Number(a.p_sessao_estacao_id) !== SE) return [];
    return Object.keys(dados.imagens || {}).map(function (k) { return PUB + "/" + k; });
  };
  R.alunos_da_estacao = function (a) {
    exigirSe(a, "aplicador");
    return ALUNOS.map(function (x) {
      var av = avaliacoes[x.aluno_id];
      return { aluno_id: x.aluno_id, nome: x.nome, turma: x.turma, situacao: av ? av.situacao : "nao_iniciada" };
    });
  };
  R.minha_avaliacao = function (a) {
    if (papel !== "aplicador" || Number(a.p_sessao_estacao_id) !== SE) return null;
    var av = avaliacoes[a.p_aluno_id];
    return av ? copia(av) : null;
  };
  R.salvar_avaliacao = function (a) {
    exigirSe(a, "aplicador");
    if (!ALUNOS.some(function (x) { return x.aluno_id === a.p_aluno_id; })) throw erro("aluno_nao_inscrito");
    var rev = Number(a.p_cliente_rev);
    if (!rev || rev <= 0) throw erro("rev_invalida");
    var av = avaliacoes[a.p_aluno_id];
    if (!av) {
      av = avaliacoes[a.p_aluno_id] = { id: "previa-av-" + a.p_aluno_id.slice(-4), itens: {}, soft: {}, feedback: null,
                                        situacao: "rascunho", rev_cliente: 0, nota_total: null, nota_detalhe: null };
    }
    var status = "salvo", recusa = null;
    if (av.situacao !== "rascunho") {
      if (a.p_finalizar && rev <= av.rev_cliente) status = "ja_aplicado";
      else throw erro("avaliacao_travada");
    } else if (rev <= av.rev_cliente) {
      status = "ignorado_antigo";
    } else {
      av.itens = copia(a.p_itens || {}); av.soft = copia(a.p_soft || {}); av.feedback = a.p_feedback || ""; av.rev_cliente = rev;
      av.nota_detalhe = nota(av.itens, av.soft); av.nota_total = av.nota_detalhe.total.nota;
      if (a.p_finalizar) {
        if (!String(av.feedback).trim()) recusa = "feedback_obrigatorio";
        else if (av.nota_detalhe.itens_sem_marcacao > 0) recusa = "itens_sem_marcacao";
        else av.situacao = "finalizada";
      }
    }
    return { status: status, recusa_finalizacao: recusa, id: av.id, situacao: av.situacao, rev_cliente: av.rev_cliente,
             nota_total: av.nota_total, nota_detalhe: copia(av.nota_detalhe) };
  };
  R.meus_resultados = function () {
    if (papel !== "aluno") return [];
    var r = dados.resposta || {};
    var base = { sessao_id: SE, data: hoje(), ordem: 1 };
    return [
      Object.assign({}, r.antes || {}, base, { sessao: "Prévia · antes da liberação" }),
      Object.assign({}, r.depois || {}, base, { sessao: "Prévia · depois da liberação (exemplo, sem nota real)" })
    ];
  };

  window.Previa = {
    /* o Estúdio chama antes de remover o iframe (o pagehide de iframe removido não é garantido) */
    limpar: function () { limpar(); },
    iniciar: function (p) {
      papel = p;
      try { revExistia = localStorage.getItem("estacoes-rev") != null; } catch (e) { revExistia = true; }
      limpar();                                   /* restos de uma prévia anterior que não saiu direito */
      window.addEventListener("pagehide", limpar);
      /* Esc com o foco dentro da prévia fecha a janela do Estúdio */
      document.addEventListener("keydown", function (ev) {
        if (ev.key !== "Escape") return;
        try { if (window.parent.EstudioPrevia && window.parent.EstudioPrevia.fechar) { ev.preventDefault(); window.parent.EstudioPrevia.fechar(); } } catch (x) { /* nada */ }
      });
      return Promise.resolve().then(function () {
        return window.parent.EstudioPrevia.obter(p);
      }).then(function (d) {
        if (!d || typeof d !== "object" || !d.resposta || typeof d.resposta !== "object") throw new Error("o Estúdio não devolveu o conteúdo da prévia");
        if (p === "aluno" ? !d.resposta.depois : !d.resposta.conteudo) throw new Error("resposta da prévia em formato inesperado para o perfil " + p);
        dados = d;
      });
    },
    rpc: function (nome, args) {
      if (!dados) return Promise.reject(erro("previa_nao_iniciada"));
      var f = R[nome];
      if (!f) return Promise.reject(erro("indisponivel_na_previa"));
      try { return Promise.resolve(f(args || {})); } catch (e) { return Promise.reject(e); }
    },
    imagensDaEstacao: function (se) {
      if (!dados || Number(se) !== SE) return Promise.resolve({});
      return Promise.resolve(Object.assign({}, dados.imagens || {}));
    },
    urlImagem: function (pub, arquivo) {
      var u = dados && dados.imagens && dados.imagens[String(arquivo).replace(/^\/+/, "")];
      return u ? Promise.resolve(u) : Promise.reject(erro("imagem_indisponivel"));
    }
  };
})();
