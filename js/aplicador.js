/* =====================================================================
 * aplicador.js — Tela do APLICADOR (examinador), pensada para tablet.
 *
 * Fluxo: Minhas estações → escolher aluno (busca) → aplicação
 *   cronômetro · checklist clicável na escala da banca · soft skills (5 níveis)
 *   · total parcial (estimativa local) · feedback obrigatório · Finalizar (trava)
 *   Painéis: "Material da estação" e "Discussão (apoio ao feedback)" (recolhido).
 *
 * Robustez: cada toque grava o ESTADO COMPLETO na fila do aparelho
 * (localStorage, síncrono, + espelho em IndexedDB) e tenta enviar por
 * salvar_avaliacao com um carimbo de versão (rev) sempre crescente. O item só
 * sai da fila quando o servidor confirma rev >= o local. Reenvio é inofensivo.
 * A nota exibida aqui é ESTIMATIVA; a oficial é recalculada no servidor.
 * ===================================================================== */
(function () {
  "use strict";
  var O = window.Online;
  if (!O) return;
  var el = O.el, botao = O.botao, fmt = O.fmt, limpar = O.limpar;

  var SITUACAO = {
    nao_iniciada: ["Não iniciada", ""], rascunho: ["Em andamento", "on-tag-andamento"],
    finalizada: ["Finalizada", "on-tag-ok"], liberada: ["Finalizada · liberada", "on-tag-ok"],
    em_andamento_outro_aplicador: ["Com outro aplicador", "on-tag-outro"],
    concluida_outro_aplicador: ["Concluída por outro aplicador", "on-tag-outro"],
    fila: ["Aguardando envio", "on-tag-fila"]
  };

  /* ==================================================================
   * Fila offline (por usuário e por avaliação; guarda só o último estado)
   * ================================================================== */
  var Fila = (function () {
    var PREF = "estacoes-fila:";
    var ouvintes = [];
    var enviando = false, temporizador = null, intervalo = null;
    var idb = null;
    function euId() { var e = O.eu(); return e ? e.id : "anon"; }
    function chave(se, aluno) { return PREF + euId() + ":" + se + ":" + aluno; }
    function abrirIdb() {
      /* na prévia do Estúdio nada vai para o IndexedDB (ele é do site inteiro, não da aba) */
      if (idb || !window.indexedDB || O.previa) return Promise.resolve(idb);
      return new Promise(function (ok) {
        try {
          var r = indexedDB.open("estacoes-online", 1);
          r.onupgradeneeded = function () { r.result.createObjectStore("fila"); };
          r.onsuccess = function () { idb = r.result; ok(idb); };
          r.onerror = function () { ok(null); };
        } catch (e) { ok(null); }
      });
    }
    function idbOp(modo, fn) {
      return abrirIdb().then(function (db) {
        if (!db) return null;
        return new Promise(function (ok) {
          try {
            var tx = db.transaction("fila", modo);
            var req = fn(tx.objectStore("fila"));
            tx.oncomplete = function () { ok(req && req.result); };
            tx.onerror = function () { ok(null); };
          } catch (e) { ok(null); }
        });
      });
    }
    function ler(se, aluno) {
      try { var s = localStorage.getItem(chave(se, aluno)); return s ? JSON.parse(s) : null; } catch (e) { return null; }
    }
    function gravar(reg) {
      var k = chave(reg.se, reg.aluno);
      try { localStorage.setItem(k, JSON.stringify(reg)); } catch (e) { console.warn("localStorage:", e); }
      idbOp("readwrite", function (st) { return st.put(reg, k); });
      avisar();
      agendar(350);
    }
    function remover(reg) {
      var k = chave(reg.se, reg.aluno);
      var atual = ler(reg.se, reg.aluno);
      if (atual && atual.rev > reg.rev) return;              /* chegou toque mais novo: fica */
      try { localStorage.removeItem(k); } catch (e) { /* nada */ }
      idbOp("readwrite", function (st) { return st.delete(k); });
    }
    function pendentes() {
      var pre = PREF + euId() + ":", out = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(pre) === 0) { try { out.push(JSON.parse(localStorage.getItem(k))); } catch (e) { /* ignora */ } }
        }
      } catch (e) { /* sem localStorage */ }
      return out.filter(Boolean);
    }
    /* recupera do IndexedDB o que não estiver no localStorage (ex.: armazenamento limpo pela metade) */
    function recuperar() {
      return idbOp("readonly", function (st) { return st.getAll ? st.getAll() : null; }).then(function (lista) {
        (lista || []).forEach(function (reg) {
          if (!reg || !reg.se) return;
          var loc = ler(reg.se, reg.aluno);
          if (!loc || loc.rev < reg.rev) { try { localStorage.setItem(chave(reg.se, reg.aluno), JSON.stringify(reg)); } catch (e) { /* nada */ } }
        });
      });
    }
    var ultimoErro = {};
    function enviarUm(reg) {
      return O.rpc("salvar_avaliacao", argumentos(reg)).then(function (r) {
        r = r || {};
        var ok = r.status === "ignorado_antigo" || r.status === "ja_aplicado" || (r.rev_cliente != null && Number(r.rev_cliente) >= reg.rev);
        if (ok || r.status === "salvo") remover(reg);
        delete ultimoErro[reg.se + ":" + reg.aluno];
        avisar({ tipo: "resposta", reg: reg, resposta: r });
        return r;
      }, function (e) {
        if (e.code === "avaliacao_travada") {
          remover(reg);
          avisar({ tipo: "travada", reg: reg });
          return null;
        }
        if (e.code !== "rede") {
          ultimoErro[reg.se + ":" + reg.aluno] = e;
          avisar({ tipo: "erro", reg: reg, erro: e });
        }
        throw e;
      });
    }
    function processar() {
      if (enviando) return Promise.resolve();
      var lista = pendentes();
      if (!lista.length) { avisar(); return Promise.resolve(); }
      if (!O.estaOnline()) { avisar(); return Promise.resolve(); }
      enviando = true; avisar();
      var cadeia = Promise.resolve(), parar = false;
      lista.sort(function (a, b) { return a.rev - b.rev; }).forEach(function (reg) {
        cadeia = cadeia.then(function () {
          if (parar) return;
          var atual = ler(reg.se, reg.aluno);
          if (!atual) return;
          return enviarUm(atual).catch(function (e) { if (e.code === "rede") parar = true; });
        });
      });
      return cadeia.then(function () { enviando = false; avisar(); if (pendentes().length && O.estaOnline() && !parar) agendar(2000); },
                         function () { enviando = false; avisar(); });
    }
    function agendar(ms) { clearTimeout(temporizador); temporizador = setTimeout(processar, ms); }
    function avisar(ev) { var st = situacao(); ouvintes.forEach(function (fn) { try { fn(st, ev); } catch (e) { console.error(e); } }); }
    function situacao() {
      var p = pendentes();
      return { pendentes: p.length, enviando: enviando, online: O.estaOnline(), erros: ultimoErro };
    }
    function iniciar() {
      if (intervalo) return;
      recuperar().then(function () { processar(); });
      intervalo = setInterval(processar, 10000);
      O.aoMudarRede(function (on) { if (on) processar(); else avisar(); });
      document.addEventListener("visibilitychange", function () { if (!document.hidden) processar(); });
      if (navigator.storage && navigator.storage.persist) { try { navigator.storage.persist(); } catch (e) { /* opcional */ } }
      O.antesDeSair(function () { return pendentes().length; });
    }
    return { ler: ler, gravar: gravar, pendentes: pendentes, processar: processar, iniciar: iniciar,
             ouvir: function (fn) { ouvintes.push(fn); return function () { ouvintes = ouvintes.filter(function (f) { return f !== fn; }); }; },
             situacao: situacao };
  })();

  /* carimbo de versão: sempre crescente neste aparelho (cabe com folga em bigint e em Number) */
  function novoRev() {
    var ult = 0;
    try { ult = Number(localStorage.getItem("estacoes-rev")) || 0; } catch (e) { /* nada */ }
    var r = Math.max(Date.now() * 1000, ult + 1);
    try { localStorage.setItem("estacoes-rev", String(r)); } catch (e) { /* nada */ }
    return r;
  }
  function dispositivo() { return (navigator.userAgent || "").slice(0, 90); }

  /* ----- Formato enviado ao servidor (online/supabase/migracoes/001: privado.calcular_nota) -----
     itens: {"g.i": "sim" | "nao" | "parcial" | <pontos>}   (número = crédito parcial D5; o servidor limita)
     soft : {"k": <nível 0..4>}                             (D4; os pontos do nível vêm do servidor) */
  function codificarItens(itens) {
    var out = {};
    Object.keys(itens || {}).forEach(function (k) {
      var m = itens[k];
      if (m === "sim" || m === "nao" || m === "parcial") out[k] = m;
      else if (m && typeof m === "object" && typeof m.pontos === "number") out[k] = m.pontos;
    });
    return out;
  }
  function codificarSoft(soft) {
    var out = {};
    Object.keys(soft || {}).forEach(function (k) { var s = soft[k]; if (s && typeof s.nivel === "number" && s.nivel >= 0) out[k] = s.nivel; });
    return out;
  }
  function argumentos(reg) {
    return {
      p_sessao_estacao_id: reg.se, p_aluno_id: reg.aluno,
      p_itens: codificarItens(reg.itens), p_soft: codificarSoft(reg.soft),
      p_feedback: reg.feedback || "", p_cliente_rev: reg.rev,
      p_dispositivo: dispositivo(), p_finalizar: !!reg.finalizar
    };
  }
  function decodificarItens(v) {
    var out = {};
    Object.keys(v || {}).forEach(function (k) {
      var m = v[k];
      if (m === "sim" || m === "nao" || m === "parcial") out[k] = m;
      else if (typeof m === "number") out[k] = { pontos: m };
    });
    return out;
  }
  function decodificarSoft(v, conteudo, regras) {
    var out = {}, doms = O.nota.dominiosSoft(conteudo, regras);
    Object.keys(v || {}).forEach(function (k) {
      var nivel = v[k];
      if (typeof nivel !== "number") return;
      var d = doms.filter(function (dd) { return String(dd.k) === String(k); })[0];
      out[k] = { nivel: nivel, pontos: d && d.valor != null ? O.nota.pontosDosNiveis(d.valor, d)[nivel] : null };
    });
    return out;
  }

  /* ==================================================================
   * Cache do conteúdo (só em memória: nada do material fica gravado no aparelho)
   * ================================================================== */
  var cache = {};
  /* Sem conexão, as listas e o material da estação vêm da cópia da ABA (sessionStorage:
     some ao fechar a aba). Assim o aplicador continua a avaliação se a página recarregar
     sem internet. Nada vai para o localStorage além da fila de avaliações. */
  function rpcComCopia(nome, args) {
    var e = O.eu();
    var k = "estacoes-copia:" + (e ? e.id : "") + ":" + nome + ":" + JSON.stringify(args || {});
    return O.rpc(nome, args).then(function (r) {
      try { sessionStorage.setItem(k, JSON.stringify(r)); } catch (x) { /* cheio: segue sem cópia */ }
      return r;
    }, function (err) {
      if (err.code !== "rede") throw err;
      var c = null;
      try { c = JSON.parse(sessionStorage.getItem(k) || "null"); } catch (x) { /* nada */ }
      if (c == null) throw err;
      return c;
    });
  }
  function carregarEstacao(se) {
    var c = cache[se];
    if (c && Date.now() - c.em < 10 * 60 * 1000) return Promise.resolve(c);
    return rpcComCopia("estacao_para_aplicador", { p_sessao_estacao_id: se }).then(function (r) {
      var reg = { em: Date.now(), dados: r, conteudo: (r && r.conteudo) || r, imagens: null,
                  regras: (r && r.pontuacao) || null, tempoMin: r && typeof r.tempo_minutos === "number" ? r.tempo_minutos : null };
      cache[se] = reg;
      return O.imagensDaEstacao(se).then(function (m) { reg.imagens = m || {}; return reg; });
    });
  }

  /* ==================================================================
   * 1. Minhas estações
   * ================================================================== */
  function telaMinhas(area, ctx) {
    Fila.iniciar();
    var topo = el("div", "on-cabeca", [el("h1", null, "Minhas estações"), el("p", "on-sutil", "Estações atribuídas a você nas sessões abertas.")]);
    area.appendChild(topo);
    var faixa = el("div", "on-faixa-fila"); faixa.hidden = true;
    area.appendChild(faixa);
    var desligar = Fila.ouvir(function (st) {
      limpar(faixa);
      faixa.hidden = !st.pendentes;
      if (st.pendentes) {
        faixa.appendChild(el("span", null, st.pendentes + " avaliação(ões) guardada(s) neste aparelho " + (st.online ? "sendo enviadas…" : "aguardando conexão.")));
        faixa.appendChild(botao("Enviar agora", "on-btn-sec on-btn-peq", function () { Fila.processar(); }));
      }
    });
    ctx.nav.aoSair(desligar);
    Fila.processar();
    var lista = el("div", "on-lista");
    area.appendChild(lista);
    lista.appendChild(el("p", "on-carregando", "Carregando…"));
    return rpcComCopia("minhas_estacoes").then(function (r) {
      limpar(lista);
      var minhas = (r || []).filter(function (x) { return x.papel === "aplicador"; });
      if (!minhas.length) { lista.appendChild(el("p", "on-vazio", "Nenhuma estação atribuída a você como aplicador(a) nas sessões abertas.")); return; }
      minhas.forEach(function (x) {
        var c = el("button", "on-cartao-estacao");
        c.type = "button";
        c.appendChild(el("span", "on-ce-num", x.estacao || ""));
        c.appendChild(el("span", "on-ce-titulo", x.titulo || ""));
        c.appendChild(el("span", "on-ce-meta", [x.area || "", x.area ? " · " : "", O.nomeBanca(x.banca)]));
        c.appendChild(el("span", "on-ce-meta", [x.sessao || "", x.data ? " · " + O.fmtData(x.data) : "", x.turma ? " · " + x.turma : ""]));
        if (x.inscritos != null) c.appendChild(el("span", "on-ce-prog", "Avaliados: " + (x.avaliadas || 0) + " de " + x.inscritos));
        c.addEventListener("click", function () { ctx.nav.abrir(x.estacao || "Estação", function (a, cx) { return telaEstacao(a, cx, x); }); });
        lista.appendChild(c);
      });
    });
  }

  /* ==================================================================
   * 2. Estação: escolher o aluno (e acesso ao material)
   * ================================================================== */
  function telaEstacao(area, ctx, item) {
    var se = item.sessao_estacao_id;
    area.appendChild(el("div", "on-cabeca", [
      el("p", "on-ce-num", item.estacao || ""), el("h1", null, item.titulo || ""),
      el("p", "on-sutil", [item.area || "", " · ", O.nomeBanca(item.banca), item.sessao ? " · " + item.sessao : ""])
    ]));
    var acoes = el("div", "on-linha");
    acoes.appendChild(botao("Material da estação", "on-btn-sec", function () {
      ctx.nav.abrir("Material · " + (item.estacao || ""), function (a) { return telaMaterial(a, se); });
    }));
    area.appendChild(acoes);
    var busca = el("input", "on-campo on-busca");
    busca.type = "search"; busca.placeholder = "Buscar aluno pelo nome"; busca.setAttribute("aria-label", "Buscar aluno pelo nome");
    area.appendChild(busca);
    var lista = el("div", "on-lista-alunos");
    area.appendChild(lista);
    lista.appendChild(el("p", "on-carregando", "Carregando alunos…"));
    var alunos = [];
    function desenhar() {
      limpar(lista);
      var q = busca.value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      var vis = alunos.filter(function (a) { return !q || String(a.nome || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").indexOf(q) >= 0; });
      if (!vis.length) { lista.appendChild(el("p", "on-vazio", alunos.length ? "Nenhum aluno com esse nome." : "Nenhum aluno inscrito nesta sessão.")); return; }
      vis.forEach(function (a) {
        var local = Fila.ler(se, a.aluno_id);
        var sit = local ? (local.finalizar ? "fila" : "rascunho") : (a.situacao || "nao_iniciada");
        var rot = SITUACAO[sit] || [sit, ""];
        var outro = /outro_aplicador/.test(a.situacao || "");
        var b = el("button", "on-aluno" + (outro ? " on-aluno-bloq" : ""));
        b.type = "button";
        b.appendChild(el("span", "on-aluno-nome", a.nome || ""));
        if (a.turma) b.appendChild(el("span", "on-aluno-turma", a.turma));
        b.appendChild(el("span", "on-tag " + rot[1], local && !local.finalizar ? "Em andamento · aguardando envio" : rot[0]));
        b.disabled = outro;
        b.addEventListener("click", function () {
          ctx.nav.abrir(a.nome || "Avaliação", function (ar, cx) { return telaAvaliacao(ar, cx, item, a); });
        });
        lista.appendChild(b);
      });
    }
    busca.addEventListener("input", desenhar);
    Fila.processar();
    return Promise.all([rpcComCopia("alunos_da_estacao", { p_sessao_estacao_id: se }), carregarEstacao(se).catch(function () { return null; })]).then(function (r) {
      alunos = r[0] || [];
      desenhar();
      busca.focus();
    });
  }

  /* ==================================================================
   * Material da estação e Discussão (painéis)
   * ================================================================== */
  function textoDeBloco(b) {
    if (b == null) return [];
    if (typeof b === "string") return [b];
    if (b.tipo === "lista") return (b.itens || []).map(function (x) { return typeof x === "string" ? x : (x && x.texto) || ""; });
    return [b.texto || ""];
  }
  /* "Momento de entrega": rótulo de cada filipeta + as orientações ao examinador que falam dela */
  function caixaEntrega(c) {
    var fs = Array.isArray(c.filipetas) ? c.filipetas : [];
    var orient = [];
    (c.orientacoes_examinador || []).forEach(function (b) { orient = orient.concat(textoDeBloco(b)); });
    if (!fs.length) return null;
    var box = el("div", "on-entrega");
    box.appendChild(el("h3", null, "Filipetas: momento de entrega"));
    var ul = el("ul");
    fs.forEach(function (f, i) {
      var n = i + 1;
      var rot = (f && f.rotulo) ? String(f.rotulo) : "FILIPETA " + n;
      var re = new RegExp("filipeta\\s*0?" + n + "\\b", "i");
      var quando = orient.filter(function (t) { return re.test(t); });
      if (!quando.length && i === 0) quando = ["Entregue ao candidato no início da estação (não há outra instrução nas orientações)."];
      var li = el("li", null, [el("b", null, O.md(rot.replace(/\*\*/g, "")))]);
      if (quando.length) { var sub = el("ul"); quando.forEach(function (q) { sub.appendChild(el("li", null, O.md(q))); }); li.appendChild(sub); }
      else li.appendChild(el("div", "on-sutil", "Momento de entrega não descrito nas orientações ao examinador."));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    return box;
  }
  function secoesMaterial(c) {
    var s = ["abertura", "orientacoes_estacao", "objetivos", "criterios", "roteiro", "local"];
    if (c.orientacoes_antes_das_filipetas) s.push("orientacoes_examinador", "orientacoes_ator", "filipetas", "apos_filipetas");
    else s.push("filipetas", "apos_filipetas", "orientacoes_examinador", "orientacoes_ator");
    return s;
  }
  function montarMaterial(alvo, reg) {
    var c = reg.conteudo || {};
    var ent = caixaEntrega(c);
    if (ent) alvo.appendChild(ent);
    var doc = el("div");
    alvo.appendChild(doc);
    return O.renderFluxo(doc, c, { secoes: secoesMaterial(c), imagens: reg.imagens || {} });
  }
  function temDiscussao(c) {
    return !!(c.discussao_tecnica || (c.discussao_banca && c.discussao_banca.length) || (c.sugestoes_frases && c.sugestoes_frases.length) || (c.soft_skills && c.soft_skills.blocos && c.soft_skills.blocos.length));
  }
  function montarDiscussao(alvo, reg) {
    var c = reg.conteudo || {};
    if (!temDiscussao(c)) { alvo.appendChild(el("p", "on-vazio", "Esta estação não tem discussão.")); return Promise.resolve(); }
    var doc = el("div"); alvo.appendChild(doc);
    return O.renderFluxo(doc, c, { secoes: ["discussao", "soft_skills_blocos", "sugestoes"], imagens: reg.imagens || {} });
  }
  function painel(titulo, aberto, montar) {
    var d = el("details", "on-painel");
    d.open = !!aberto;
    d.appendChild(el("summary", null, titulo));
    var corpo = el("div", "on-painel-corpo");
    d.appendChild(corpo);
    var feito = false;
    function garantir() { if (!feito && d.open) { feito = true; montar(corpo); } }
    d.addEventListener("toggle", garantir);
    garantir();
    return d;
  }
  function telaMaterial(area, se) {
    area.appendChild(el("p", "on-carregando", "Carregando material…"));
    return carregarEstacao(se).then(function (reg) {
      limpar(area);
      area.appendChild(painel("Material da estação", true, function (c) { montarMaterial(c, reg); }));
      area.appendChild(painel("Discussão (apoio ao feedback)", false, function (c) { montarDiscussao(c, reg); }));
    });
  }

  /* ==================================================================
   * Cronômetro (aviso visual e sonoro com 1 minuto)
   * ================================================================== */
  function minutosDaEstacao(c) {
    var t = c && c.roteiro && c.roteiro.tempo;
    var m = t && String(t).match(/(\d+(?:[.,]\d+)?)\s*min/i);
    if (m) return Number(m[1].replace(",", "."));
    var pad = (O.config.tempoPadraoMin || {})[c && c.banca];
    return pad || 8;
  }
  var audio = null;
  function bip(longo) {
    try {
      if (!audio) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; audio = new AC(); }
      if (audio.state === "suspended") audio.resume();
      var vezes = longo ? 3 : 2;
      for (var i = 0; i < vezes; i++) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.type = "sine"; o.frequency.value = longo ? 660 : 880;
        var t0 = audio.currentTime + i * 0.35;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
        o.connect(g); g.connect(audio.destination); o.start(t0); o.stop(t0 + 0.3);
      }
      if (navigator.vibrate) navigator.vibrate(longo ? [300, 150, 300, 150, 300] : [200, 100, 200]);
    } catch (e) { /* sem som */ }
  }
  function Cronometro(chaveLocal, minutos) {
    var total = Math.round(minutos * 60 * 1000);
    var st = { fim: null, restante: total, avisou1: false, avisou0: false };
    try { var s = JSON.parse(localStorage.getItem(chaveLocal) || "null"); if (s && s.total === total) st = s; } catch (e) { /* nada */ }
    st.total = total;
    var raiz = el("div", "on-crono");
    var visor = el("span", "on-crono-visor");
    visor.setAttribute("role", "timer"); visor.setAttribute("aria-live", "off");
    var bIni = botao("Iniciar", "on-btn-pri on-btn-peq");
    var bZerar = botao("Zerar", "on-btn-sec on-btn-peq");
    raiz.appendChild(visor); raiz.appendChild(bIni); raiz.appendChild(bZerar);
    var trava = null;
    function guardar() { try { localStorage.setItem(chaveLocal, JSON.stringify(st)); } catch (e) { /* nada */ } }
    function restante() { return st.fim ? st.fim - Date.now() : st.restante; }
    function pedirTela() { if (navigator.wakeLock && !trava) navigator.wakeLock.request("screen").then(function (t) { trava = t; }, function () { /* opcional */ }); }
    function soltarTela() { if (trava) { try { trava.release(); } catch (e) { /* nada */ } trava = null; } }
    function tique() {
      var r = restante();
      var seg = Math.max(0, Math.ceil(r / 1000));
      visor.textContent = (seg <= 0 ? "Tempo esgotado · " : "") + String(Math.floor(seg / 60)).padStart(2, "0") + ":" + String(seg % 60).padStart(2, "0");
      raiz.classList.toggle("on-crono-aviso", r <= 60000 && r > 0);
      raiz.classList.toggle("on-crono-fim", r <= 0);
      raiz.classList.toggle("on-crono-rodando", !!st.fim);
      bIni.textContent = st.fim ? "Pausar" : (r < total ? "Retomar" : "Iniciar");
      if (st.fim && r <= 60000 && !st.avisou1 && r > 0) { st.avisou1 = true; guardar(); bip(false); O.toast("Falta 1 minuto.", "aviso"); }
      if (st.fim && r <= 0 && !st.avisou0) { st.avisou0 = true; st.restante = 0; st.fim = null; guardar(); bip(true); soltarTela(); O.toast("Tempo da estação esgotado.", "aviso"); }
    }
    bIni.addEventListener("click", function () {
      bip.desbloqueio = true;
      try { if (!audio) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) audio = new AC(); } if (audio && audio.state === "suspended") audio.resume(); } catch (e) { /* nada */ }
      if (st.fim) { st.restante = restante(); st.fim = null; soltarTela(); }
      else if (restante() > 0) { st.fim = Date.now() + restante(); pedirTela(); }
      guardar(); tique();
    });
    bZerar.addEventListener("click", function () {
      var faz = function () { st = { fim: null, restante: total, avisou1: false, avisou0: false, total: total }; guardar(); soltarTela(); tique(); };
      if (st.fim) O.confirmar("Zerar o cronômetro em andamento?", { ok: "Zerar" }).then(function (ok) { if (ok) faz(); });
      else faz();
    });
    var h = setInterval(tique, 250);
    tique();
    return { raiz: raiz, parar: function () { clearInterval(h); soltarTela(); }, minutos: minutos };
  }

  /* ==================================================================
   * 3. Aplicação: checklist, soft skills, feedback, finalizar
   * ================================================================== */
  function telaAvaliacao(area, ctx, item, aluno) {
    var se = item.sessao_estacao_id;
    area.appendChild(el("p", "on-carregando", "Carregando avaliação…"));
    var local = Fila.ler(se, aluno.aluno_id);
    var doServidor = O.rpc("minha_avaliacao", { p_sessao_estacao_id: se, p_aluno_id: aluno.aluno_id }).catch(function (e) {
      if (e.code === "rede") return { _offline: true };
      throw e;
    });
    return Promise.all([carregarEstacao(se), doServidor]).then(function (r) {
      limpar(area);
      var esp = lerEspelho(se, aluno.aluno_id);
      if (esp && (!local || esp.rev > local.rev)) local = esp;
      /* Sem conexão e sem nenhuma cópia desta avaliação no aparelho: se ela já foi
         iniciada (por este ou outro aparelho), começar do zero aqui SOBRESCREVERIA o
         que está no servidor. Nesse caso, espera a conexão. */
      if (r[1] && r[1]._offline && !local && aluno.situacao && aluno.situacao !== "nao_iniciada") {
        area.appendChild(el("div", "on-aviso on-aviso-erro", [
          el("p", null, el("b", null, "Sem conexão.")),
          el("p", null, "Esta avaliação já foi iniciada, mas não há cópia dela neste aparelho. Para não apagar o que está no servidor, ela abre quando a internet voltar."),
          botao("Tentar de novo", "on-btn-sec", function () { ctx.nav.atualizar(); })
        ]));
        return;
      }
      montarAvaliacao(area, ctx, item, aluno, r[0], r[1], local);
    });
  }
  /* Espelho do último estado desta avaliação NESTA ABA (sessionStorage): permite reabrir
     sem conexão depois que a fila já foi enviada, sem voltar a um estado vazio. */
  function chaveEspelho(se, aluno) { var e = O.eu(); return "estacoes-espelho:" + (e ? e.id : "") + ":" + se + ":" + aluno; }
  function lerEspelho(se, aluno) { try { return JSON.parse(sessionStorage.getItem(chaveEspelho(se, aluno)) || "null"); } catch (e) { return null; } }
  function gravarEspelho(reg) { try { sessionStorage.setItem(chaveEspelho(reg.se, reg.aluno), JSON.stringify(reg)); } catch (e) { /* nada */ } }

  function montarAvaliacao(area, ctx, item, aluno, reg, servidor, local) {
    var se = item.sessao_estacao_id;
    var c = reg.conteudo || {};
    var regras = reg.regras;
    var ck = O.nota.itensDoChecklist(c, regras);
    var doms = O.nota.dominiosSoft(c, regras);
    var serv = servidor && !servidor._offline ? servidor : null;

    /* ----- estado: o mais novo entre o aparelho e o servidor ----- */
    var est = { itens: {}, soft: {}, feedback: "", rev: 0, finalizar: false, situacao: "rascunho" };
    if (serv) {
      est.itens = decodificarItens(serv.itens); est.soft = decodificarSoft(serv.soft, c, regras);
      est.feedback = serv.feedback || ""; est.rev = Number(serv.rev_cliente) || 0; est.situacao = serv.situacao || "rascunho";
    }
    if (local && local.rev > est.rev && est.situacao === "rascunho") {
      est.itens = local.itens || {}; est.soft = local.soft || {}; est.feedback = local.feedback || "";
      est.rev = local.rev; est.finalizar = !!local.finalizar;
      if (!serv && local.situacao) est.situacao = local.situacao;
    }
    var travada = est.situacao !== "rascunho" || est.finalizar;
    var notaServidor = serv ? serv.nota_total : null;

    /* ----- barra fixa: cronômetro, total parcial, salvamento ----- */
    var barra = el("div", "on-barra-aval");
    var crono = Cronometro("estacoes-crono:" + se + ":" + aluno.aluno_id, reg.tempoMin || minutosDaEstacao(c));
    ctx.nav.aoSair(function () { crono.parar(); desligarFila(); });
    var totalBox = el("div", "on-total");
    var totalNum = el("span", "on-total-num");
    var totalSub = el("span", "on-total-sub");
    totalBox.appendChild(el("span", "on-total-rot", "Total parcial (estimativa)"));
    totalBox.appendChild(totalNum); totalBox.appendChild(totalSub);
    var salvo = el("div", "on-salvo");
    salvo.setAttribute("role", "status"); salvo.setAttribute("aria-live", "polite");
    barra.appendChild(crono.raiz); barra.appendChild(totalBox); barra.appendChild(salvo);
    area.appendChild(barra);

    var grade = el("div", "on-aval-grade");
    var principal = el("div", "on-aval-principal");
    var lado = el("aside", "on-aval-lado");
    grade.appendChild(principal); grade.appendChild(lado);
    area.appendChild(grade);

    principal.appendChild(el("div", "on-cabeca", [
      el("p", "on-ce-num", (item.estacao || "") + " · " + O.nomeBanca(c.banca || item.banca)),
      el("h1", null, aluno.nome || ""),
      el("p", "on-sutil", [c.titulo || item.titulo || "", " · Cronômetro: ", fmt(crono.minutos), " min"])
    ]));
    var aviso = el("div", "on-aviso"); aviso.hidden = true;
    principal.appendChild(aviso);

    /* ----- painéis de apoio ----- */
    var largo = window.matchMedia && window.matchMedia("(min-width: 1100px)").matches;
    lado.appendChild(painel("Material da estação", largo, function (alvo) { montarMaterial(alvo, reg); }));
    lado.appendChild(painel("Discussão (apoio ao feedback)", false, function (alvo) { montarDiscussao(alvo, reg); }));

    /* ----- checklist ----- */
    var controles = [];
    var sec = el("section", "on-checklist");
    sec.appendChild(el("h2", null, ck.titulo + (ck.semPeso ? " · cada item vale 1 (nota de 0 a 10)" : "")));
    sec.appendChild(el("p", "on-sutil on-peq", legendaEscala(ck)));
    var grupoAtual = -1;
    ck.itens.forEach(function (x, n) {
      if (x.g !== grupoAtual) {
        grupoAtual = x.g;
        var rot = [x.grupo.tarefa, x.grupo.titulo].filter(Boolean).join(" · ");
        if (rot) sec.appendChild(el("h3", "on-grupo", O.md(String(rot))));
      }
      sec.appendChild(itemChecklist(x, n));
    });
    principal.appendChild(sec);

    function itemChecklist(x, n) {
      var it = x.item;
      var card = el("div", "on-item" + (x.negativo ? " on-item-neg" : ""));
      card.setAttribute("data-chave", x.chave);
      var cab = el("div", "on-item-cab");
      cab.appendChild(el("span", "on-item-num", String(n + 1)));
      var txt = el("div", "on-item-texto", O.md(it.texto || ""));
      cab.appendChild(txt);
      var val = x.negativo ? "desconta " + fmt(x.valor) : (ck.semPeso ? "" : fmt(x.valor) + (x.valor === 1 ? " pt" : " pts"));
      if (val) cab.appendChild(el("span", "on-item-valor", val));
      card.appendChild(cab);
      if (x.negativo) card.appendChild(el("p", "on-item-nota on-neg", "Item negativo: marque \"Ocorreu\" se o erro aconteceu (desconta da nota)."));
      if (Array.isArray(it.detalhes) && it.detalhes.length) {
        var ul = el("ul", "on-item-detalhes");
        it.detalhes.forEach(function (d) { ul.appendChild(el("li", null, O.md(typeof d === "string" ? d : (d && d.texto) || ""))); });
        card.appendChild(ul);
      }
      if (it.obs) card.appendChild(el("p", "on-item-nota", [el("b", null, "Obs.: "), O.md(it.obs)]));
      if (x.textoParcial && x.permiteParcial) card.appendChild(el("p", "on-item-nota", [el("b", null, "Parcial: "), O.md(x.textoParcial)]));
      if (ck.escala === "sim-parcial-nao" && !x.permiteParcial && !x.negativo) card.appendChild(el("p", "on-item-nota on-sutil", "Parcial: não se aplica."));
      var linha = el("div", "on-opcoes");
      var ops = x.negativo ? [["sim", "Ocorreu"], ["nao", "Não ocorreu"]] : [["sim", "Sim"]];
      if (!x.negativo && x.permiteParcial) ops.push(["parcial", "Parcial"]);
      if (!x.negativo) ops.push(["nao", "Não"]);
      var bts = {};
      ops.forEach(function (o) {
        var b = botao(o[1], "on-op on-op-" + o[0]);
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", function () {
          if (travada) return;
          est.itens[x.chave] = est.itens[x.chave] === o[0] ? undefined : o[0];
          if (est.itens[x.chave] === undefined) delete est.itens[x.chave];
          mudou();
        });
        bts[o[0]] = b; linha.appendChild(b);
      });
      /* D5: crédito parcial em pontos (0 a valor, passo 0,5) */
      var passo = null;
      if (x.permitePontos) {
        passo = el("div", "on-pontos");
        var menos = botao("−", "on-op on-op-mini"), mais = botao("+", "on-op on-op-mini");
        var visor = el("span", "on-pontos-visor");
        menos.setAttribute("aria-label", "Diminuir pontos"); mais.setAttribute("aria-label", "Aumentar pontos");
        var mexer = function (delta) {
          if (travada) return;
          var m = est.itens[x.chave];
          var atual = (m && typeof m === "object") ? m.pontos : (m === "sim" ? x.valor : 0);
          var novo = Math.max(0, Math.min(x.valor, Math.round((atual + delta) * 2) / 2));
          est.itens[x.chave] = { pontos: novo };
          mudou();
        };
        menos.addEventListener("click", function () { mexer(-0.5); });
        mais.addEventListener("click", function () { mexer(0.5); });
        passo.appendChild(el("span", "on-pontos-rot", "Pontos:"));
        passo.appendChild(menos); passo.appendChild(visor); passo.appendChild(mais);
        linha.appendChild(passo);
        passo._visor = visor;
      }
      card.appendChild(linha);
      controles.push(function () {
        var m = est.itens[x.chave];
        Object.keys(bts).forEach(function (k) { var on = m === k; bts[k].setAttribute("aria-pressed", on ? "true" : "false"); bts[k].classList.toggle("on-op-ativo", on); bts[k].disabled = travada; });
        if (passo) {
          var ehP = m && typeof m === "object";
          passo.classList.toggle("on-pontos-ativo", !!ehP);
          passo._visor.textContent = ehP ? fmt(m.pontos) + " / " + fmt(x.valor) : "– / " + fmt(x.valor);
          Array.prototype.forEach.call(passo.querySelectorAll("button"), function (b) { b.disabled = travada; });
        }
        card.classList.toggle("on-item-marcado", m != null);
      });
      return card;
    }

    /* ----- soft skills (5 níveis) ----- */
    if (doms.length) {
      var ss = el("section", "on-soft");
      ss.appendChild(el("h2", null, "Soft skills"));
      if (doms[0].derivado) ss.appendChild(el("p", "on-sutil on-peq", "Domínios tirados dos critérios de avaliação da estação."));
      doms.forEach(function (d) {
        var card = el("div", "on-item on-soft-item");
        card.appendChild(el("div", "on-item-cab", [el("div", "on-item-texto", el("b", null, d.dominio)), el("span", "on-item-valor", fmt(d.valor) + " pts")]));
        if (d.descricao) {
          var det = el("details", "on-soft-desc");
          det.appendChild(el("summary", null, "Descrição do domínio"));
          det.appendChild(el("p", null, O.md(d.descricao)));
          card.appendChild(det);
        }
        var pts = d.valor != null ? O.nota.pontosDosNiveis(d.valor, d) : [];
        var linha = el("div", "on-niveis");
        var bts = [];
        (d.rotulos && d.rotulos.length ? d.rotulos : O.nota.NIVEIS).forEach(function (nome, i) {
          var b = botao([el("span", "on-nivel-nome", nome), el("span", "on-nivel-pts", fmt(pts[i]))], "on-op on-nivel");
          b.setAttribute("aria-pressed", "false");
          b.addEventListener("click", function () {
            if (travada) return;
            var atual = est.soft[String(d.k)];
            if (atual && atual.nivel === i) delete est.soft[String(d.k)];
            else est.soft[String(d.k)] = { nivel: i, pontos: pts[i] };
            mudou();
          });
          bts.push(b); linha.appendChild(b);
        });
        card.appendChild(linha);
        controles.push(function () {
          var s = est.soft[String(d.k)];
          bts.forEach(function (b, i) { var on = !!s && s.nivel === i; b.setAttribute("aria-pressed", on ? "true" : "false"); b.classList.toggle("on-op-ativo", on); b.disabled = travada; });
          card.classList.toggle("on-item-marcado", !!s);
        });
        ss.appendChild(card);
      });
      principal.appendChild(ss);
    }

    /* ----- feedback e finalizar ----- */
    var fb = el("section", "on-feedback");
    fb.appendChild(el("h2", null, "Feedback para o aluno"));
    fb.appendChild(el("p", "on-sutil on-peq", "Obrigatório para finalizar. O aluno vê este texto, a nota total e a nota por domínio (nunca o checklist)."));
    var campo = el("textarea", "on-campo on-feedback-campo");
    campo.rows = 6; campo.maxLength = 5000; campo.value = est.feedback;
    campo.setAttribute("aria-label", "Feedback para o aluno");
    var tFb = null;
    campo.addEventListener("input", function () {
      if (travada) return;
      clearTimeout(tFb);
      tFb = setTimeout(function () { est.feedback = campo.value; mudou(); }, 600);
    });
    campo.addEventListener("blur", function () { if (!travada && campo.value !== est.feedback) { clearTimeout(tFb); est.feedback = campo.value; mudou(); } });
    fb.appendChild(campo);
    var pendTxt = el("p", "on-pendencias");
    fb.appendChild(pendTxt);
    var bFin = botao("Finalizar avaliação", "on-btn-pri on-btn-grande", finalizar);
    fb.appendChild(bFin);
    principal.appendChild(fb);

    /* ----- atualização da tela ----- */
    function atualizar() {
      var n = O.nota.calcular(c, est, regras);
      totalNum.textContent = fmt(n.total) + " / " + fmt(n.maximo);
      var partes = n.dominios.map(function (d) { return d.dominio + " " + (d.nota == null ? "–" : fmt(d.nota)) + "/" + fmt(d.maximo); });
      totalSub.textContent = partes.length > 1 ? partes.join(" · ") : "";
      if (notaServidor != null) totalSub.textContent += (totalSub.textContent ? " · " : "") + "servidor: " + fmt(notaServidor);
      controles.forEach(function (fn) { fn(); });
      campo.disabled = travada;
      var falta = [];
      if (n.semMarca) falta.push(n.semMarca + " item(ns) sem marcação");
      if (!campo.value.trim()) falta.push("feedback em branco");
      pendTxt.textContent = travada ? "" : (falta.length ? "Para finalizar: " + falta.join(" e ") + "." : "Tudo marcado. Pode finalizar.");
      bFin.disabled = travada;
      bFin.hidden = travada;
      aviso.hidden = !travada;
      limpar(aviso);
      if (travada) {
        aviso.className = "on-aviso on-aviso-trava";
        aviso.appendChild(el("p", null, el("b", null, est.situacao === "rascunho" ? "Finalização registrada neste aparelho, aguardando conexão para enviar." : "Avaliação finalizada.")));
        aviso.appendChild(el("p", null, "Ela está travada. Só o administrador pode reabrir."));
      }
      atualizarSalvo(Fila.situacao());
    }
    function mudou() {
      est.rev = novoRev();
      var regNovo = { se: se, aluno: aluno.aluno_id, alunoNome: aluno.nome, itens: est.itens, soft: est.soft,
                      feedback: est.feedback, rev: est.rev, finalizar: est.finalizar, em: new Date().toISOString() };
      gravarEspelho(regNovo);
      Fila.gravar(regNovo);
      atualizar();
    }
    /* o estado vindo do servidor também vira espelho (para reabrir sem conexão) */
    if (serv && !(local && local.rev > (Number(serv.rev_cliente) || 0))) {
      gravarEspelho({ se: se, aluno: aluno.aluno_id, alunoNome: aluno.nome, itens: est.itens, soft: est.soft,
                      feedback: est.feedback, rev: est.rev, finalizar: est.situacao !== "rascunho", situacao: est.situacao, em: new Date().toISOString() });
    }
    function atualizarSalvo(st) {
      var meu = Fila.ler(se, aluno.aluno_id);
      var erro = st.erros && st.erros[se + ":" + aluno.aluno_id];
      salvo.className = "on-salvo";
      if (erro) { salvo.classList.add("on-salvo-erro"); salvo.textContent = "Erro ao salvar: " + (erro.code || erro.message) + " (guardado no aparelho)"; }
      else if (!meu) { salvo.classList.add("on-salvo-ok"); salvo.textContent = est.rev ? "✓ Salvo" : "Nada marcado ainda"; }
      else if (!st.online) { salvo.classList.add("on-salvo-espera"); salvo.textContent = "Aguardando conexão" + (st.pendentes > 1 ? " (" + st.pendentes + ")" : "") + " · guardado no aparelho"; }
      else { salvo.classList.add("on-salvo-envio"); salvo.textContent = "Salvando…"; }
    }
    var desligarFila = Fila.ouvir(function (st, ev) {
      if (ev && ev.reg && ev.reg.se === se && ev.reg.aluno === aluno.aluno_id) {
        if (ev.tipo === "resposta") {
          var r = ev.resposta || {};
          if (r.nota_total !== undefined) notaServidor = r.nota_total;
          if (r.recusa_finalizacao) {
            est.finalizar = false; travada = false;
            O.toast(r.recusa_finalizacao === "feedback_obrigatorio" ? "Não finalizada: o feedback é obrigatório." :
                    r.recusa_finalizacao === "itens_sem_marcacao" ? "Não finalizada: há itens sem marcação." : "Não finalizada: " + r.recusa_finalizacao, "erro");
            mudou(); return;
          }
          if (r.situacao && r.situacao !== "rascunho") {
            est.situacao = r.situacao; travada = true;
            gravarEspelho({ se: se, aluno: aluno.aluno_id, alunoNome: aluno.nome, itens: est.itens, soft: est.soft,
                            feedback: est.feedback, rev: est.rev, finalizar: true, situacao: r.situacao, em: new Date().toISOString() });
            if (ev.reg.finalizar) O.toast("Avaliação finalizada e enviada.", "ok");
          }
          atualizar(); return;
        }
        if (ev.tipo === "travada") { est.situacao = "finalizada"; travada = true; O.toast("Esta avaliação já estava finalizada no servidor.", "aviso"); atualizar(); return; }
        if (ev.tipo === "erro") O.toast("Não foi possível salvar (" + (ev.erro.code || "erro") + "). O estado continua guardado no aparelho.", "erro");
      }
      atualizarSalvo(st);
    });

    function finalizar() {
      if (travada) return;
      clearTimeout(tFb); est.feedback = campo.value;
      var n = O.nota.calcular(c, est, regras);
      if (n.semMarca) { O.toast("Marque todos os itens antes de finalizar (faltam " + n.semMarca + ").", "erro"); irParaPrimeiroVazio(); return; }
      if (!est.feedback.trim()) { O.toast("Escreva o feedback antes de finalizar.", "erro"); campo.focus(); return; }
      O.confirmar("Finalizar a avaliação de " + aluno.nome + "? Total estimado: " + fmt(n.total) + " / " + fmt(n.maximo) +
                  ". Depois de finalizar, a avaliação fica travada e só o administrador pode reabrir.", { ok: "Finalizar" }).then(function (ok) {
        if (!ok) return;
        est.finalizar = true; travada = true;
        mudou();
        Fila.processar();
      });
    }
    function irParaPrimeiroVazio() {
      var alvo = null;
      ck.itens.some(function (x) { if (est.itens[x.chave] == null) { alvo = sec.querySelector('[data-chave="' + x.chave + '"]'); return true; } return false; });
      if (alvo) { alvo.scrollIntoView({ behavior: "smooth", block: "center" }); alvo.classList.add("on-item-piscar"); setTimeout(function () { alvo.classList.remove("on-item-piscar"); }, 1600); }
    }

    if (servidor && servidor._offline) O.toast("Sem conexão: abrindo o que está guardado neste aparelho.", "aviso");
    if (local && serv && local.rev <= (Number(serv.rev_cliente) || 0)) { /* servidor já tem tudo */ }
    atualizar();
    Fila.processar();
  }

  function legendaEscala(ck) {
    switch (ck.escala) {
      case "valor-pontos": return "Toque Sim (valor cheio) ou Não. Para crédito parcial, use os pontos (− / +), de 0 até o valor do item.";
      case "sim-nao-valor": return "Toque Sim (soma o valor) ou Não. Para crédito parcial, use os pontos (− / +).";
      case "sim-parcial-nao": return "Sim, Parcial (metade do item — regra provisória) ou Não. Onde o Parcial não se aplica, só Sim/Não.";
      case "sim-nao-pontos": return "Sim soma os pontos do item; Não, zero.";
      default: return "";
    }
  }

  O.registrarTela("aplicador", { titulo: "Minhas estações", montar: telaMinhas });
  window.OnlineAplicador = { Fila: Fila, _codificarItens: codificarItens, _minutosDaEstacao: minutosDaEstacao };
})();
