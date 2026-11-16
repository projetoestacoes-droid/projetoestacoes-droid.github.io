/* =====================================================================
 * editor.js — Modo edição do visualizador (Parte B do contrato de edição).
 *
 * O Alexandre edita a estação direto no documento diagramado:
 *   - botão "Editar" (barra superior) liga/desliga o modo;
 *   - cada elemento com data-ed="<caminho>" (posto pelo render.js) fica clicável;
 *     o clique abre um balão com o editor do valor e as operações de estrutura
 *     (inserir abaixo, duplicar, mover, excluir);
 *   - painel na barra lateral: status, edição, título, área, dia, soma do
 *     checklist, contador de alterações, Desfazer/Refazer, Descartar, Salvar.
 *
 * Dados: ao ligar, entrada.dados vira uma CÓPIA de trabalho (clone profundo);
 * cada alteração gera um novo objeto, substitui entrada.dados e re-diagrama
 * preservando a rolagem. O original carregado fica guardado (texto JSON) para
 * Descartar e para saber se há pendências.
 *
 * Gravação: window.SalvarEstacao (salvar.js, Parte C). Sem ele, o editor
 * funciona e só o Salvar avisa que o módulo não foi carregado.
 * Depende de window.App (app.js) e window.Diagramador (render.js).
 * ===================================================================== */
(function () {
  "use strict";

  var LIMITE_HISTORICO = 200;
  var MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  var TECLA = MAC ? "⌘" : "Ctrl";
  var STATUS_OPCOES = [["rascunho", "Rascunho"], ["em-revisao", "Em revisão"], ["aprovada", "Aprovada"]];
  var CHAVES_NUMERICAS = { valor: 1, pontos: 1, total_esperado: 1, numero_estacao: 1 };
  var TIPOS_BLOCO = [
    ["paragrafo", "Parágrafo"], ["lista", "Lista"], ["subtitulo", "Subtítulo"], ["fala", "Fala"], ["nota", "Nota"]
  ];
  var NOMES = {
    titulo: "Título", area: "Área", dia: "Dia", edicao: "Edição", objetivos: "Objetivos", criterios: "Critério",
    dominio: "domínio", texto: "texto", pontos: "pontos", roteiro: "Roteiro", atores: "atores", materiais: "material",
    cenario_descricao: "cenário", tempo: "tempo", obs: "observação", local: "Local", filipetas: "Filipeta",
    caixas: "caixa", blocos: "bloco", rotulo: "rótulo", itens: "item", subitens: "subitem", linhas: "linha",
    cabecalho: "cabeçalho", legenda: "legenda", fonte: "fonte", gatilho: "gatilho", orientacoes_examinador: "Orientações ao examinador",
    orientacoes_ator: "Orientações ao ator", orientacoes_estacao: "Orientações da estação", apos_filipetas: "Após as filipetas",
    checklist: "Checklist", grupos: "grupo", tarefa: "tarefa", valor: "valor", detalhes: "detalhe", parcial: "parcial",
    soft_skills: "Soft skills", descricao: "descrição", referencias: "Referência", discussao_tecnica: "Discussão técnica",
    discussao_banca: "Discussão da banca", sugestoes_frases: "Sugestão de frase", referencias_imagens: "Referência de imagem",
    blocos_antes: "bloco antes", blocos_depois: "bloco depois", titulo_bloco: "título do bloco", numero_estacao: "número da estação"
  };
  var NOMES_NIVEL = {
    criterios: "critério", materiais: "material", filipetas: "filipeta", caixas: "caixa", blocos: "bloco",
    blocos_antes: "bloco", blocos_depois: "bloco", orientacoes_examinador: "bloco", orientacoes_estacao: "bloco",
    apos_filipetas: "bloco", discussao_banca: "bloco", itens: "item", subitens: "subitem", linhas: "linha da tabela",
    grupos: "grupo do checklist", detalhes: "detalhe", referencias: "referência", sugestoes_frases: "frase",
    referencias_imagens: "referência de imagem"
  };
  var PLACEHOLDER = {
    texto: "Novo texto.", dominio: "Novo domínio", rotulo: "NOVO RÓTULO:", gatilho: "Se questionado sobre…",
    tarefa: "TAREFA", titulo: "Novo título", legenda: "Tabela. Nova legenda.", descricao: "Nova descrição.",
    fonte: "Fonte: …", obs: "Nova observação."
  };

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, texto) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (texto != null) n.textContent = String(texto);
    return n;
  }
  function botao(texto, cls, aoClicar, titulo) {
    var b = el("button", "btn" + (cls ? " " + cls : ""), texto);
    b.type = "button";
    if (titulo) b.title = titulo;
    if (aoClicar) b.addEventListener("click", aoClicar);
    return b;
  }
  function App() { return window.App || null; }
  /* ACRÉSCIMO (estúdio online, 16/11/2026): a camada de gravação pode trocar alguns
     textos (SalvarEstacao.textos.<nome>(...)). Sem o gancho — caso do visualizador
     local — valem os textos de sempre. */
  function textoGravacao(nome, padrao) {
    var S = window.SalvarEstacao, f = S && S.textos && S.textos[nome];
    if (typeof f !== "function") return padrao;
    try { var t = f.apply(null, Array.prototype.slice.call(arguments, 2)); return t == null ? padrao : String(t); } catch (e) { return padrao; }
  }
  function fmtValor(v) {
    if (window.Diagramador && window.Diagramador.fmtValor) return window.Diagramador.fmtValor(v);
    return String(v).replace(".", ",");
  }

  /* ------------------------------------------------------------------
   * 1. Caminhos ("checklist.grupos.0.itens.4.valor")
   * ------------------------------------------------------------------ */
  function partes(c) {
    return String(c).split(".").map(function (s) { return /^\d+$/.test(s) ? Number(s) : s; });
  }
  function juntar(ps) { return ps.join("."); }
  function obter(obj, c) {
    var ps = partes(c), o = obj;
    for (var i = 0; i < ps.length; i++) {
      if (o == null || typeof o !== "object") return undefined;
      o = o[ps[i]];
    }
    return o;
  }
  function definir(obj, c, v) {
    var ps = partes(c), o = obj;
    for (var i = 0; i < ps.length - 1; i++) {
      if (o == null || typeof o !== "object") throw new Error("Caminho inexistente: " + c);
      o = o[ps[i]];
    }
    if (o == null || typeof o !== "object") throw new Error("Caminho inexistente: " + c);
    o[ps[ps.length - 1]] = v;
  }
  function ultimaChave(c) {
    var ps = partes(c);
    for (var i = ps.length - 1; i >= 0; i--) if (typeof ps[i] === "string") return ps[i];
    return "";
  }
  /* Rótulo amigável: "Checklist › grupo 1 › item 5 › valor" */
  function descreverCaminho(c) {
    var ps = partes(c), out = [];
    ps.forEach(function (p, i) {
      if (typeof p === "number") {
        var ant = ps[i - 1];
        if (ant === "linhas" && typeof ps[i + 1] === "number") { out[out.length - 1] = "linha " + (p + 1); return; }
        if (typeof ant === "number") { out.push("coluna " + (p + 1)); return; }
        if (out.length) out[out.length - 1] += " " + (p + 1); else out.push(String(p + 1));
      } else {
        out.push(NOMES[p] || p.replace(/_/g, " "));
      }
    });
    return out.join(" › ");
  }

  /* Níveis estruturais do caminho (do mais interno para fora), no máximo dois:
     [{ arr: "caminho do array", i: índice, nome: "item", bloco: bool }]
     Células e cabeçalho de tabela não são níveis (a linha da tabela é). */
  function niveis(dados, c) {
    var ps = partes(c), out = [];
    for (var k = ps.length - 1; k >= 1 && out.length < 2; k--) {
      if (typeof ps[k] !== "number") continue;
      var chaveArr = ps[k - 1];
      if (typeof chaveArr === "number") continue;          // célula de tabela (linhas.R.C)
      if (chaveArr === "cabecalho" || chaveArr === "refs") continue;
      var caminhoArr = juntar(ps.slice(0, k));
      var arr = obter(dados, caminhoArr);
      if (!Array.isArray(arr)) continue;
      var elem = arr[ps[k]];
      var ehBloco = !!(elem && typeof elem === "object" && !Array.isArray(elem) && typeof elem.tipo === "string");
      var nome = ehBloco ? "bloco (" + nomeTipo(elem.tipo) + ")" : (NOMES_NIVEL[chaveArr] || "item");
      if (chaveArr === "itens" && ps[0] === "checklist") nome = "item do checklist";
      if (chaveArr === "itens" && ps[0] === "soft_skills") nome = "item de soft skills";
      out.push({ arr: caminhoArr, i: ps[k], nome: nome, bloco: ehBloco, tamanho: arr.length });
    }
    return out;
  }
  function nomeTipo(t) {
    var m = { paragrafo: "parágrafo", subtitulo: "subtítulo", rotulo: "rótulo", lista: "lista", sinais: "sinais vitais",
      tarefa: "tarefa", tabela: "tabela", imagem: "imagem", fala: "fala", nota: "nota" };
    return m[t] || t;
  }

  /* Cópia "vazia" do mesmo formato (com textos-modelo, para continuar clicável) */
  function copiaVazia(v, chave) {
    if (v == null) return v;
    if (typeof v === "string") {
      if (chave === "tipo" || chave === "largura") return v;
      if (chave === "arquivo") return "";
      if (chave === "parcial" && /^n[ãa]o se aplica\.?$/i.test(v.trim())) return v;
      return PLACEHOLDER[chave] || "Novo texto.";
    }
    if (typeof v === "number") return 0;
    if (typeof v === "boolean") return v;
    if (Array.isArray(v)) {
      if (chave === "refs" || chave === "detalhes" || chave === "subitens") return [];
      if (!v.length) return [];
      // uma linha de tabela (array de células): mantém o número de colunas
      if (chave === "linhas" && !Array.isArray(v[0])) return v.map(function (x) { return copiaVazia(x, null); });
      if (chave === "linhas" || chave === "itens" || chave === "blocos" || chave === "caixas") return [copiaVazia(v[0], null)];
      return v.map(function (x) { return copiaVazia(x, null); });
    }
    if (typeof v === "object") {
      var o = {};
      Object.keys(v).forEach(function (k) { o[k] = copiaVazia(v[k], k); });
      return o;
    }
    return v;
  }
  function blocoModelo(tipo) {
    switch (tipo) {
      case "lista": return { tipo: "lista", itens: ["Novo item."] };
      case "subtitulo": return { tipo: "subtitulo", texto: "NOVO SUBTÍTULO" };
      case "fala": return { tipo: "fala", gatilho: "Se questionado sobre…", texto: "\"Nova fala.\"" };
      case "nota": return { tipo: "nota", texto: "Nova nota." };
      default: return { tipo: "paragrafo", texto: "Novo parágrafo." };
    }
  }

  /* ------------------------------------------------------------------
   * 2. Sessão de edição (uma por entrada)
   * ------------------------------------------------------------------ */
  var modo = false;
  var sessao = null; // { entrada, originalJSON, hist: [{json, caminho}], refazer: [...] }

  function pendente() {
    return !!(sessao && JSON.stringify(sessao.entrada.dados) !== sessao.originalJSON);
  }
  function nAlteracoes() { return sessao ? sessao.hist.length : 0; }

  function iniciarSessao(x) {
    if (!x) { sessao = null; return; }
    if (sessao && sessao.entrada === x) return;
    var json = JSON.stringify(x.dados);
    x.dados = JSON.parse(json); // cópia de trabalho
    sessao = { entrada: x, originalJSON: json, hist: [], refazer: [] };
    prepararGravacao();
  }
  function prepararGravacao() {
    var S = window.SalvarEstacao, P = window.Pasta;
    if (!sessao || !S || typeof S.prepararEdicao !== "function") return;
    if (sessao.entrada.grupo !== "saidas") return;
    if (!P || typeof P.estado !== "function" || P.estado() !== "conectada") return;
    var x = sessao.entrada;
    Promise.resolve().then(function () { return S.prepararEdicao(x); }).then(function (r) {
      if (r && r.preparado === false && r.code !== "SEM_PASTA") console.warn("prepararEdicao:", r.code, r.mensagem);
    }).catch(function (err) { console.warn("prepararEdicao:", err); });
  }
  function encerrarSessao(descartar) {
    if (sessao && descartar && pendente()) sessao.entrada.dados = JSON.parse(sessao.originalJSON);
    sessao = null;
  }

  /* Aplica uma mudança: fn(copia) altera a cópia; vira um passo do histórico */
  function mudar(fn, ancora) {
    if (!sessao) return Promise.resolve(false);
    var x = sessao.entrada;
    var antes = JSON.stringify(x.dados);
    var novo = JSON.parse(antes);
    var r;
    try { r = fn(novo); } catch (err) { mensagem("Não foi possível alterar: " + err.message, "erro"); return Promise.resolve(false); }
    if (r === false) return Promise.resolve(false);
    if (JSON.stringify(novo) === antes) return Promise.resolve(false);
    sessao.hist.push({ json: antes, caminho: ancora && (ancora.alvo || ancora.ref) || null });
    if (sessao.hist.length > LIMITE_HISTORICO) sessao.hist.shift();
    sessao.refazer = [];
    x.dados = novo;
    return redesenhar(ancora).then(function () { return true; });
  }
  function desfazer() {
    if (!sessao || !sessao.hist.length) return;
    fecharPopover(true);
    var passo = sessao.hist.pop();
    sessao.refazer.push({ json: JSON.stringify(sessao.entrada.dados), caminho: passo.caminho });
    sessao.entrada.dados = JSON.parse(passo.json);
    redesenhar(passo.caminho ? { ref: passo.caminho } : null);
    mensagem("Alteração desfeita.");
  }
  function refazer() {
    if (!sessao || !sessao.refazer.length) return;
    fecharPopover(true);
    var passo = sessao.refazer.pop();
    sessao.hist.push({ json: JSON.stringify(sessao.entrada.dados), caminho: passo.caminho });
    sessao.entrada.dados = JSON.parse(passo.json);
    redesenhar(passo.caminho ? { ref: passo.caminho } : null);
    mensagem("Alteração refeita.");
  }
  function descartar() {
    if (!sessao || !pendente()) return;
    perguntar("Descartar alterações?", "As " + nAlteracoes() + " alteração(ões) não salvas desta estação serão perdidas e o documento volta ao que foi carregado.", [
      { rotulo: "Descartar alterações", valor: "sim", perigo: true },
      { rotulo: "Continuar editando", valor: null, primario: true }
    ]).then(function (r) {
      if (r !== "sim" || !sessao) return;
      fecharPopover(true);
      sessao.entrada.dados = JSON.parse(sessao.originalJSON);
      sessao.hist = []; sessao.refazer = [];
      redesenhar(null);
      mensagem("Alterações descartadas.");
    });
  }

  /* ------------------------------------------------------------------
   * 3. Re-diagramar preservando a rolagem
   * ------------------------------------------------------------------ */
  function elementos(c) {
    if (!c) return [];
    var sel = '[data-ed="' + (window.CSS && CSS.escape ? CSS.escape(c) : c.replace(/"/g, '\\"')) + '"]';
    return Array.prototype.slice.call($("documento").querySelectorAll(sel));
  }
  /* Primeiro elemento do caminho exato ou de um descendente (caminho + ".") */
  function primeiroDe(c) {
    var ex = elementos(c);
    if (ex.length) return ex[0];
    var todos = $("documento").querySelectorAll("[data-ed]");
    for (var i = 0; i < todos.length; i++) {
      var d = todos[i].getAttribute("data-ed");
      if (d.indexOf(c + ".") === 0) return todos[i];
    }
    return null;
  }
  var espacador = null, rendersPendentes = 0;
  /* ancora = { ref: caminho medido antes, alvo: caminho em destaque depois (mantido na mesma altura),
               fixar: "ref" → mantém o ref parado e só garante que o alvo fique visível } */
  function redesenhar(ancora) {
    var app = App();
    atualizarPainel();
    if (!app || typeof app.renderizar !== "function") return Promise.resolve();
    var area = $("area-doc");
    var top = area.scrollTop, left = area.scrollLeft;
    var refEl = ancora && ancora.ref ? primeiroDe(ancora.ref) : null;
    var refY = refEl ? refEl.getBoundingClientRect().top : null;
    // espaçador: mantém a altura rolável enquanto o documento é refeito
    if (!espacador) { espacador = el("div", "ed-espacador"); espacador.setAttribute("aria-hidden", "true"); }
    espacador.style.height = area.scrollHeight + "px";
    if (!espacador.parentNode) area.appendChild(espacador);
    rendersPendentes++;
    return Promise.resolve(app.renderizar()).then(function () {
      rendersPendentes--;
      if (rendersPendentes > 0) return;
      var alvo = ancora ? primeiroDe(ancora.alvo || ancora.ref) : null;
      var fixo = ancora && ancora.fixar === "ref" ? primeiroDe(ancora.ref) : alvo; // elemento mantido na mesma altura
      if (fixo && refY != null) area.scrollTop = area.scrollTop + (fixo.getBoundingClientRect().top - refY);
      else area.scrollTop = top;
      area.scrollLeft = left;
      if (espacador.parentNode) espacador.parentNode.removeChild(espacador);
      if (alvo) {
        var r = alvo.getBoundingClientRect(), ra = area.getBoundingClientRect();
        // só rola a área do documento (scrollIntoView poderia rolar a página inteira)
        if (r.bottom < ra.top + 20 || r.top > ra.bottom - 20) area.scrollTop += (r.top + r.height / 2) - (ra.top + ra.height / 2);
        piscar(ancora.alvo || ancora.ref);
      }
      atualizarPainel();
    }, function (err) {
      rendersPendentes = Math.max(0, rendersPendentes - 1);
      if (espacador.parentNode) espacador.parentNode.removeChild(espacador);
      console.error(err);
    });
  }
  function piscar(c) {
    var lst = elementos(c);
    if (!lst.length) { var p = primeiroDe(c); if (p) lst = [p]; }
    lst.forEach(function (n) {
      n.classList.remove("ed-piscar");
      void n.offsetWidth;
      n.classList.add("ed-piscar");
      setTimeout(function () { n.classList.remove("ed-piscar"); }, 1400);
    });
  }

  /* ------------------------------------------------------------------
   * 4. Painel de edição (barra lateral)
   * ------------------------------------------------------------------ */
  var P = {}; // referências aos elementos do painel

  function campoPainel(rotulo, controle, cls) {
    var w = el("label", "ed-campo-painel" + (cls ? " " + cls : ""));
    w.appendChild(el("span", "ed-rot", rotulo));
    w.appendChild(controle);
    return w;
  }
  function montarPainel() {
    var painel = $("painel-edicao");
    if (!painel) return;
    while (painel.firstChild) painel.removeChild(painel.firstChild);

    var cab = el("div", "ed-cab");
    cab.appendChild(el("h2", null, "Modo edição"));
    P.sair = el("button", "btn-link", "sair");
    P.sair.type = "button";
    P.sair.addEventListener("click", function () { alternarModo(false); });
    cab.appendChild(P.sair);
    painel.appendChild(cab);

    var grade = el("div", "ed-grade");
    P.status = el("select");
    STATUS_OPCOES.forEach(function (o) { var op = el("option", null, o[1]); op.value = o[0]; P.status.appendChild(op); });
    P.status.addEventListener("change", function () { alterarCampo("status", P.status.value); });
    grade.appendChild(campoPainel("Status", P.status));

    P.edicao = el("input"); P.edicao.type = "text"; P.edicao.autocomplete = "off";
    P.edicao.addEventListener("change", function () { alterarCampo("edicao", P.edicao.value.trim()); });
    grade.appendChild(campoPainel("Edição", P.edicao));
    painel.appendChild(grade);

    P.titulo = el("textarea"); P.titulo.rows = 2;
    P.titulo.addEventListener("change", function () { alterarCampo("titulo", P.titulo.value.replace(/\s*\n\s*/g, " ").trim()); });
    P.titulo.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); P.titulo.blur(); } });
    painel.appendChild(campoPainel("Título", P.titulo, "largo"));

    var grade2 = el("div", "ed-grade");
    P.area = el("input"); P.area.type = "text"; P.area.autocomplete = "off";
    P.area.addEventListener("change", function () { alterarCampo("area", P.area.value.trim()); });
    grade2.appendChild(campoPainel("Área", P.area));
    P.dia = el("input"); P.dia.type = "text"; P.dia.autocomplete = "off"; P.dia.placeholder = "(sem dia)";
    P.dia.addEventListener("change", function () { var v = P.dia.value.trim(); alterarCampo("dia", v === "" ? null : v); });
    grade2.appendChild(campoPainel("Dia", P.dia));
    painel.appendChild(grade2);

    P.soma = el("div", "ed-soma");
    painel.appendChild(P.soma);

    P.contador = el("div", "ed-contador");
    P.contador.setAttribute("aria-live", "polite");
    painel.appendChild(P.contador);

    var acoes = el("div", "ed-acoes");
    P.desfazer = botao("↶ Desfazer", null, desfazer, "Desfazer (" + TECLA + "+Z)");
    P.refazer = botao("↷ Refazer", null, refazer, "Refazer (" + TECLA + "+Shift+Z)");
    P.descartar = botao("Descartar", "perigo", descartar, "Voltar ao que foi carregado");
    acoes.appendChild(P.desfazer); acoes.appendChild(P.refazer); acoes.appendChild(P.descartar);
    painel.appendChild(acoes);

    var gravar = el("div", "ed-gravar");
    P.salvar = botao("Salvar", "primario", function () { salvarFluxo(false); }, "Salvar (" + TECLA + "+S)");
    P.baixar = el("button", "btn-link", "baixar cópia .js");
    P.baixar.type = "button";
    P.baixar.addEventListener("click", function () { baixarFluxo(false); });
    gravar.appendChild(P.salvar); gravar.appendChild(P.baixar);
    painel.appendChild(gravar);
    P.destino = el("div", "ed-destino");
    painel.appendChild(P.destino);

    P.msg = el("div", "ed-msg");
    P.msg.setAttribute("role", "status");
    P.msg.setAttribute("aria-live", "polite");
    painel.appendChild(P.msg);
    P.extra = el("div", "ed-extra"); // botões contextuais (Conectar pasta, Gravar mesmo assim…)
    painel.appendChild(P.extra);

    painel.appendChild(el("p", "ed-dica", "Clique em qualquer texto do documento para editar. " +
      TECLA + "+Enter aplica · Esc cancela · " + TECLA + "+Z desfaz · " + TECLA + "+S salva."));
  }
  function alterarCampo(chave, valor) {
    if (!sessao) return;
    if (sessao.entrada.dados[chave] === valor) return;
    mudar(function (d) { d[chave] = valor; }, null).then(function (ok) {
      if (ok && App() && App().montarLista) App().montarLista();
    });
  }
  function atualizarPainel() {
    var painel = $("painel-edicao");
    if (!painel || !P.status) return;
    painel.hidden = !modo;
    if (!modo || !sessao) return;
    var x = sessao.entrada, d = x.dados || {};
    var foco = document.activeElement;
    var st = d.status || "";
    if (!Array.prototype.some.call(P.status.options, function (o) { return o.value === st; })) {
      var op = el("option", null, st || "(sem status)"); op.value = st; P.status.appendChild(op);
    }
    if (foco !== P.status) P.status.value = st;
    if (foco !== P.edicao) P.edicao.value = d.edicao == null ? "" : String(d.edicao);
    if (foco !== P.titulo) P.titulo.value = d.titulo == null ? "" : String(d.titulo);
    if (foco !== P.area) P.area.value = d.area == null ? "" : String(d.area);
    if (foco !== P.dia) P.dia.value = d.dia == null ? "" : String(d.dia);

    // soma do checklist × total esperado
    while (P.soma.firstChild) P.soma.removeChild(P.soma.firstChild);
    var sc = App() && App().somaChecklist ? App().somaChecklist(d) : { soma: 0, n: 0 };
    var tot = d.checklist && d.checklist.total_esperado;
    P.soma.appendChild(el("span", "ed-rot", "Checklist"));
    var val = el("span", "ed-soma-valor", fmtValor(sc.soma) + (tot != null ? " / " + fmtValor(tot) : ""));
    var bate = tot == null ? null : Math.abs(sc.soma - Number(tot)) < 1e-9;
    P.soma.className = "ed-soma" + (bate === true ? " ok" : bate === false ? " difere" : "");
    P.soma.appendChild(val);
    P.soma.appendChild(el("span", "ed-soma-det", sc.n + " itens pontuados" + (tot == null ? " · sem total esperado" : bate ? " · confere" : " · não confere com o total")));

    var pend = pendente();
    var n = nAlteracoes();
    P.contador.textContent = pend ? (n === 1 ? "1 alteração não salva" : n + " alterações não salvas") : "Sem alterações não salvas";
    P.contador.className = "ed-contador" + (pend ? " pendente" : "");
    P.desfazer.disabled = !sessao.hist.length;
    P.refazer.disabled = !sessao.refazer.length;
    P.descartar.disabled = !pend;

    var saidas = x.grupo === "saidas";
    P.salvar.textContent = saidas ? "Salvar" : "Baixar .js";
    P.salvar.title = saidas ? "Salvar (" + TECLA + "+S)" : "Baixar o arquivo estacao.js editado";
    P.baixar.hidden = !saidas;
    P.destino.textContent = saidas ? textoGravacao("destino", "Grava em " + caminhoProjeto(x) + " (com cópia da versão anterior em versoes/).", x)
      : "Esta estação não está em saidas/: o arquivo editado é baixado (" + x.arquivo + ").";
    var bt = $("btn-editar");
    if (bt) bt.classList.toggle("com-pendencias", pend);
    if (pend !== atualizarPainel.ultimoPend) {
      atualizarPainel.ultimoPend = pend;
      if (App() && App().montarLista) App().montarLista();
    }
  }
  function caminhoProjeto(x) {
    var S = window.SalvarEstacao;
    if (S && typeof S.caminhoDe === "function") { try { return S.caminhoDe(x); } catch (e) { /* cai no cálculo abaixo */ } }
    var a = String(x.arquivo || "");
    var m = a.match(/(?:^|\/)saidas\/(.+)$/);
    return m ? "saidas/" + m[1] : a;
  }
  function mensagem(texto, tipo) {
    if (!P.msg) return;
    P.msg.textContent = texto || "";
    P.msg.className = "ed-msg" + (tipo ? " " + tipo : "");
  }
  function limparExtra() { if (P.extra) while (P.extra.firstChild) P.extra.removeChild(P.extra.firstChild); }

  /* ------------------------------------------------------------------
   * 5. Salvar / Baixar (Parte C: window.SalvarEstacao)
   * ------------------------------------------------------------------ */
  var salvando = false;
  function marcarSalvo() {
    if (!sessao) return;
    sessao.originalJSON = JSON.stringify(sessao.entrada.dados);
    sessao.hist = []; sessao.refazer = [];
    atualizarPainel();
    if (App() && App().montarLista) App().montarLista();
  }
  /* → Promise<boolean> (true = gravado) */
  function salvarFluxo(forcar) {
    if (!sessao) return Promise.resolve(false);
    var x = sessao.entrada;
    if (x.grupo !== "saidas") return Promise.resolve(baixarFluxo(true));
    var S = window.SalvarEstacao;
    limparExtra();
    if (!S || typeof S.salvar !== "function") {
      mensagem("Módulo de gravação (js/salvar.js) não carregado: não é possível salvar agora. As alterações continuam na tela.", "erro");
      return Promise.resolve(false);
    }
    if (salvando) return Promise.resolve(false);
    // texto digitado no balão e ainda não aplicado entra na gravação
    if (pop && pop.campo && popoverAlterado()) {
      return aplicarPopover().then(function () {
        if (pop) { mensagem("Corrija o valor no balão de edição antes de salvar.", "erro"); return false; }
        return salvarFluxo(forcar);
      });
    }
    salvando = true;
    mensagem("Salvando…");
    P.salvar.disabled = true;
    var copiaGravada = JSON.stringify(x.dados);
    var refOriginal = sessao.originalJSON; // dados como foram carregados (ou gravados por último): base do conflito
    return Promise.resolve().then(function () { return S.salvar(x, { forcar: !!forcar, originalJSON: refOriginal }); }).then(function (res) {
      salvando = false; P.salvar.disabled = false;
      res = res || {};
      // se houve nova edição durante a gravação, o original passa a ser o que foi gravado
      if (sessao && sessao.entrada === x) {
        if (JSON.stringify(x.dados) === copiaGravada) marcarSalvo();
        else { sessao.originalJSON = copiaGravada; atualizarPainel(); }
      }
      limparExtra();
      var onde = res.caminho || caminhoProjeto(x);
      var padrao;
      if (res.semMudancas) padrao = "Sem mudanças em relação ao arquivo do disco (" + onde + "): nada foi gravado.";
      else if (res.criado) padrao = "Arquivo criado em " + onde + " (não havia versão anterior para guardar).";
      else padrao = "Salvo em " + onde + "." + (res.backup ? " Versão anterior guardada em " + res.backup + "." : "") +
        (res.forcado ? " (Gravado por cima da versão alterada no disco.)" : "") +
        (res.conferido === false ? " Obs.: sem checagem de conflito nesta gravação (a pasta foi conectada depois de abrir a edição)." : "");
      mensagem(textoGravacao("salvo", padrao, res, x), "ok");
      prepararGravacao();
      return true;
    }, function (err) {
      salvando = false; P.salvar.disabled = false;
      tratarErroSalvar(err);
      return false;
    });
  }
  function tratarErroSalvar(err) {
    var code = err && err.code;
    var texto = err && err.message ? err.message : String(err);
    limparExtra();
    var Pa = window.Pasta;
    if (code === "SEM_PASTA") {
      if (Pa && typeof Pa.suportada === "function" && !Pa.suportada()) {
        mensagem("Este navegador não grava na pasta do projeto (use o Chrome). Baixe o arquivo e substitua " + caminhoProjeto(sessao.entrada) + " à mão.", "erro");
        P.extra.appendChild(botao("Baixar .js", null, function () { baixarFluxo(false); }));
        return;
      }
      var pend = Pa && typeof Pa.estado === "function" && Pa.estado() === "pendente";
      mensagem(pend ? "A pasta do projeto precisa ser autorizada de novo para salvar." : "Conecte a pasta do projeto para salvar.", "erro");
      P.extra.appendChild(botao(pend ? "Reconectar pasta e salvar" : "Conectar pasta e salvar", "primario", conectarESalvar));
      return;
    }
    if (code === "SEM_ARQUIVO" || code === "CAMINHO_INVALIDO") {
      mensagem((code === "SEM_ARQUIVO" ? "Não há arquivo da estação na pasta do projeto para regravar" : "Este arquivo não pode ser regravado pelo visualizador") +
        " (" + texto + "). Baixe o .js e coloque-o no lugar certo à mão.", "erro");
      P.extra.appendChild(botao("Baixar .js", null, function () { baixarFluxo(false); }));
      return;
    }
    if (code === "BACKUP") {
      mensagem("Nada foi regravado: falhou a cópia de segurança da versão anterior. " + texto +
        (err.backupIncompleto && texto.indexOf(err.backupIncompleto) < 0 ? " Ficou um arquivo de backup vazio/incompleto em " + err.backupIncompleto + " (pode ser apagado à mão)." : ""), "erro");
      return;
    }
    if (code === "GRAVACAO") {
      mensagem("Falha ao regravar o arquivo da estação: " + texto + (err.backup ? " A versão anterior está guardada em " + err.backup + "." : "") + " As alterações continuam na tela; tente de novo.", "erro");
      return;
    }
    if (code === "VERIFICACAO") {
      mensagem("O arquivo foi gravado, mas a releitura não conferiu com os dados: " + texto + (err.backup ? " A versão anterior está em " + err.backup + "." : "") + " Confira o arquivo antes de seguir.", "erro");
      return;
    }
    if (code === "SERIALIZACAO" || code === "SEM_DADOS") {
      mensagem("Não foi possível montar o arquivo a partir dos dados editados: " + texto + " Nada foi gravado.", "erro");
      return;
    }
    if (code === "CONFLITO") {
      mensagem(textoGravacao("conflito", "O arquivo no disco mudou depois que você começou a editar (talvez pelo Claude Code). Nada foi gravado.", sessao && sessao.entrada), "erro");
      P.extra.appendChild(botao("Gravar mesmo assim…", "perigo", confirmarForcar));
      confirmarForcar();
      return;
    }
    mensagem("Não foi possível salvar: " + texto, "erro");
  }
  function confirmarForcar() {
    if (!sessao) return;
    var x = sessao.entrada;
    var dir = caminhoProjeto(x).replace(/\/[^/]*$/, "");
    perguntar(textoGravacao("conflitoTitulo", "O arquivo mudou no disco", x), textoGravacao("conflitoTexto", "O " + caminhoProjeto(x) + " foi alterado depois que você abriu o modo edição (por exemplo, pelo Claude Code). " +
      "Se gravar mesmo assim, a versão que está no disco agora é guardada em " + dir + "/versoes/ antes de ser substituída pela sua. " +
      "Se preferir, cancele, baixe uma cópia (.js) e recarregue a página para ver a versão do disco.", x), [
      { rotulo: "Gravar mesmo assim", valor: "sim", primario: true },
      { rotulo: "Baixar cópia .js", valor: "baixar" },
      { rotulo: "Cancelar", valor: null }
    ]).then(function (r) {
      if (r === "sim") salvarFluxo(true);
      else if (r === "baixar") baixarFluxo(false);
    });
  }
  function conectarESalvar() {
    var Pa = window.Pasta;
    if (!Pa) { mensagem("Camada de pasta (pedido.js) não carregada.", "erro"); return; }
    // precisa ser chamado direto no clique (gesto do usuário)
    var prom;
    try { prom = Pa.estado() === "pendente" ? Pa.reconectar() : Pa.conectar(); } catch (err) { prom = Promise.reject(err); }
    mensagem("Aguardando a escolha da pasta…");
    Promise.resolve(prom).then(function () {
      document.dispatchEvent(new CustomEvent("pasta-conectada"));
      var S = window.SalvarEstacao;
      // ativa a base de conflito e grava em seguida
      return Promise.resolve(S && S.prepararEdicao && sessao ? S.prepararEdicao(sessao.entrada) : null).catch(function () {}).then(function () { return salvarFluxo(false); });
    }, function (err) {
      if (err && err.name === "AbortError") { mensagem("Conexão cancelada. Nada foi gravado.", "erro"); return; }
      mensagem("Não foi possível conectar a pasta: " + (err && err.message ? err.message : err), "erro");
    });
  }
  /* aposSalvar = true quando o download substitui o Salvar (estação fora de saidas/) */
  function baixarFluxo(comoSalvar) {
    if (!sessao) return false;
    var S = window.SalvarEstacao;
    if (!S || typeof S.baixar !== "function") {
      mensagem("Módulo de gravação (js/salvar.js) não carregado: não é possível baixar agora.", "erro");
      return false;
    }
    try { S.baixar(sessao.entrada); } catch (err) { mensagem("Não foi possível baixar: " + err.message, "erro"); return false; }
    if (comoSalvar) {
      marcarSalvo();
      mensagem("Arquivo estacao.js baixado. Substitua " + sessao.entrada.arquivo + " por ele, se quiser manter as alterações.", "ok");
    } else {
      mensagem("Cópia estacao.js baixada (as alterações continuam pendentes até salvar).", "ok");
    }
    return true;
  }

  /* ------------------------------------------------------------------
   * 6. Diálogo de confirmação (<dialog>)
   * ------------------------------------------------------------------ */
  function perguntar(titulo, texto, botoes) {
    return new Promise(function (ok) {
      var dlg = el("dialog", "ed-dialogo");
      dlg.setAttribute("aria-label", titulo);
      dlg.appendChild(el("h3", null, titulo));
      dlg.appendChild(el("p", null, texto));
      var acoes = el("div", "ed-dialogo-acoes");
      var resolvido = false;
      var fim = function (v) {
        if (resolvido) return;
        resolvido = true;
        try { dlg.close(); } catch (e) { /* já fechado */ }
        if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
        ok(v);
      };
      var focar = null;
      botoes.forEach(function (b) {
        var bt = botao(b.rotulo, b.primario ? "primario" : b.perigo ? "perigo" : null, function () { fim(b.valor); });
        if (b.primario && !focar) focar = bt;
        acoes.appendChild(bt);
      });
      dlg.appendChild(acoes);
      dlg.addEventListener("cancel", function (ev) { ev.preventDefault(); fim(null); });
      document.body.appendChild(dlg);
      if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
      if (focar) focar.focus();
    });
  }

  /* ------------------------------------------------------------------
   * 7. Balão de edição (popover) ancorado no elemento clicado
   * ------------------------------------------------------------------ */
  var pop = null; // { no, caminho, campo, numerico, inicial, alvo }

  function ehNumerico(c, v) {
    return typeof v === "number" || (v == null && !!CHAVES_NUMERICAS[ultimaChave(c)]);
  }
  function textoInicial(v) { return v == null ? "" : String(v); }
  function numeroParaCampo(v) { return v == null ? "" : String(v).replace(".", ","); }
  /* "2,5" | "2.5" | "" → { ok, valor } */
  function lerNumero(s) {
    var t = String(s).trim().replace(/\s+/g, "");
    if (t === "") return { ok: true, valor: null };
    t = t.replace("−", "-").replace(",", ".");
    if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(t)) return { ok: false };
    return { ok: true, valor: Number(t) };
  }
  function linhasPara(s) {
    var n = String(s).split("\n").length + Math.floor(String(s).length / 52);
    return Math.max(2, Math.min(14, n + 1));
  }

  function abrirPopover(no, caminho, selecionarTudo) {
    if (!sessao) return;
    fecharPopover(true);
    var d = sessao.entrada.dados;
    var v = obter(d, caminho);
    var box = el("div", "ed-popover");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Editar " + descreverCaminho(caminho));

    var cab = el("div", "ed-pop-cab");
    cab.appendChild(el("span", "ed-pop-rotulo", descreverCaminho(caminho)));
    var x = el("button", "ed-x", "×"); x.type = "button"; x.title = "Fechar (Esc)"; x.setAttribute("aria-label", "Fechar");
    x.addEventListener("click", function () { fecharPopover(true); });
    cab.appendChild(x);
    box.appendChild(cab);
    box.appendChild(el("code", "ed-pop-caminho", caminho));

    var existe = v !== undefined;
    var numerico = existe && ehNumerico(caminho, v);
    var campo;
    if (!existe) {
      box.appendChild(el("div", "ed-pop-erro", "Este caminho não existe nos dados (" + caminho + "). Nada a editar aqui."));
    } else if (v !== null && typeof v === "object") {
      box.appendChild(el("div", "ed-pop-erro", "O caminho aponta para um objeto, não para um texto."));
      existe = false;
    } else if (numerico) {
      campo = el("input", "ed-campo ed-num");
      campo.type = "text";
      campo.setAttribute("inputmode", "decimal");
      campo.autocomplete = "off";
      campo.value = numeroParaCampo(v);
      box.appendChild(campo);
      box.appendChild(el("div", "ed-pop-dica", "Número: aceita 2,5 ou 2.5. Vazio = sem valor."));
    } else {
      campo = el("textarea", "ed-campo");
      campo.value = textoInicial(v);
      campo.rows = linhasPara(campo.value);
      campo.spellcheck = true;
      campo.setAttribute("lang", "pt-BR");
      box.appendChild(campo);
      box.appendChild(el("div", "ed-pop-dica", "**negrito** · *itálico* · Enter = quebra de linha · " + TECLA + "+Enter aplica · Esc cancela"));
    }
    var erro = el("div", "ed-pop-erro");
    erro.setAttribute("role", "alert");
    box.appendChild(erro);

    if (existe) {
      var acoes = el("div", "ed-pop-acoes");
      acoes.appendChild(botao("Aplicar", "primario", function () { aplicarPopover(); }, TECLA + "+Enter"));
      acoes.appendChild(botao("Cancelar", null, function () { fecharPopover(true); }, "Esc"));
      box.appendChild(acoes);
    }

    // operações de estrutura
    var nv = niveis(d, caminho);
    if (nv.length) {
      var est = el("div", "ed-estrutura");
      nv.forEach(function (n) { est.appendChild(linhaNivel(n)); });
      box.appendChild(est);
    }

    document.body.appendChild(box);
    pop = { no: box, caminho: caminho, campo: campo, numerico: numerico, inicial: campo ? campo.value : null, alvo: no, erro: erro };
    marcarAtivo(caminho);
    posicionarPopover();
    if (campo) {
      campo.focus();
      if (selecionarTudo) campo.select();
      else if (campo.setSelectionRange) { var L = campo.value.length; campo.setSelectionRange(L, L); }
    }
  }
  function linhaNivel(n) {
    var linha = el("div", "ed-nivel");
    var rot = n.nome.charAt(0).toUpperCase() + n.nome.slice(1);
    linha.appendChild(el("span", "ed-nivel-rot", rot + " " + (n.i + 1) + " de " + n.tamanho));
    var bts = el("div", "ed-nivel-bts");
    var tipos = null;
    var ins = botao("+ Inserir abaixo", "mini", function () {
      if (!n.bloco) { estrutura("inserir", n); return; }
      tipos.hidden = !tipos.hidden;
    }, n.bloco ? "Escolher o tipo do novo bloco" : "Inserir um novo " + n.nome + " abaixo");
    bts.appendChild(ins);
    bts.appendChild(botao("Duplicar", "mini", function () { estrutura("duplicar", n); }));
    var cima = botao("↑", "mini", function () { estrutura("cima", n); }, "Mover para cima");
    var baixo = botao("↓", "mini", function () { estrutura("baixo", n); }, "Mover para baixo");
    cima.disabled = n.i === 0; baixo.disabled = n.i >= n.tamanho - 1;
    cima.setAttribute("aria-label", "Mover " + n.nome + " para cima");
    baixo.setAttribute("aria-label", "Mover " + n.nome + " para baixo");
    bts.appendChild(cima); bts.appendChild(baixo);
    bts.appendChild(botao("Excluir", "mini perigo", function () { estrutura("excluir", n); }));
    // valor/pontos vazios (null) não aparecem no documento: permite defini-los daqui
    var elem = sessao ? obter(sessao.entrada.dados, n.arr + "." + n.i) : null;
    ["valor", "pontos"].forEach(function (k) {
      if (!elem || typeof elem !== "object" || Array.isArray(elem) || !(k in elem) || elem[k] != null) return;
      var cam = n.arr + "." + n.i + "." + k;
      bts.appendChild(botao("Definir " + k, "mini", function () {
        var ancora = pop && pop.alvo;
        if (!fecharPopover(false)) return;
        abrirPopover(ancora, cam, false);
      }, "Este " + n.nome + " está sem " + k + " (não aparece no documento)"));
    });
    linha.appendChild(bts);
    if (n.bloco) {
      tipos = el("div", "ed-tipos");
      tipos.hidden = true;
      tipos.appendChild(el("span", "ed-rot", "Tipo do novo bloco:"));
      tipos.appendChild(botao("Mesmo formato", "mini", function () { estrutura("inserir", n); }));
      TIPOS_BLOCO.forEach(function (t) {
        tipos.appendChild(botao(t[1], "mini", function () { estrutura("inserir", n, t[0]); }));
      });
      linha.appendChild(tipos);
    }
    return linha;
  }
  function marcarAtivo(c) {
    Array.prototype.forEach.call(document.querySelectorAll("#documento .ed-ativo"), function (n) { n.classList.remove("ed-ativo"); });
    elementos(c).forEach(function (n) { n.classList.add("ed-ativo"); });
  }
  function posicionarPopover() {
    if (!pop) return;
    var alvo = pop.alvo && pop.alvo.isConnected ? pop.alvo : primeiroDe(pop.caminho);
    pop.alvo = alvo;
    var box = pop.no;
    var vw = window.innerWidth, vh = window.innerHeight;
    var w = Math.min(460, vw - 24);
    box.style.width = w + "px";
    var bh = box.offsetHeight;
    if (!alvo) { box.style.left = Math.max(12, (vw - w) / 2) + "px"; box.style.top = "80px"; return; }
    var r = alvo.getBoundingClientRect();
    var left = Math.min(Math.max(12, r.left), vw - w - 12);
    var top;
    if (r.bottom + 8 + bh <= vh - 8) top = r.bottom + 8;
    else if (r.top - 8 - bh >= 8) top = r.top - 8 - bh;
    else top = Math.max(8, vh - bh - 8);
    box.style.left = left + "px";
    box.style.top = top + "px";
  }
  function popoverAlterado() {
    return !!(pop && pop.campo && pop.campo.value !== pop.inicial);
  }
  function fecharPopover(forcar) {
    if (!pop) return true;
    if (!forcar && popoverAlterado()) {
      pop.erro.textContent = "Há texto não aplicado: use Aplicar ou Cancelar.";
      pop.no.classList.remove("ed-chacoalhar"); void pop.no.offsetWidth; pop.no.classList.add("ed-chacoalhar");
      return false;
    }
    if (pop.no.parentNode) pop.no.parentNode.removeChild(pop.no);
    Array.prototype.forEach.call(document.querySelectorAll("#documento .ed-ativo"), function (n) { n.classList.remove("ed-ativo"); });
    pop = null;
    return true;
  }
  /* Valor do campo → { ok, valor } (valida números) */
  function valorDoCampo() {
    if (!pop || !pop.campo) return { ok: false };
    if (pop.numerico) {
      var r = lerNumero(pop.campo.value);
      if (!r.ok) { pop.erro.textContent = "Número inválido. Use, por exemplo, 2,5 ou 2.5 (ou deixe vazio)."; pop.campo.focus(); }
      return r;
    }
    return { ok: true, valor: pop.campo.value };
  }
  function aplicarPopover() {
    if (!pop || !pop.campo) return Promise.resolve(false);
    var r = valorDoCampo();
    if (!r.ok) return Promise.resolve(false);
    var c = pop.caminho;
    if (!popoverAlterado()) { fecharPopover(true); return Promise.resolve(false); }
    fecharPopover(true);
    return mudar(function (d) { definir(d, c, r.valor); }, { ref: c });
  }

  /* Operações de estrutura sobre o nível n = { arr, i, nome, bloco } */
  function estrutura(op, n, tipoNovo) {
    if (!pop) return;
    var pre = Promise.resolve(true);
    if (popoverAlterado()) {
      var r = valorDoCampo();
      if (!r.ok) return;
      var c0 = pop.caminho;
      pre = Promise.resolve(mudar(function (d) { definir(d, c0, r.valor); }, null));
    }
    var refAtual = n.arr + "." + n.i;
    if (op === "excluir") {
      fecharPopover(true);
      pre.then(function () {
        return perguntar("Excluir " + n.nome + "?", "O " + n.nome + " " + (n.i + 1) + " será removido. Dá para desfazer com " + TECLA + "+Z enquanto não salvar.", [
          { rotulo: "Excluir", valor: "sim", perigo: true },
          { rotulo: "Cancelar", valor: null, primario: true }
        ]);
      }).then(function (resp) {
        if (resp !== "sim") return;
        mudar(function (d) {
          var a = obter(d, n.arr);
          if (!Array.isArray(a) || n.i >= a.length) throw new Error("item não encontrado");
          a.splice(n.i, 1);
        }, { ref: refAtual }).then(function (ok) { if (ok) mensagem("Removido: " + n.nome + " " + (n.i + 1) + "."); });
      });
      return;
    }
    fecharPopover(true);
    pre.then(function () {
      var alvo = refAtual, abrirNovo = false;
      if (op === "inserir" || op === "duplicar") { alvo = n.arr + "." + (n.i + 1); abrirNovo = op === "inserir"; }
      if (op === "cima") alvo = n.arr + "." + (n.i - 1);
      if (op === "baixo") alvo = n.arr + "." + (n.i + 1);
      return mudar(function (d) {
        var a = obter(d, n.arr);
        if (!Array.isArray(a) || n.i >= a.length) throw new Error("item não encontrado");
        var it = a[n.i];
        if (op === "inserir") a.splice(n.i + 1, 0, tipoNovo ? blocoModelo(tipoNovo) : copiaVazia(it, ultimaChave(n.arr)));
        else if (op === "duplicar") a.splice(n.i + 1, 0, JSON.parse(JSON.stringify(it)));
        else if (op === "cima") { if (n.i === 0) return false; a[n.i] = a[n.i - 1]; a[n.i - 1] = it; }
        else if (op === "baixo") { if (n.i >= a.length - 1) return false; a[n.i] = a[n.i + 1]; a[n.i + 1] = it; }
      }, { ref: refAtual, alvo: alvo, fixar: (op === "inserir" || op === "duplicar") ? "ref" : null }).then(function (ok) {
        if (!ok) return;
        var nomes = { inserir: "Inserido", duplicar: "Duplicado", cima: "Movido para cima", baixo: "Movido para baixo" };
        mensagem(nomes[op] + ": " + n.nome + ".");
        if (abrirNovo) {
          var novo = primeiroDe(alvo);
          if (novo) abrirPopover(novo, novo.getAttribute("data-ed"), true);
          else mensagem("Inserido, mas o novo " + n.nome + " não aparece no documento (sem texto visível). Use Desfazer se não era isso.", "erro");
        }
      });
    });
  }

  /* ------------------------------------------------------------------
   * 8. Eventos do documento (hover e clique em [data-ed])
   * ------------------------------------------------------------------ */
  var hoverAtual = null;
  function limparHover() {
    if (!hoverAtual) return;
    elementos(hoverAtual).forEach(function (n) { n.classList.remove("ed-alvo"); });
    hoverAtual = null;
  }
  function aoPassar(ev) {
    if (!modo) return;
    var alvo = ev.target && ev.target.closest ? ev.target.closest("[data-ed]") : null;
    var c = alvo ? alvo.getAttribute("data-ed") : null;
    if (c === hoverAtual) return;
    limparHover();
    if (!c) return;
    hoverAtual = c;
    elementos(c).forEach(function (n) { n.classList.add("ed-alvo"); });
  }
  function aoClicarDoc(ev) {
    if (!modo || !sessao) return;
    var alvo = ev.target && ev.target.closest ? ev.target.closest("[data-ed]") : null;
    if (!alvo) return;
    ev.preventDefault();
    ev.stopPropagation();
    var c = alvo.getAttribute("data-ed");
    if (pop && pop.caminho === c) return;
    if (!fecharPopover(false)) return;
    abrirPopover(alvo, c, false);
  }
  function aoClicarFora(ev) {
    if (!pop) return;
    if (pop.no.contains(ev.target)) return;
    if (ev.target.closest && (ev.target.closest("#documento [data-ed]") || ev.target.closest("dialog"))) return;
    fecharPopover(false);
  }

  /* ------------------------------------------------------------------
   * 9. Liga/desliga, troca de estação, teclado, beforeunload
   * ------------------------------------------------------------------ */
  function alternarModo(ligar) {
    if (ligar === modo) return Promise.resolve(true);
    var bt = $("btn-editar");
    if (ligar) {
      var x = App() && App().atual();
      if (!x) { return Promise.resolve(false); }
      modo = true;
      iniciarSessao(x);
      document.body.classList.add("modo-edicao");
      if (bt) bt.setAttribute("aria-pressed", "true");
      mensagem("");
      limparExtra();
      atualizarPainel();
      return Promise.resolve(true);
    }
    var desligar = function () {
      fecharPopover(true);
      limparHover();
      modo = false;
      encerrarSessao(false);
      document.body.classList.remove("modo-edicao");
      if (bt) { bt.setAttribute("aria-pressed", "false"); bt.classList.remove("com-pendencias"); }
      atualizarPainel.ultimoPend = undefined;
      atualizarPainel();
      if (App() && App().montarLista) App().montarLista();
      return true;
    };
    if (!pendente()) return Promise.resolve(desligar());
    return resolverPendencias("Sair do modo edição?", "sair").then(function (ok) {
      if (!ok) return false;
      var precisaRender = sessao && pendente();
      if (precisaRender) sessao.entrada.dados = JSON.parse(sessao.originalJSON);
      desligar();
      if (precisaRender && App()) redesenhar(null);
      return true;
    });
  }
  /* Pergunta o que fazer com as pendências. → Promise<boolean> (true = pode seguir; pendências resolvidas) */
  function resolverPendencias(titulo, acao) {
    var x = sessao.entrada;
    var podeSalvar = x.grupo === "saidas" && !!window.SalvarEstacao;
    var botoes = [];
    if (podeSalvar) botoes.push({ rotulo: acao === "trocar" ? "Salvar e trocar" : "Salvar e sair", valor: "salvar", primario: true });
    botoes.push({ rotulo: acao === "trocar" ? "Descartar e trocar" : "Descartar e sair", valor: "descartar", perigo: true });
    botoes.push({ rotulo: "Continuar editando", valor: null, primario: !podeSalvar });
    var n = nAlteracoes();
    return perguntar(titulo, "“" + String(x.dados.titulo || "(sem título)") + "” tem " + (n === 1 ? "1 alteração não salva" : n + " alterações não salvas") + ".", botoes)
      .then(function (r) {
        if (r === "salvar") return salvarFluxo(false);
        if (r === "descartar") return true;
        return false;
      });
  }
  /* Gancho chamado por app.js antes de trocar de estação */
  function antesDeTrocar(chaveNova) {
    if (!sessao || !pendente()) return true;
    fecharPopover(true);
    return resolverPendencias("Trocar de estação?", "trocar").then(function (ok) {
      if (!ok) return false;
      if (sessao && pendente()) sessao.entrada.dados = JSON.parse(sessao.originalJSON); // descartou
      encerrarSessao(false);
      return true;
    });
  }
  function aoSelecionar() {
    fecharPopover(true);
    limparHover();
    var x = App() && App().atual();
    if (sessao && sessao.entrada !== x) encerrarSessao(false);
    if (modo) {
      if (x) iniciarSessao(x);
      else alternarModo(false);
    }
    mensagem(""); limparExtra();
    atualizarPainel();
  }
  function aoRenderizar() {
    var x = App() && App().atual();
    if (modo && sessao && sessao.entrada !== x) { // arquivo reaberto: a entrada foi substituída
      encerrarSessao(false);
      if (x) iniciarSessao(x);
    }
    var bt = $("btn-editar");
    if (bt) bt.disabled = !x;
    hoverAtual = null;
    if (pop) {
      pop.alvo = null;
      marcarAtivo(pop.caminho);
      posicionarPopover();
    }
    atualizarPainel();
  }
  function noCampoDeTexto(t) {
    if (!t) return false;
    var tag = (t.tagName || "").toLowerCase();
    return tag === "textarea" || tag === "select" || (tag === "input" && !/^(button|checkbox|radio|file|submit)$/i.test(t.type)) || t.isContentEditable;
  }
  function aoTeclar(ev) {
    if (!modo) return;
    if (document.querySelector("dialog.ed-dialogo[open]")) return;
    var mod = MAC ? ev.metaKey : ev.ctrlKey;
    var k = (ev.key || "").toLowerCase();
    if (pop && pop.no.contains(ev.target)) {
      if (ev.key === "Escape") { ev.preventDefault(); fecharPopover(true); return; }
      if (ev.key === "Enter" && (mod || (pop.numerico && !ev.shiftKey))) { ev.preventDefault(); aplicarPopover(); return; }
    } else if (pop && ev.key === "Escape") { ev.preventDefault(); fecharPopover(true); return; }
    if (mod && k === "s") { ev.preventDefault(); salvarFluxo(false); return; }
    if (noCampoDeTexto(ev.target)) return; // dentro de campos, desfazer nativo
    if (mod && k === "z" && !ev.shiftKey) { ev.preventDefault(); desfazer(); return; }
    if ((mod && k === "z" && ev.shiftKey) || (mod && k === "y")) { ev.preventDefault(); refazer(); return; }
  }

  function iniciar() {
    if (!$("documento")) return;
    if (!document.querySelector("link[href$='editor.css']")) {
      var l = document.createElement("link"); l.rel = "stylesheet"; l.href = "css/editor.css"; document.head.appendChild(l);
    }
    montarPainel();
    var bt = $("btn-editar");
    if (bt) {
      bt.disabled = !(App() && App().atual());
      bt.addEventListener("click", function () { alternarModo(!modo); });
    }
    var doc = $("documento");
    doc.addEventListener("mouseover", aoPassar);
    doc.addEventListener("mouseleave", limparHover);
    doc.addEventListener("click", aoClicarDoc, true);
    document.addEventListener("mousedown", aoClicarFora, true);
    document.addEventListener("keydown", aoTeclar);
    document.addEventListener("estacao-selecionada", aoSelecionar);
    document.addEventListener("estacao-renderizada", aoRenderizar);
    $("area-doc").addEventListener("scroll", function () { if (pop) posicionarPopover(); }, { passive: true });
    window.addEventListener("resize", function () { if (pop) posicionarPopover(); });
    window.addEventListener("beforeprint", function () { fecharPopover(true); limparHover(); });
    window.addEventListener("beforeunload", function (ev) {
      if (!pendente()) return;
      ev.preventDefault();
      ev.returnValue = "Há alterações não salvas na estação.";
      return ev.returnValue;
    });
    if (window.App) {
      window.App.antesDeTrocar = antesDeTrocar;
      window.App.estaAlterada = function (chave) { return !!(sessao && sessao.entrada.chave === chave && pendente()); };
    }
    window.EditorEstacao = { // para testes e depuração
      ligar: function () { return alternarModo(true); },
      desligar: function () { return alternarModo(false); },
      ativo: function () { return modo; },
      pendente: pendente,
      alteracoes: nAlteracoes,
      desfazer: desfazer,
      refazer: refazer,
      salvar: function (forcar) { return salvarFluxo(!!forcar); },
      original: function () { return sessao ? JSON.parse(sessao.originalJSON) : null; },
      abrir: function (caminho) { var n = primeiroDe(caminho); if (n) abrirPopover(n, n.getAttribute("data-ed"), false); return !!n; },
      niveis: function (caminho) { return sessao ? niveis(sessao.entrada.dados, caminho) : []; },
      lerNumero: lerNumero,
      copiaVazia: copiaVazia
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
