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
 *   - 17/11/2026 (estilo CardioAtt, seção 10): no modo texto o clique torna o texto
 *     editável no próprio documento; barra de formatação no topo (negrito, itálico,
 *     destaque, cor, autocorreção, ditado, tabela); barra do bloco ao passar o mouse
 *     (arrastar, subir/descer, tipo, duplicar, tirar, balão) e "+" para acrescentar.
 *     "Modo formulário" volta ao balão.
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
    var sair2 = el("div", "ed-sair");
    P.modoForm = el("button", "btn-link", modoTexto ? "Modo formulário" : "Modo texto");
    P.modoForm.type = "button";
    P.modoForm.title = "Alternar entre escrever direto no documento e editar pelo balão";
    P.modoForm.addEventListener("click", function () { definirModoTexto(!modoTexto); });
    P.sairSem = botao("Sair sem salvar", null, sairSemSalvar, "Descartar as alterações não salvas e sair do modo edição");
    sair2.appendChild(P.modoForm); sair2.appendChild(P.sairSem);
    painel.appendChild(sair2);
    P.destino = el("div", "ed-destino");
    painel.appendChild(P.destino);

    P.msg = el("div", "ed-msg");
    P.msg.setAttribute("role", "status");
    P.msg.setAttribute("aria-live", "polite");
    painel.appendChild(P.msg);
    P.extra = el("div", "ed-extra"); // botões contextuais (Conectar pasta, Gravar mesmo assim…)
    painel.appendChild(P.extra);

    painel.appendChild(el("p", "ed-dica", "É a página como sai no papel. Clique em qualquer texto e escreva por cima (Enter confirma, Shift+Enter quebra a linha, Esc cancela). " +
      "Ao passar por um bloco aparece a barra dele: arraste pelo ⠿ ou use ▲▼, troque o tipo, duplique ou tire; o + acrescenta um novo abaixo. " +
      "Para negrito, itálico, destaque ou cor, selecione o trecho e use a barra de cima. " + TECLA + "+Z desfaz e " + (MAC ? "⌘+Shift+Z" : "Ctrl+Y") + " refaz. " +
      "Nada é gravado até você apertar Salvar (" + TECLA + "+S)."));
  }
  function sairSemSalvar() {
    var vai = function () {
      cancelarTexto();
      fecharPopover(true);
      if (sessao && pendente()) {
        sessao.entrada.dados = JSON.parse(sessao.originalJSON);
        sessao.hist = []; sessao.refazer = [];
        redesenhar(null);
      }
      alternarModo(false);
    };
    if (!(sessao && (pendente() || textoAlterado()))) { vai(); return; }
    var n = nAlteracoes() + (textoAlterado() ? 1 : 0);
    perguntar("Sair sem salvar?", (n === 1 ? "1 alteração não salva será perdida" : n + " alterações não salvas serão perdidas") + " e o documento volta ao que foi carregado.", [
      { rotulo: "Sair sem salvar", valor: "sim", perigo: true },
      { rotulo: "Continuar editando", valor: null, primario: true }
    ]).then(function (r) { if (r === "sim") vai(); });
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
    // texto escrito direto no documento entra na gravação
    if (inl || inlConfirmando) return confirmarTexto().then(function () { return salvarFluxo(forcar); });
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

    // célula de tabela: linhas e colunas
    if (infoCelula(caminho)) {
      celulaAtual = caminho;
      var tab = el("div", "ed-nivel");
      tab.appendChild(el("span", "ed-nivel-rot", "Tabela"));
      var tb = el("div", "ed-nivel-bts");
      [["+ Linha abaixo", "linha+", "mini"], ["+ Coluna à direita", "coluna+", "mini"], ["− Linha", "linha-", "mini perigo"], ["− Coluna", "coluna-", "mini perigo"]].forEach(function (o) {
        tb.appendChild(botao(o[0], o[2], function () {
          if (popoverAlterado()) { var r0 = valorDoCampo(); if (!r0.ok) return; var c0 = pop.caminho; fecharPopover(true); mudar(function (d) { definir(d, c0, r0.valor); }, null).then(function () { opTabela(o[1]); }); return; }
          fecharPopover(true); opTabela(o[1]);
        }));
      });
      tab.appendChild(tb);
      box.appendChild(tab);
    }

    document.body.appendChild(box);
    pop = { no: box, caminho: caminho, campo: campo, numerico: numerico, inicial: campo ? campo.value : null, alvo: no, erro: erro };
    marcarAtivo(caminho);
    posicionarPopover();
    atualizarFerramentas();
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
    if (c && alvo) mostrarBarra(alvo, c);
    if (c === hoverAtual) return;
    limparHover();
    if (!c) return;
    hoverAtual = c;
    elementos(c).forEach(function (n) { n.classList.add("ed-alvo"); });
  }
  function aoClicarDoc(ev) {
    if (!modo || !sessao) return;
    if (inl && inl.no.contains(ev.target)) return; // clique dentro do texto em edição: cursor nativo
    var alvo = ev.target && ev.target.closest ? ev.target.closest("[data-ed]") : null;
    if (!alvo) return;
    ev.preventDefault();
    ev.stopPropagation();
    var c = alvo.getAttribute("data-ed");
    if (pop && pop.caminho === c) return;
    if (!fecharPopover(false)) return;
    if (!modoTexto) { abrirPopover(alvo, c, false); return; }
    var pt = { x: ev.clientX, y: ev.clientY };
    // outro texto ainda gravando (o documento será refeito): espera e reencontra pelo caminho
    if (inl || inlConfirmando) {
      confirmarTexto().then(function () {
        var n2 = alvo.isConnected ? alvo : primeiroDe(c);
        if (n2 && n2.getAttribute("data-ed") === c) abrirNoModo(n2, c, pt);
      });
      return;
    }
    abrirNoModo(alvo, c, pt);
  }
  function aoClicarFora(ev) {
    if (!pop) return;
    if (pop.no.contains(ev.target)) return;
    if (ev.target.closest && (ev.target.closest("#documento [data-ed]") || ev.target.closest("dialog"))) return;
    fecharPopover(false);
  }

  /* ------------------------------------------------------------------
   * 10. Edição direta no texto, barra de formatação e barra do bloco
   *     (no estilo do modo de edição do CardioAtt, 17/11/2026)
   *
   * Modo "texto" (padrão): o clique num texto o torna editável no próprio documento
   * (contenteditable). Ao sair do campo (ou Enter / ⌘+Enter) o conteúdo volta ao mini-markdown
   * (**negrito**, *itálico*, ==destaque==, {cor:NOME}…{/cor}) e vira um passo do histórico.
   * Valores que não aparecem exatamente como estão nos dados (números, textos com prefixo,
   * campos divididos entre páginas) continuam pelo balão. "Modo formulário" = só o balão.
   * ------------------------------------------------------------------ */
  var CORES_TEXTO = [["azul", "Azul"], ["vermelho", "Vermelho"], ["verde", "Verde"], ["laranja", "Laranja"], ["roxo", "Roxo"], ["cinza", "Cinza"]];
  var COR_OK = {}; CORES_TEXTO.forEach(function (c) { COR_OK[c[0]] = true; });
  var CHAVE_MODO = "estacoes-editor-modo", CHAVE_AUTOCORR = "estacoes-editor-autocorrecao", CHAVE_DITADO = "estacoes-editor-ditado-avisado";
  function lerPref(k, padrao) { try { var v = localStorage.getItem(k); return v == null ? padrao : v; } catch (e) { return padrao; } }
  function gravarPref(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* navegação privada: só nesta página */ } }
  var modoTexto = lerPref(CHAVE_MODO, "texto") !== "formulario";
  var autocorrecao = lerPref(CHAVE_AUTOCORR, "1") === "1";

  /* ---------- 10.1 Texto do documento ↔ mini-markdown ---------- */
  var SUBS = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "−": "₋" };
  var SUPS = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "−": "⁻" };
  function indice(t, sub) { var m = sub ? SUBS : SUPS; return t.split("").map(function (c) { return m[c] || c; }).join(""); }
  /* mesmas cores de app/css/estacao.css (.md-cor-*) */
  var RGB_CORES = { azul: [31, 79, 168], vermelho: [180, 35, 24], verde: [30, 107, 53], laranja: [181, 71, 8], roxo: [107, 63, 160], cinza: [89, 96, 107] };
  function lerRgb(css) {
    var s = String(css || "").trim(), m;
    if ((m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(s))) return m[4] != null && Number(m[4]) === 0 ? null : [+m[1], +m[2], +m[3]];
    if ((m = /^#([0-9a-f]{6})$/i.exec(s))) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4), 16)];
    if ((m = /^#([0-9a-f]{3})$/i.exec(s))) return m[1].split("").map(function (h) { return parseInt(h + h, 16); });
    return null;
  }
  /* cor de letra solta (o Chrome cria <span style="color"> ou <font color> ao juntar trechos):
     só conta se estiver perto de uma cor da paleta; a cor normal do texto é ignorada */
  function corDaPaleta(css) {
    var c = lerRgb(css); if (!c) return null;
    var melhor = null, dist = 1e9;
    Object.keys(RGB_CORES).forEach(function (k) {
      var r = RGB_CORES[k], d = Math.sqrt(Math.pow(c[0] - r[0], 2) + Math.pow(c[1] - r[1], 2) + Math.pow(c[2] - r[2], 2));
      if (d < dist) { dist = d; melhor = k; }
    });
    return dist <= 48 ? melhor : null;
  }
  /* fundo amarelado (destaque copiado pelo Chrome como background-color) */
  function fundoDestaque(css) {
    var c = lerRgb(css);
    return !!(c && c[0] > 200 && c[1] > 180 && c[2] < 200 && c[0] - c[2] > 60);
  }
  function corDe(n) {
    var d = n.getAttribute && n.getAttribute("data-cor");
    if (d && COR_OK[d]) return d;
    var m = /(?:^|\s)md-cor-([a-z]+)/.exec(typeof n.className === "string" ? n.className : "");
    if (m && COR_OK[m[1]]) return m[1];
    if (n.tagName === "FONT" && n.getAttribute("color")) return corDaPaleta(n.getAttribute("color"));
    if (n.style && n.style.color) return corDaPaleta(n.style.color);
    return null;
  }
  /* percorre o DOM e devolve trechos [{t, b, i, h, cor}] (marcas de seleção viram posições) */
  function trechos(raiz, marcas) {
    var out = [], tam = 0;
    function por(t, e) { if (!t) return; out.push({ t: t, b: !!e.b, i: !!e.i, h: !!e.h, cor: e.cor || null }); tam += t.length; }
    (function andar(no, e) {
      Array.prototype.forEach.call(no.childNodes, function (f) {
        if (f.nodeType === 3) { por(e.sub || e.sup ? indice(f.nodeValue, !!e.sub) : f.nodeValue, e); return; }
        if (f.nodeType !== 1) return;
        if (f.classList && f.classList.contains("ed-marca")) { if (marcas) marcas[f.getAttribute("data-m")] = tam; return; }
        var tag = f.tagName;
        if (tag === "BR") { por("\n", e); return; }
        var e2 = { b: e.b, i: e.i, h: e.h, cor: e.cor, sub: e.sub, sup: e.sup };
        if (tag === "B" || tag === "STRONG") e2.b = true;
        else if (tag === "I" || tag === "EM") e2.i = true;
        else if (tag === "MARK") e2.h = true;
        else if (tag === "SUB") e2.sub = true;
        else if (tag === "SUP") e2.sup = true;
        var c = corDe(f); if (c) e2.cor = c;
        if (f.style) {
          if (/^(bold|bolder|[6-9]00)$/.test(f.style.fontWeight)) e2.b = true;
          if (f.style.fontStyle === "italic") e2.i = true;
          if (fundoDestaque(f.style.backgroundColor)) e2.h = true;
        }
        var bloco = tag === "DIV" || tag === "P" || tag === "LI";
        if (bloco && out.length && !/\n$/.test(out[out.length - 1].t)) por("\n", e);
        andar(f, e2);
      });
    })(raiz, {});
    return out;
  }
  function mesmoFormato(a, b) { return a.b === b.b && a.i === b.i && a.h === b.h && a.cor === b.cor; }
  function juntarTrechos(lst) {
    var m = [];
    lst.forEach(function (r) {
      if (!r.t) return;
      var u = m[m.length - 1];
      if (u && mesmoFormato(u, r)) u.t += r.t; else m.push({ t: r.t, b: r.b, i: r.i, h: r.h, cor: r.cor });
    });
    return m;
  }
  /* trechos → mini-markdown (de dentro para fora: itálico, negrito, destaque, cor — igual ao md() do render.js) */
  function paraMarkdown(lst) {
    return juntarTrechos(lst).map(function (r) {
      if (!(r.b || r.i || r.h || r.cor)) return r.t;
      var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.t), meio = m[2];
      if (!meio) return r.t;
      if (r.i) meio = "*" + meio + "*";
      if (r.b) meio = "**" + meio + "**";
      if (r.h) meio = "==" + meio + "==";
      if (r.cor) meio = "{cor:" + r.cor + "}" + meio + "{/cor}";
      return m[1] + meio + m[3];
    }).join("");
  }
  function serializar(no) { return paraMarkdown(trechos(no)); }
  /* trechos comparáveis (texto + formato), sem diferença de espaço não separável */
  function chaveTrechos(lst) {
    // formato em espaço não conta (o serializador põe os espaços das pontas fora dos marcadores)
    var cars = [];
    lst.forEach(function (r) {
      r.t.replace(/\u00A0/g, " ").split("").forEach(function (ch) {
        cars.push(/\s/.test(ch) ? { t: ch, b: false, i: false, h: false, cor: null } : { t: ch, b: !!r.b, i: !!r.i, h: !!r.h, cor: r.cor || null });
      });
    });
    return JSON.stringify(juntarTrechos(cars));
  }
  /* o texto v, desenhado pelo md() do render.js, reproduz exatamente o que está no nó?
     (marcadores literais na tela — "Direita*", "PA == 120", "{cor:" — mudariam de sentido ao gravar) */
  function confere(v, no) {
    var D = window.Diagramador;
    if (!D || typeof D.md !== "function") return true;
    var tmp = document.createElement("span");
    tmp.appendChild(D.md(v));
    var tela = trechos(no), novo = trechos(tmp);
    var fimTela = tela.length && /\n+$/.test(tela[tela.length - 1].t);
    if (fimTela && !/\n$/.test(v)) { var u = tela[tela.length - 1]; tela = tela.slice(0, -1).concat(u.t.replace(/\n+$/, "") ? [{ t: u.t.replace(/\n+$/, ""), b: u.b, i: u.i, h: u.h, cor: u.cor }] : []); }
    return chaveTrechos(tela) === chaveTrechos(novo);
  }
  /* como o texto bruto fica depois de desenhado e lido de volta (normaliza "** a**" etc.) */
  function normalizado(v) {
    var D = window.Diagramador;
    if (!D || typeof D.md !== "function") return String(v);
    var tmp = document.createElement("span");
    tmp.appendChild(D.md(v));
    return serializar(tmp);
  }
  /* trechos → nós do DOM (mesmas tags do md() do render.js) */
  function montarTrechos(alvo, lst) {
    while (alvo.firstChild) alvo.removeChild(alvo.firstChild);
    juntarTrechos(lst).forEach(function (r) {
      var frag = document.createDocumentFragment();
      r.t.split("\n").forEach(function (p, k) {
        if (k) frag.appendChild(document.createElement("br"));
        if (p) frag.appendChild(document.createTextNode(p));
      });
      var no = frag;
      function envolver(tag, cls, cor) {
        var w = document.createElement(tag);
        if (cls) w.className = cls;
        if (cor) w.setAttribute("data-cor", cor);
        w.appendChild(no); no = w;
      }
      if (r.i) envolver("i");
      if (r.b) envolver("b");
      if (r.h) envolver("mark", "md-destaque");
      if (r.cor) envolver("span", "md-cor md-cor-" + r.cor, r.cor);
      alvo.appendChild(no);
    });
  }
  /* posição (em caracteres, "\n" = <br>) → ponto do DOM dentro de raiz */
  function pontoEm(raiz, pos) {
    var res = null;
    (function andar(no) {
      for (var k = 0; k < no.childNodes.length && !res; k++) {
        var f = no.childNodes[k];
        if (f.nodeType === 3) { if (pos <= f.nodeValue.length) { res = [f, pos]; return; } pos -= f.nodeValue.length; }
        else if (f.tagName === "BR") { if (pos === 0) { res = [no, k]; return; } pos -= 1; }
        else if (f.nodeType === 1) andar(f);
      }
    })(raiz);
    return res || [raiz, raiz.childNodes.length];
  }

  /* ---------- 10.2 Campo em edição no documento ---------- */
  var inl = null;            // { no, caminho, inicial (normalizado), valorBruto, nbsp, nos, segurar }
  var inlConfirmando = null; // Promise enquanto a confirmação re-diagrama
  var celulaAtual = null;    // caminho da última célula de tabela tocada (ações de tabela)

  function podeEditarNoTexto(no, c) {
    if (!sessao || !no || !no.isConnected) return false;
    var v = obter(sessao.entrada.dados, c);
    if (typeof v !== "string") return false;
    if (elementos(c).length !== 1) return false;               // dividido entre páginas
    if (no.querySelector("[data-ed], img, svg, table, input, select, textarea")) return false;
    return serializar(no) === normalizado(v);
  }
  function caretNoPonto(no, pt) {
    var r = null;
    if (pt && document.caretRangeFromPoint) r = document.caretRangeFromPoint(pt.x, pt.y);
    else if (pt && document.caretPositionFromPoint) {
      var cp = document.caretPositionFromPoint(pt.x, pt.y);
      if (cp) { r = document.createRange(); r.setStart(cp.offsetNode, cp.offset); r.collapse(true); }
    }
    var s = window.getSelection();
    if (!r || !no.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(no); r.collapse(false); }
    s.removeAllRanges(); s.addRange(r);
  }
  function iniciarTexto(no, c, pt, selecionarTudo) {
    if (!sessao) return false;
    if (inl) cancelarTexto();
    fecharPopover(true);
    var v = obter(sessao.entrada.dados, c);
    inl = { no: no, caminho: c, inicial: serializar(no), valorBruto: v, nbsp: v.indexOf(" ") >= 0,
            nos: Array.prototype.map.call(no.childNodes, function (f) { return f.cloneNode(true); }), segurar: false };
    no.setAttribute("contenteditable", "true");
    no.setAttribute("spellcheck", "true");
    no.setAttribute("lang", "pt-BR");
    no.setAttribute("role", "textbox");
    no.setAttribute("aria-label", "Editando: " + descreverCaminho(c));
    no.classList.add("ed-editando");
    no.addEventListener("keydown", teclaTexto);
    no.addEventListener("focusout", saiuTexto);
    no.addEventListener("paste", colarTexto);
    no.addEventListener("drop", soltarTexto);
    try { document.execCommand("styleWithCSS", false, false); } catch (e) { /* nada */ }
    no.focus({ preventScroll: true });
    if (selecionarTudo) { var r = document.createRange(); r.selectNodeContents(no); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
    else caretNoPonto(no, pt);
    if (infoCelula(c)) celulaAtual = c;
    marcarAtivo(c);
    atualizarFerramentas();
    return true;
  }
  function desmontarTexto(x) {
    var no = x.no;
    no.removeAttribute("contenteditable"); no.removeAttribute("spellcheck"); no.removeAttribute("role"); no.removeAttribute("aria-label");
    no.classList.remove("ed-editando");
    no.removeEventListener("keydown", teclaTexto);
    no.removeEventListener("focusout", saiuTexto);
    no.removeEventListener("paste", colarTexto);
    no.removeEventListener("drop", soltarTexto);
    Array.prototype.forEach.call(document.querySelectorAll("#documento .ed-ativo"), function (n) { n.classList.remove("ed-ativo"); });
  }
  function valorDoTexto(x) {
    var v = serializar(x.no);
    if (!x.nbsp) v = v.replace(/ /g, " ");
    if (!/\n$/.test(x.valorBruto)) v = v.replace(/\n+$/, "");
    return v;
  }
  function textoAlterado() { return !!(inl && inl.no.isConnected && valorDoTexto(inl) !== inl.inicial); }
  /* → Promise<boolean> (true = gravou uma mudança no histórico) */
  function confirmarTexto() {
    if (!inl) return inlConfirmando || Promise.resolve(false);
    var x = inl; inl = null;
    pararDitado();
    desmontarTexto(x);
    atualizarFerramentas();
    if (!x.no.isConnected) return Promise.resolve(false);
    var v = valorDoTexto(x);
    if (v === x.inicial) { restaurarNos(x); return Promise.resolve(false); }
    return gravarTexto(x, v);
  }
  /* grava v no caminho do campo x (nó ainda na tela ou já solto por um redesenho) */
  function gravarTexto(x, v) {
    var c = x.caminho;
    if (!confere(v, x.no)) {
      // marcadores literais (*, ==, {cor:…}) mudariam a formatação: nada é gravado em silêncio
      mensagem("Este texto tem marcadores literais (*, ==, {cor:…}) que mudariam a formatação ao gravar. Confira no balão: o texto está em mini-markdown (**negrito**, *itálico*, ==destaque==).", "erro");
      var alvo = x.no.isConnected ? x.no : primeiroDe(c);
      if (x.no.isConnected) restaurarNos(x);
      if (alvo) { abrirPopover(alvo, c, false); if (pop && pop.campo && pop.caminho === c) { pop.campo.value = v; pop.campo.rows = linhasPara(v); } }
      return Promise.resolve(false);
    }
    var p = mudar(function (d) {
      if (typeof obter(d, c) !== "string") throw new Error("o texto não está mais nesse lugar");
      definir(d, c, v);
    }, { ref: c });
    inlConfirmando = p.then(function (r) { inlConfirmando = null; return r; }, function (e) { inlConfirmando = null; throw e; });
    return inlConfirmando;
  }
  function restaurarNos(x) {
    if (!x.no.isConnected) return;
    while (x.no.firstChild) x.no.removeChild(x.no.firstChild);
    x.nos.forEach(function (f) { x.no.appendChild(f); });
  }
  /* O documento foi refeito por fora (fontes carregadas, imagens enviadas…) com um texto aberto:
     o que foi escrito é gravado e o campo reabre no mesmo lugar, com o cursor no fim. */
  function retomarTexto() {
    var x = inl; inl = null;
    pararDitado();
    desmontarTexto(x);
    atualizarFerramentas();
    var v = valorDoTexto(x);
    var reabrir = function () {
      var n = primeiroDe(x.caminho);
      if (n && n.getAttribute("data-ed") === x.caminho && modo && modoTexto && podeEditarNoTexto(n, x.caminho)) iniciarTexto(n, x.caminho, null, false);
    };
    if (v === x.inicial) { setTimeout(reabrir, 0); return; }
    setTimeout(function () { gravarTexto(x, v).then(function (ok) { if (ok) reabrir(); }); }, 0);
  }
  function cancelarTexto() {
    if (!inl) return;
    var x = inl; inl = null;
    pararDitado();
    desmontarTexto(x);
    restaurarNos(x);
    atualizarFerramentas();
  }
  function saiuTexto() {
    var x = inl;
    if (!x) return;
    setTimeout(function () {
      if (inl !== x || x.segurar) return;
      // janela perdeu o foco (troca de aplicativo): o campo continua em edição
      if (document.activeElement === x.no || x.no.contains(document.activeElement)) return;
      confirmarTexto();
    }, 0);
  }
  function colarTexto(ev) {
    ev.preventDefault();
    var t = (ev.clipboardData || window.clipboardData).getData("text/plain") || "";
    document.execCommand("insertText", false, t.replace(/\r\n?/g, "\n"));
  }
  function soltarTexto(ev) {
    var t = ev.dataTransfer && ev.dataTransfer.getData("text/plain");
    ev.preventDefault();
    if (t && t !== "bloco") document.execCommand("insertText", false, t);
  }
  function teclaTexto(ev) {
    var mod = MAC ? ev.metaKey : ev.ctrlKey;
    var k = (ev.key || "").toLowerCase();
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); cancelarTexto(); mensagem("Edição do texto cancelada."); return; }
    if (ev.key === "Enter") {
      ev.preventDefault();
      if (autocorrecao) autocorrigir();   // a última palavra também é corrigida (Enter confirma ou quebra a linha)
      if (ev.shiftKey && !mod) { document.execCommand("insertLineBreak"); return; }
      confirmarTexto();
      return;
    }
    if (mod && !ev.altKey && (k === "b" || k === "i")) { ev.preventDefault(); formatar(k === "b" ? "negrito" : "italico"); return; }
    if (autocorrecao && !mod && !ev.altKey && /^[\s.,;:!?)\]]$/.test(ev.key)) autocorrigir();
  }

  /* ---------- 10.3 Formatação da seleção (N, I, destaque, cor) ---------- */
  function selecaoNoCampo() {
    var s = window.getSelection();
    if (!inl || !s.rangeCount) return null;
    var r = s.getRangeAt(0);
    return inl.no.contains(r.startContainer) && inl.no.contains(r.endContainer) ? r : null;
  }
  /* aplica um formato ao trecho selecionado: modelo de caracteres → DOM refeito → seleção de volta */
  function formatar(op) {
    if (!inl) { mensagem("Clique num texto do documento e selecione o trecho que quer formatar.", "erro"); return; }
    var r = selecaoNoCampo();
    if (!r || r.collapsed) { inl.no.focus(); mensagem("Selecione o trecho do texto primeiro.", "erro"); return; }
    var fim = document.createElement("span"); fim.className = "ed-marca"; fim.setAttribute("data-m", "fim");
    var ini = document.createElement("span"); ini.className = "ed-marca"; ini.setAttribute("data-m", "ini");
    var rf = r.cloneRange(); rf.collapse(false); rf.insertNode(fim);
    var ri = r.cloneRange(); ri.collapse(true); ri.insertNode(ini);
    var pos = {};
    var lst = trechos(inl.no, pos);
    var a = pos.ini, b = pos.fim;
    if (a == null || b == null || a >= b) { if (ini.parentNode) ini.parentNode.removeChild(ini); if (fim.parentNode) fim.parentNode.removeChild(fim); return; }
    // divide os trechos nas pontas da seleção
    var cars = [];
    lst.forEach(function (t) { for (var k = 0; k < t.t.length; k++) cars.push({ t: t.t[k], b: t.b, i: t.i, h: t.h, cor: t.cor }); });
    var sel = cars.slice(a, b);
    var chave = op === "negrito" ? "b" : op === "italico" ? "i" : (op === "destacar" || op === "tirar-destaque") ? "h" : "cor";
    var valor;
    if (op === "negrito" || op === "italico" || op === "destacar") valor = !sel.every(function (c) { return c[chave] || /\s/.test(c.t); });
    else if (op === "tirar-destaque") valor = false;
    else valor = op === "sem-cor" ? null : op.replace(/^cor:/, "");
    sel.forEach(function (c) { c[chave] = valor; });
    montarTrechos(inl.no, cars.map(function (c) { return { t: c.t, b: c.b, i: c.i, h: c.h, cor: c.cor }; }));
    var p1 = pontoEm(inl.no, a), p2 = pontoEm(inl.no, b);
    var nr = document.createRange(); nr.setStart(p1[0], p1[1]); nr.setEnd(p2[0], p2[1]);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(nr);
    inl.no.focus({ preventScroll: true });
    mensagem("");
  }

  /* ---------- 10.4 Autocorreção de acentos ---------- */
  var DIC = {};
  ("nao:não entao:então tambem:também voce:você voces:vocês ate:até apos:após ja:já alem:além porem:porém atraves:através " +
   "ninguem:ninguém alguem:alguém tres:três mes:mês ingles:inglês portugues:português numero:número numeros:números " +
   "possivel:possível impossivel:impossível possiveis:possíveis provavel:provável provaveis:prováveis responsavel:responsável " +
   "responsaveis:responsáveis disponivel:disponível disponiveis:disponíveis necessario:necessário necessaria:necessária " +
   "necessarios:necessários necessarias:necessárias obrigatorio:obrigatório obrigatoria:obrigatória sera:será serao:serão " +
   "estara:estará estarao:estarão tera:terá terao:terão havera:haverá podera:poderá poderao:poderão devera:deverá deverao:deverão " +
   "vao:vão sao:são estao:estão ha:há pos:pós pre:pré recem:recém saude:saúde medico:médico medica:médica medicos:médicos " +
   "medicas:médicas clinico:clínico clinica:clínica clinicos:clínicos clinicas:clínicas cardiaco:cardíaco cardiaca:cardíaca " +
   "cardiacos:cardíacos cardiacas:cardíacas diagnostico:diagnóstico diagnosticos:diagnósticos prognostico:prognóstico " +
   "terapeutico:terapêutico terapeutica:terapêutica farmaco:fármaco farmacos:fármacos pressao:pressão pressoes:pressões " +
   "infeccao:infecção infeccoes:infecções inflamacao:inflamação avaliacao:avaliação avaliacoes:avaliações orientacao:orientação " +
   "orientacoes:orientações comunicacao:comunicação informacao:informação informacoes:informações situacao:situação " +
   "situacoes:situações condicao:condição condicoes:condições atencao:atenção intervencao:intervenção internacao:internação " +
   "medicacao:medicação medicacoes:medicações prescricao:prescrição administracao:administração reanimacao:reanimação " +
   "ressuscitacao:ressuscitação intubacao:intubação ventilacao:ventilação saturacao:saturação palpacao:palpação percussao:percussão " +
   "inspecao:inspeção hipotensao:hipotensão hipertensao:hipertensão sincope:síncope sincopes:síncopes nausea:náusea nauseas:náuseas " +
   "vomito:vômito vomitos:vômitos abdomen:abdômen torax:tórax toracico:torácico toracica:torácica pulmao:pulmão pulmoes:pulmões " +
   "coracao:coração figado:fígado estomago:estômago cerebro:cérebro cranio:crânio musculo:músculo musculos:músculos osseo:ósseo " +
   "ossea:óssea arteria:artéria arterias:artérias eletrolitos:eletrólitos potassio:potássio sodio:sódio calcio:cálcio " +
   "magnesio:magnésio acido:ácido acidos:ácidos lactico:láctico oxigenio:oxigênio leucocitos:leucócitos hematocrito:hematócrito " +
   "antibiotico:antibiótico antibioticos:antibióticos analgesico:analgésico analgesicos:analgésicos diuretico:diurético " +
   "diureticos:diuréticos anticoagulacao:anticoagulação subcutaneo:subcutâneo cronico:crônico cronica:crônica cronicos:crônicos " +
   "cronicas:crônicas sindrome:síndrome sindromes:síndromes doenca:doença doencas:doenças lesao:lesão lesoes:lesões " +
   "isquemico:isquêmico isquemica:isquêmica obito:óbito obitos:óbitos unico:único unica:única unicos:únicos unicas:únicas " +
   "ultimo:último ultima:última ultimos:últimos ultimas:últimas proximo:próximo proxima:próxima proximos:próximos proximas:próximas " +
   "rapido:rápido rapida:rápida util:útil uteis:úteis facil:fácil faceis:fáceis dificil:difícil dificeis:difíceis tecnico:técnico " +
   "tecnica:técnica tecnicos:técnicos tecnicas:técnicas basico:básico basica:básica logico:lógico logica:lógica fisico:físico " +
   "fisica:física laboratorio:laboratório ressonancia:ressonância biopsia:biópsia cirurgico:cirúrgico cirurgica:cirúrgica " +
   "sedacao:sedação hipotese:hipótese hipoteses:hipóteses historia:história historico:histórico familia:família familias:famílias " +
   "mae:mãe maes:mães irmao:irmão irmaos:irmãos irma:irmã irmas:irmãs crianca:criança criancas:crianças gestacao:gestação " +
   "obstetrico:obstétrico obstetrica:obstétrica ginecologico:ginecológico ginecologica:ginecológica pediatrico:pediátrico " +
   "pediatrica:pediátrica consciencia:consciência neurologico:neurológico neurologica:neurológica psiquiatrico:psiquiátrico " +
   "psiquiatrica:psiquiátrica emergencia:emergência emergencias:emergências urgencia:urgência urgencias:urgências " +
   "ambulatorio:ambulatório etica:ética eticas:éticas etico:ético eticos:éticos bioetica:bioética prontuario:prontuário " +
   "prontuarios:prontuários decisao:decisão decisoes:decisões explicacao:explicação duvidas:dúvidas compreensao:compreensão " +
   "preocupacao:preocupação preocupacoes:preocupações emocao:emoção emocoes:emoções noticia:notícia noticias:notícias " +
   "negociacao:negociação mediacao:mediação lideranca:liderança colaboracao:colaboração cooperacao:cooperação seguranca:segurança " +
   "notificacao:notificação beneficio:benefício beneficios:benefícios opcao:opção opcoes:opções minimo:mínimo minima:mínima " +
   "maximo:máximo maxima:máxima medio:médio media:média periodo:período periodos:períodos horario:horário horarios:horários " +
   "diario:diário diaria:diária inicio:início termino:término conclusao:conclusão raciocinio:raciocínio criterio:critério " +
   "criterios:critérios codigo:código codigos:códigos area:área areas:áreas topico:tópico topicos:tópicos nivel:nível niveis:níveis " +
   "carater:caráter frequencia:frequência duracao:duração irradiacao:irradiação localizacao:localização alivio:alívio " +
   "evolucao:evolução complicacao:complicação complicacoes:complicações recuperacao:recuperação reabilitacao:reabilitação " +
   "prevencao:prevenção vacinacao:vacinação classificacao:classificação funcao:função funcoes:funções disfuncao:disfunção " +
   "insuficiencia:insuficiência deficiencia:deficiência falencia:falência septico:séptico septica:séptica hemodinamico:hemodinâmico " +
   "hemodinamica:hemodinâmica instavel:instável instaveis:instáveis estavel:estável estaveis:estáveis obvio:óbvio evidencia:evidência " +
   "evidencias:evidências referencia:referência referencias:referências recomendacao:recomendação recomendacoes:recomendações " +
   "indicacao:indicação indicacoes:indicações contraindicacao:contraindicação contraindicacoes:contraindicações precaucao:precaução " +
   "mecanica:mecânica mecanico:mecânico fibrinolise:fibrinólise trombolise:trombólise revascularizacao:revascularização " +
   "cardioversao:cardioversão desfibrilacao:desfibrilação fibrilacao:fibrilação ventriculo:ventrículo ventriculos:ventrículos " +
   "atrio:átrio atrios:átrios valvula:válvula valvulas:válvulas aortico:aórtico aortica:aórtica tricuspide:tricúspide " +
   "sistolico:sistólico sistolica:sistólica diastolico:diastólico diastolica:diastólica eletrico:elétrico eletrica:elétrica " +
   "derivacao:derivação derivacoes:derivações ritmico:rítmico miocardio:miocárdio pericardio:pericárdio endocardio:endocárdio " +
   "coronaria:coronária coronarias:coronárias dissecao:dissecção embolo:êmbolo ulcera:úlcera ulceras:úlceras gastrico:gástrico " +
   "gastrica:gástrica hepatico:hepático hepatica:hepática urinario:urinário urinaria:urinária vesicula:vesícula pancreas:pâncreas " +
   "pancreatico:pancreático apendice:apêndice colon:cólon esofago:esôfago bronquio:brônquio bronquios:brônquios alveolo:alvéolo " +
   "glandula:glândula hormonio:hormônio hormonios:hormônios endocrino:endócrino metabolico:metabólico metabolica:metabólica " +
   "diabetico:diabético diabetica:diabética nutricao:nutrição alimentacao:alimentação hidratacao:hidratação desidratacao:desidratação " +
   "imunologico:imunológico alergico:alérgico alergica:alérgica reacao:reação reacoes:reações toxico:tóxico toxica:tóxica " +
   "intoxicacao:intoxicação alcool:álcool alcoolico:alcoólico ilicito:ilícito ilicita:ilícita ilicitas:ilícitas violencia:violência " +
   "agressao:agressão negligencia:negligência juridico:jurídico resolucao:resolução midia:mídia midias:mídias ambulancia:ambulância " +
   "remocao:remoção transferencia:transferência admissao:admissão observacao:observação monitorizacao:monitorização " +
   "cenario:cenário cenarios:cenários estacao:estação estacoes:estações discussao:discussão discussoes:discussões " +
   "pontuacao:pontuação conteudo:conteúdo conteudos:conteúdos titulo:título titulos:títulos subtitulo:subtítulo " +
   "paragrafo:parágrafo paragrafos:parágrafos pagina:página paginas:páginas versao:versão versoes:versões revisao:revisão " +
   "revisoes:revisões edicao:edição aplicacao:aplicação publicacao:publicação questao:questão questoes:questões solucao:solução " +
   "solucoes:soluções razao:razão razoes:razões opiniao:opinião sugestao:sugestão sugestoes:sugestões intencao:intenção " +
   "atuacao:atuação participacao:participação apresentacao:apresentação sessao:sessão sessoes:sessões reuniao:reunião " +
   "regiao:região regioes:regiões posicao:posição posicoes:posições direcao:direção distancia:distância circunstancia:circunstância " +
   "circunstancias:circunstâncias importancia:importância relevancia:relevância presenca:presença ausencia:ausência " +
   "existencia:existência experiencia:experiência experiencias:experiências ciencia:ciência consequencia:consequência " +
   "consequencias:consequências sequencia:sequência tendencia:tendência independencia:independência competencia:competência " +
   "competencias:competências didatico:didático didatica:didática academico:acadêmico academica:acadêmica residencia:residência " +
   "plantao:plantão plantoes:plantões profissao:profissão orgao:órgão orgaos:órgãos mao:mão maos:mãos joelhos:joelhos " +
   "lingua:língua idade:idade saudavel:saudável saudaveis:saudáveis agradavel:agradável confortavel:confortável " +
   "vulneravel:vulnerável vulneraveis:vulneráveis aceitavel:aceitável inaceitavel:inaceitável lamentavel:lamentável " +
   "periodico:periódico periodica:periódica sintomatico:sintomático assintomatico:assintomático assintomatica:assintomática " +
   "febril:febril oxigenacao:oxigenação perfusao:perfusão hipoxemia:hipoxemia taquipneia:taquipneia ecocardiografico:ecocardiográfico " +
   "radiologico:radiológico radiologica:radiológica eletrocardiografico:eletrocardiográfico laboratoriais:laboratoriais " +
   "domicilio:domicílio hospitalizacao:hospitalização obstrucao:obstrução dilatacao:dilatação contracao:contração " +
   "regurgitacao:regurgitação estenose:estenose aneurisma:aneurisma hemorragico:hemorrágico hemorragica:hemorrágica " +
   "traumatico:traumático traumatica:traumática fratura:fratura queimadura:queimadura reposicao:reposição infusao:infusão " +
   "solucao:solução cloreto:cloreto bicarbonato:bicarbonato glicemico:glicêmico glicemica:glicêmica proteina:proteína " +
   "proteinas:proteínas vitamina:vitamina nucleo:núcleo genetico:genético genetica:genética hereditario:hereditário " +
   "hereditaria:hereditária congenito:congênito congenita:congênita familiares:familiares pais:pais").split(" ").forEach(function (par) {
    var i = par.indexOf(":"); if (i < 1) return;
    var a = par.slice(0, i), b = par.slice(i + 1);
    if (a !== b) DIC[a] = b;
  });
  function comCaixa(orig, novo) {
    if (orig === orig.toUpperCase() && orig.length > 1) return novo.toUpperCase();
    if (orig.charAt(0) === orig.charAt(0).toUpperCase()) return novo.charAt(0).toUpperCase() + novo.slice(1);
    return novo;
  }
  function corrigirPalavra(p) {
    if (p.length > 1 && p === p.toUpperCase()) return null; // sigla (HA, POS, PRE): fica como está
    var n = DIC[p.toLowerCase()]; return n ? comCaixa(p, n) : null;
  }
  function autocorrigir() {
    var r = selecaoNoCampo();
    if (!r || !r.collapsed || r.startContainer.nodeType !== 3) return;
    var tn = r.startContainer, off = r.startOffset, antes = tn.nodeValue.slice(0, off);
    var m = /(^|[^A-Za-zÀ-ÿ\-'])([A-Za-z]+)$/.exec(antes);
    if (!m) return;
    var palavra = m[2], nova = corrigirPalavra(palavra);
    if (!nova) return;
    var w = document.createRange(); w.setStart(tn, off - palavra.length); w.setEnd(tn, off);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(w);
    document.execCommand("insertText", false, nova); // entra no desfazer do navegador (⌘+Z volta a palavra)
  }

  /* ---------- 10.5 Ditado por voz ---------- */
  var reconhecedor = null;
  function pararDitado() {
    if (!reconhecedor) return;
    var r = reconhecedor; reconhecedor = null;
    try { r.stop(); } catch (e) { /* nada */ }
    atualizarFerramentas();
  }
  function alternarDitado() {
    if (reconhecedor) { pararDitado(); mensagem("Ditado parado."); return; }
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      perguntar("Ditado por voz indisponível", "Este navegador não oferece ditado por voz para páginas. Use o ditado do próprio Mac: clique no texto e aperte a tecla Fn duas vezes (Ajustes do Sistema › Teclado › Ditado).", [{ rotulo: "Entendi", valor: null, primario: true }]);
      return;
    }
    if (!inl) { mensagem("Clique no texto onde quer ditar e depois toque em Ditar.", "erro"); return; }
    var alvo = inl, faixa = selecaoNoCampo();
    faixa = faixa ? faixa.cloneRange() : null;
    var avisado = false;
    try { avisado = sessionStorage.getItem(CHAVE_DITADO) === "1"; } catch (e) { /* nada */ }
    alvo.segurar = true;
    var ok = avisado ? Promise.resolve("sim") : perguntar("Ditar por voz?",
      "O material das estações é confidencial. O áudio do ditado é processado pelo serviço de voz do navegador (no Chrome, em servidores do Google; no Safari, da Apple). " +
      "Se preferir que nada saia do computador, use o ditado do próprio Mac: clique no texto e aperte a tecla Fn duas vezes.", [
        { rotulo: "Ditar mesmo assim", valor: "sim", primario: true },
        { rotulo: "Cancelar", valor: null }
      ]);
    ok.then(function (resp) {
      alvo.segurar = false;
      if (inl !== alvo || !alvo.no.isConnected) return;
      alvo.no.focus({ preventScroll: true });
      if (faixa) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(faixa); }
      if (resp !== "sim") return;
      try { sessionStorage.setItem(CHAVE_DITADO, "1"); } catch (e) { /* nada */ }
      var rec = new SR();
      rec.lang = "pt-BR"; rec.continuous = true; rec.interimResults = false;
      rec.onresult = function (ev) {
        if (inl !== alvo) return;
        for (var k = ev.resultIndex; k < ev.results.length; k++) {
          if (!ev.results[k].isFinal) continue;
          var t = String(ev.results[k][0].transcript || "").trim();
          if (!t) continue;
          var r = selecaoNoCampo();
          var antes = r && r.startContainer.nodeType === 3 ? r.startContainer.nodeValue.slice(0, r.startOffset) : "";
          if (antes && !/\s$/.test(antes)) t = " " + t;
          document.execCommand("insertText", false, t);
        }
      };
      rec.onerror = function (ev) {
        mensagem(ev.error === "not-allowed" ? "O navegador não deixou usar o microfone. Libere o microfone para esta página e tente de novo." : "Ditado interrompido (" + ev.error + ").", "erro");
      };
      rec.onend = function () { if (reconhecedor === rec) { reconhecedor = null; atualizarFerramentas(); } };
      try { rec.start(); reconhecedor = rec; mensagem("Ditando… fale perto do microfone. Toque em Ditar de novo para parar."); }
      catch (e) { mensagem("Não foi possível iniciar o ditado: " + e.message, "erro"); }
      atualizarFerramentas();
    });
  }

  /* ---------- 10.6 Tabelas: linhas e colunas a partir de uma célula ---------- */
  function infoCelula(c) {
    if (!c) return null;
    var m = /^(.+)\.linhas\.(\d+)\.(\d+)$/.exec(c);
    if (m) return { tabela: m[1], linha: Number(m[2]), col: Number(m[3]), cab: false };
    m = /^(.+)\.cabecalho\.(\d+)$/.exec(c);
    if (m) return { tabela: m[1], linha: -1, col: Number(m[2]), cab: true };
    return null;
  }
  function opTabela(op) {
    var cel = infoCelula(celulaAtual);
    if (!cel || !sessao) { mensagem("Clique numa célula da tabela primeiro.", "erro"); return Promise.resolve(false); }
    return confirmarTexto().then(function () {
      fecharPopover(true);
      if (!sessao) return false;
      var nomes = { "linha+": "Linha acrescentada abaixo.", "coluna+": "Coluna acrescentada à direita.", "linha-": "Linha retirada.", "coluna-": "Coluna retirada." };
      return mudar(function (d) {
        var t = obter(d, cel.tabela);
        if (!t || typeof t !== "object" || !Array.isArray(t.linhas)) throw new Error("tabela não encontrada");
        var ncol = Array.isArray(t.cabecalho) ? t.cabecalho.length : 0;
        t.linhas.forEach(function (l) { if (Array.isArray(l)) ncol = Math.max(ncol, l.length); });
        ncol = Math.max(ncol, 1);
        if (cel.col >= ncol) throw new Error("a célula não existe mais");
        if (op === "linha+") {
          var nova = []; for (var k = 0; k < ncol; k++) nova.push("");
          t.linhas.splice(cel.cab ? 0 : cel.linha + 1, 0, nova);
        } else if (op === "coluna+") {
          if (Array.isArray(t.cabecalho)) t.cabecalho.splice(cel.col + 1, 0, "");
          t.linhas.forEach(function (l) { if (Array.isArray(l)) l.splice(Math.min(cel.col + 1, l.length), 0, ""); });
        } else if (op === "linha-") {
          if (cel.cab) throw new Error("o cabeçalho não é uma linha; para tirá-lo, use o balão (⋯)");
          if (t.linhas.length <= 1) throw new Error("a tabela precisa de pelo menos uma linha");
          t.linhas.splice(cel.linha, 1);
        } else if (op === "coluna-") {
          if (ncol <= 1) throw new Error("a tabela precisa de pelo menos uma coluna");
          if (Array.isArray(t.cabecalho)) t.cabecalho.splice(cel.col, 1);
          t.linhas.forEach(function (l) { if (Array.isArray(l) && cel.col < l.length) l.splice(cel.col, 1); });
        }
      }, { ref: cel.tabela }).then(function (ok) {
        if (ok) mensagem(nomes[op] + " " + TECLA + "+Z desfaz.", "ok");
        if (op === "linha-" || op === "coluna-") celulaAtual = null;
        atualizarFerramentas();
        return ok;
      });
    });
  }

  /* ---------- 10.7 Barra de ferramentas (topo da área do documento) ---------- */
  var F = {};
  function montarFerramentas() {
    var area = $("area-doc"), doc = $("documento");
    if (!area || !doc || F.no) return;
    var bar = el("div", "ed-ferramentas");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Formatação e ferramentas do modo edição");
    // os botões não tiram o foco do texto em edição
    bar.addEventListener("mousedown", function (ev) { if (!ev.target.closest("input, select, label")) ev.preventDefault(); });
    function grupo() { var g = el("div", "ed-f-grupo"); bar.appendChild(g); return g; }
    var g1 = grupo();
    F.n = botao("N", "mini ed-f-n", function () { formatar("negrito"); }, "Negrito (" + TECLA + "+B)");
    F.i = botao("I", "mini ed-f-i", function () { formatar("italico"); }, "Itálico (" + TECLA + "+I)");
    F.destacar = botao("Destacar", "mini ed-f-destacar", function () { formatar("destacar"); }, "Destacar em amarelo o que está selecionado; se já estiver destacado, tira");
    F.tirar = botao("Tirar destaque", "mini", function () { formatar("tirar-destaque"); }, "Tirar o destaque do que está selecionado");
    F.cor = botao("Cor ▾", "mini", function () { F.menuCor.hidden = !F.menuCor.hidden; F.cor.setAttribute("aria-expanded", F.menuCor.hidden ? "false" : "true"); }, "Cor da letra do que está selecionado");
    F.cor.setAttribute("aria-haspopup", "true"); F.cor.setAttribute("aria-expanded", "false");
    var envCor = el("span", "ed-f-cor");
    F.menuCor = el("div", "ed-cor-menu"); F.menuCor.hidden = true; F.menuCor.setAttribute("role", "menu");
    CORES_TEXTO.forEach(function (c) {
      var b = botao("", "ed-cor-op md-cor-" + c[0], function () { F.menuCor.hidden = true; formatar("cor:" + c[0]); }, c[1]);
      b.setAttribute("role", "menuitem"); b.setAttribute("aria-label", "Cor " + c[1]);
      b.appendChild(el("span", "ed-cor-amostra md-cor-" + c[0], "A"));
      b.appendChild(document.createTextNode(" " + c[1]));
      F.menuCor.appendChild(b);
    });
    var sem = botao("Sem cor", "ed-cor-op", function () { F.menuCor.hidden = true; formatar("sem-cor"); }, "Volta à cor normal do texto");
    sem.setAttribute("role", "menuitem");
    F.menuCor.appendChild(sem);
    envCor.appendChild(F.cor); envCor.appendChild(F.menuCor);
    [F.n, F.i, F.destacar, F.tirar, envCor].forEach(function (b) { g1.appendChild(b); });

    var g2 = grupo();
    var lab = el("label", "ed-f-chk");
    F.autocorr = el("input"); F.autocorr.type = "checkbox"; F.autocorr.checked = autocorrecao;
    F.autocorr.addEventListener("change", function () { autocorrecao = F.autocorr.checked; gravarPref(CHAVE_AUTOCORR, autocorrecao ? "1" : "0"); if (inl) inl.no.focus({ preventScroll: true }); });
    lab.appendChild(F.autocorr); lab.appendChild(document.createTextNode(" Autocorreção"));
    lab.title = "Corrige os acentos ao terminar cada palavra (nao → não). " + TECLA + "+Z desfaz a correção.";
    g2.appendChild(lab);
    F.ditar = botao("🎙 Ditar", "mini", alternarDitado, "Ditar por voz onde está o cursor. Toque de novo para parar.");
    g2.appendChild(F.ditar);

    F.tabela = grupo(); F.tabela.classList.add("ed-f-tabela");
    F.tabela.appendChild(el("span", "ed-f-rot", "Tabela:"));
    F.tabela.appendChild(botao("+ Linha abaixo", "mini", function () { opTabela("linha+"); }, "Acrescentar uma linha abaixo da célula em que está o cursor"));
    F.tabela.appendChild(botao("+ Coluna à direita", "mini", function () { opTabela("coluna+"); }, "Acrescentar uma coluna à direita da célula em que está o cursor"));
    F.tabela.appendChild(botao("− Linha", "mini perigo", function () { opTabela("linha-"); }, "Tirar a linha em que está o cursor"));
    F.tabela.appendChild(botao("− Coluna", "mini perigo", function () { opTabela("coluna-"); }, "Tirar a coluna em que está o cursor"));

    var g4 = grupo(); g4.classList.add("ed-f-modo");
    F.modo = botao("Modo formulário", "mini", function () { definirModoTexto(!modoTexto); }, "Alternar entre escrever direto no documento e editar pelo balão (formulário)");
    g4.appendChild(F.modo);

    document.addEventListener("mousedown", function (ev) { if (!F.menuCor.hidden && !envCor.contains(ev.target)) F.menuCor.hidden = true; }, true);
    area.insertBefore(bar, doc);
    F.no = bar;
    atualizarFerramentas();
  }
  function definirModoTexto(v) {
    modoTexto = !!v;
    gravarPref(CHAVE_MODO, modoTexto ? "texto" : "formulario");
    if (!modoTexto) confirmarTexto();
    mensagem(modoTexto ? "Modo texto: clique e escreva direto no documento." : "Modo formulário: o clique abre o balão de edição.");
    atualizarFerramentas();
  }
  function atualizarFerramentas() {
    if (!F.no) return;
    var editando = !!inl;
    [F.n, F.i, F.destacar, F.tirar, F.cor].forEach(function (b) { b.disabled = !editando; });
    F.ditar.textContent = reconhecedor ? "● Parar ditado" : "🎙 Ditar";
    F.ditar.setAttribute("aria-pressed", reconhecedor ? "true" : "false");
    F.ditar.classList.toggle("ed-gravando", !!reconhecedor);
    F.modo.setAttribute("aria-pressed", modoTexto ? "false" : "true");
    // ações de tabela só enquanto o cursor está numa célula (no balão de uma célula elas aparecem nele)
    F.tabela.hidden = !(inl && infoCelula(inl.caminho));
    if (P.modoForm) P.modoForm.textContent = modoTexto ? "Modo formulário" : "Modo texto";
  }

  /* ---------- 10.8 Barra do bloco (passar o mouse) e "+" entre blocos ---------- */
  var B = { no: null, mais: null, ind: null, n: null, alvo: null, base: null, timer: null, arrastando: null, dest: null };
  var TIPO_OK = {}; TIPOS_BLOCO.forEach(function (t) { TIPO_OK[t[0]] = t[1]; });
  function montarBarraBloco() {
    var area = $("area-doc");
    if (!area || B.no) return;
    var bar = el("div", "ed-barra-bloco"); bar.hidden = true;
    bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Ações do bloco");
    B.alca = el("span", "ed-alca", "⠿"); B.alca.draggable = true; B.alca.title = "Arrastar para mover"; B.alca.setAttribute("aria-hidden", "true");
    B.subir = botao("▲", "mini", function () { if (B.n) opBloco("cima", B.n); }, "Subir");
    B.descer = botao("▼", "mini", function () { if (B.n) opBloco("baixo", B.n); }, "Descer");
    B.tipo = el("select", "ed-tipo-bloco"); B.tipo.title = "Tipo do bloco"; B.tipo.setAttribute("aria-label", "Tipo do bloco");
    TIPOS_BLOCO.forEach(function (t) { var o = el("option", null, t[1]); o.value = t[0]; B.tipo.appendChild(o); });
    B.tipo.addEventListener("change", function () { if (B.n) opBloco("tipo", B.n, { tipo: B.tipo.value }); });
    B.dup = botao("Duplicar", "mini", function () { if (B.n) opBloco("duplicar", B.n); }, "Duplicar este bloco");
    B.tirarB = botao("Tirar", "mini perigo", function () { if (B.n) opBloco("excluir", B.n); }, "Tirar este bloco (" + TECLA + "+Z desfaz)");
    B.form = botao("⋯", "mini", function () {
      var alvo = B.alvo && B.alvo.isConnected ? B.alvo : (B.base ? primeiroDe(B.base) : null);
      esconderBarra(true);
      if (alvo) confirmarTexto().then(function () { var n2 = alvo.isConnected ? alvo : primeiroDe(alvo.getAttribute("data-ed")); if (n2) abrirPopover(n2, n2.getAttribute("data-ed"), false); });
    }, "Abrir o balão (formulário) deste trecho");
    [B.alca, B.subir, B.descer, B.tipo, B.dup, B.tirarB, B.form].forEach(function (b) { bar.appendChild(b); });
    bar.addEventListener("mouseenter", function () { clearTimeout(B.timer); });
    bar.addEventListener("mouseleave", function () { esconderBarra(false); });
    var mais = botao("+", "ed-mais", function () { if (B.n) opBloco("inserir", B.n); }, "Acrescentar um bloco aqui");
    mais.setAttribute("aria-label", "Acrescentar um bloco aqui"); mais.hidden = true;
    mais.addEventListener("mouseenter", function () { clearTimeout(B.timer); });
    mais.addEventListener("mouseleave", function () { esconderBarra(false); });
    var ind = el("div", "ed-indicador"); ind.hidden = true; ind.setAttribute("aria-hidden", "true");
    B.alca.addEventListener("dragstart", function (ev) {
      if (!B.n) { ev.preventDefault(); return; }
      B.arrastando = { arr: B.n.arr, i: B.n.i, nome: B.n.nome };
      ev.dataTransfer.effectAllowed = "move";
      try { ev.dataTransfer.setData("text/plain", "bloco"); } catch (e) { /* nada */ }
      var caixa = caixaDe(B.base);
      if (caixa && caixa.primeiro) try { ev.dataTransfer.setDragImage(caixa.primeiro, 10, 10); } catch (e) { /* nada */ }
    });
    B.alca.addEventListener("dragend", function () { B.arrastando = null; B.dest = null; ind.hidden = true; });
    area.appendChild(bar); area.appendChild(mais); area.appendChild(ind);
    B.no = bar; B.mais = mais; B.ind = ind;
  }
  /* todos os elementos do bloco (caminho exato ou descendente) e seus limites */
  function caixaDe(base) {
    if (!base) return null;
    var lst = Array.prototype.filter.call($("documento").querySelectorAll("[data-ed]"), function (n) {
      var d = n.getAttribute("data-ed");
      return d === base || d.indexOf(base + ".") === 0;
    });
    if (!lst.length) return null;
    var r0 = lst[0].getBoundingClientRect(), r1 = lst[lst.length - 1].getBoundingClientRect();
    var esq = Infinity;
    lst.forEach(function (n) { var r = n.getBoundingClientRect(); if (r.width || r.height) esq = Math.min(esq, r.left); });
    return { primeiro: lst[0], topo: r0.top, esq: isFinite(esq) ? esq : r0.left, base: r1.bottom };
  }
  function nivelDoBloco(c) {
    if (!sessao) return null;
    var nv = niveis(sessao.entrada.dados, c);
    return nv.filter(function (n) { return n.bloco; })[0] || nv[0] || null;
  }
  function noArea(x, y) {
    var area = $("area-doc"), ra = area.getBoundingClientRect();
    return { x: x - ra.left + area.scrollLeft, y: y - ra.top + area.scrollTop };
  }
  function mostrarBarra(alvo, c) {
    if (!B.no || !modo || B.arrastando) return;
    var n = nivelDoBloco(c);
    if (!n) { esconderBarra(false); return; }
    clearTimeout(B.timer);
    var base = n.arr + "." + n.i;
    B.alvo = alvo;
    if (B.base === base && !B.no.hidden) return;
    var cx = caixaDe(base);
    if (!cx) { esconderBarra(true); return; }
    B.n = n; B.base = base;
    var elem = obter(sessao.entrada.dados, base);
    var tipo = elem && typeof elem === "object" && !Array.isArray(elem) ? elem.tipo : null;
    B.tipo.hidden = !(n.bloco && TIPO_OK[tipo]);
    if (!B.tipo.hidden) B.tipo.value = tipo;
    B.subir.disabled = n.i === 0;
    B.descer.disabled = n.i >= n.tamanho - 1;
    var nome = n.nome.charAt(0).toUpperCase() + n.nome.slice(1);
    B.no.setAttribute("aria-label", "Ações: " + nome + " " + (n.i + 1) + " de " + n.tamanho);
    B.dup.title = "Duplicar este " + n.nome; B.tirarB.title = "Tirar este " + n.nome + " (" + TECLA + "+Z desfaz)";
    B.mais.title = "Acrescentar " + (n.bloco ? "um bloco" : "um " + n.nome) + " abaixo deste";
    B.no.hidden = false;
    var p = noArea(cx.esq, cx.topo);
    var h = B.no.offsetHeight || 26;
    var area = $("area-doc");
    B.no.style.left = Math.max(area.scrollLeft + 4, p.x - 2) + "px";
    B.no.style.top = Math.max(area.scrollTop + (F.no ? F.no.offsetHeight : 0) + 2, p.y - h - 3) + "px";
    var pb = noArea(cx.esq, cx.base);
    B.mais.hidden = false;
    B.mais.style.left = Math.max(area.scrollLeft + 4, pb.x - 26) + "px";
    B.mais.style.top = (pb.y - 9) + "px";
  }
  function esconderBarra(agora) {
    if (!B.no) return;
    clearTimeout(B.timer);
    var fim = function () { B.no.hidden = true; B.mais.hidden = true; B.n = null; B.base = null; B.alvo = null; };
    if (agora) fim(); else B.timer = setTimeout(fim, 450);
  }
  /* o que a troca de tipo descarta (vai para a mensagem; ⌘Z desfaz) */
  function perdasConversao(b, novo) {
    var p = [];
    if (!b || typeof b !== "object") return p;
    if (typeof b.gatilho === "string" && b.gatilho.trim() && novo !== "fala") p.push("o gatilho da fala");
    if (Array.isArray(b.itens) && b.itens.some(function (x) { return x && typeof x === "object" && Array.isArray(x.subitens) && x.subitens.length; })) p.push("os subitens da lista");
    if (b.ordenada && novo !== "lista") p.push("a numeração da lista");
    Object.keys(b).forEach(function (k) {
      if (!/^(tipo|texto|itens|gatilho|refs|ordenada)$/.test(k) && b[k] != null && b[k] !== "") p.push("o campo “" + k + "”");
    });
    return p;
  }
  function converterBloco(b, novo) {
    var texto = typeof b.texto === "string" ? b.texto :
      Array.isArray(b.itens) ? b.itens.map(function (x) { return typeof x === "string" ? x : (x && typeof x.texto === "string" ? x.texto : ""); }).filter(Boolean).join("\n") : "";
    var o;
    if (novo === "lista") {
      var itens = texto.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
      o = { tipo: "lista", itens: itens.length ? itens : ["Novo item."] };
    } else {
      o = { tipo: novo, texto: texto || (novo === "subtitulo" ? "NOVO SUBTÍTULO" : "Novo texto.") };
      if (novo === "fala" && typeof b.gatilho === "string") o.gatilho = b.gatilho;
    }
    if (Array.isArray(b.refs)) o.refs = b.refs.slice();
    return o;
  }
  /* operações da barra do bloco: n = { arr, i, nome, bloco } */
  function opBloco(op, n, extra) {
    esconderBarra(true);
    return confirmarTexto().then(function () {
      if (!sessao) return false;
      fecharPopover(true);
      var a0 = obter(sessao.entrada.dados, n.arr);
      if (!Array.isArray(a0) || n.i >= a0.length) { mensagem("Esse " + n.nome + " não está mais lá.", "erro"); return false; }
      var ref = n.arr + "." + n.i, alvo = ref, fixar = null, para = null;
      if (op === "inserir" || op === "duplicar") { alvo = n.arr + "." + (n.i + 1); fixar = "ref"; }
      else if (op === "cima") alvo = n.arr + "." + (n.i - 1);
      else if (op === "baixo") alvo = n.arr + "." + (n.i + 1);
      else if (op === "mover") { para = extra.para > n.i ? extra.para - 1 : extra.para; if (para === n.i) return false; alvo = n.arr + "." + para; }
      else if (op === "excluir") alvo = null;
      var perdas = op === "tipo" ? perdasConversao(a0[n.i], extra.tipo) : [];
      return mudar(function (d) {
        var a = obter(d, n.arr);
        if (!Array.isArray(a) || n.i >= a.length) throw new Error("item não encontrado");
        var it = a[n.i];
        if (op === "inserir") a.splice(n.i + 1, 0, n.bloco ? blocoModelo("paragrafo") : copiaVazia(it, ultimaChave(n.arr)));
        else if (op === "duplicar") a.splice(n.i + 1, 0, JSON.parse(JSON.stringify(it)));
        else if (op === "cima") { if (n.i === 0) return false; a[n.i] = a[n.i - 1]; a[n.i - 1] = it; }
        else if (op === "baixo") { if (n.i >= a.length - 1) return false; a[n.i] = a[n.i + 1]; a[n.i + 1] = it; }
        else if (op === "mover") { a.splice(n.i, 1); a.splice(para, 0, it); }
        else if (op === "excluir") a.splice(n.i, 1);
        else if (op === "tipo") { if (!it || it.tipo === extra.tipo) return false; a[n.i] = converterBloco(it, extra.tipo); }
      }, { ref: ref, alvo: alvo, fixar: fixar }).then(function (ok) {
        if (!ok) return false;
        var textos = { inserir: "Acrescentado", duplicar: "Duplicado", cima: "Subiu", baixo: "Desceu", mover: "Movido", excluir: "Tirado", tipo: "Tipo trocado" };
        mensagem(textos[op] + ": " + n.nome + "." + (perdas.length ? " Foi descartado: " + perdas.join(", ") + "." : "") +
          (op === "excluir" || op === "tipo" ? " " + TECLA + "+Z desfaz." : ""), perdas.length ? "erro" : "ok");
        if (op === "inserir") {
          var novo = primeiroDe(alvo);
          if (novo) {
            var cn = novo.getAttribute("data-ed");
            if (!(modoTexto && podeEditarNoTexto(novo, cn) && iniciarTexto(novo, cn, null, true))) abrirPopover(novo, cn, true);
          }
        }
        return true;
      });
    });
  }
  /* arrastar pelo ⠿: o bloco cai antes ou depois de um irmão do mesmo array */
  function aoArrastarSobre(ev) {
    var g = B.arrastando;
    if (!g) return;
    var t = ev.target && ev.target.closest ? ev.target.closest("[data-ed]") : null;
    var c = t ? t.getAttribute("data-ed") : null;
    if (!c || c.indexOf(g.arr + ".") !== 0) { B.ind.hidden = true; B.dest = null; return; }
    var idx = Number(c.slice(g.arr.length + 1).split(".")[0]);
    if (!isFinite(idx)) return;
    var cx = caixaDe(g.arr + "." + idx);
    if (!cx) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    // antes ou depois pelo pedaço sob o mouse (um bloco pode estar dividido entre páginas)
    var rt = t.getBoundingClientRect();
    var antes = ev.clientY < (rt.top + rt.bottom) / 2;
    B.dest = antes ? idx : idx + 1;
    var p = noArea(cx.esq, antes ? cx.topo : cx.base);
    B.ind.hidden = false;
    B.ind.style.left = (p.x - 6) + "px";
    B.ind.style.top = (p.y - 2) + "px";
    B.ind.style.width = Math.max(120, Math.min(720, $("documento").getBoundingClientRect().right - cx.esq - 30)) + "px";
  }
  function aoSoltar(ev) {
    var g = B.arrastando;
    if (!g) return;
    ev.preventDefault();
    B.ind.hidden = true;
    var para = B.dest;
    B.arrastando = null; B.dest = null;
    if (para == null || para === g.i || para === g.i + 1) return;
    var a = sessao ? obter(sessao.entrada.dados, g.arr) : null;
    opBloco("mover", { arr: g.arr, i: g.i, nome: g.nome, bloco: false, tamanho: Array.isArray(a) ? a.length : 0 }, { para: para });
  }
  function abrirNoModo(no, c, pt) {
    if (modoTexto && podeEditarNoTexto(no, c) && iniciarTexto(no, c, pt, false)) return;
    abrirPopover(no, c, false);
  }

  /* ------------------------------------------------------------------
   * 9. Liga/desliga, troca de estação, teclado, beforeunload
   * ------------------------------------------------------------------ */
  function alternarModo(ligar) {
    if (ligar === modo) return Promise.resolve(true);
    if (!ligar && (inl || inlConfirmando)) return confirmarTexto().then(function () { return alternarModo(false); });
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
      cancelarTexto();
      pararDitado();
      esconderBarra(true);
      celulaAtual = null;
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
    if (inl || inlConfirmando) return confirmarTexto().then(function () { return antesDeTrocar(chaveNova); });
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
    cancelarTexto();
    esconderBarra(true);
    celulaAtual = null;
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
    if (inl && !inl.no.isConnected) retomarTexto();
    esconderBarra(true);
    atualizarFerramentas();
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
    montarFerramentas();
    montarBarraBloco();
    var bt = $("btn-editar");
    if (bt) {
      bt.disabled = !(App() && App().atual());
      bt.addEventListener("click", function () { alternarModo(!modo); });
    }
    var doc = $("documento");
    doc.addEventListener("mouseover", aoPassar);
    doc.addEventListener("mouseleave", limparHover);
    doc.addEventListener("click", aoClicarDoc, true);
    doc.addEventListener("dragover", aoArrastarSobre);
    doc.addEventListener("drop", aoSoltar);
    doc.addEventListener("mouseleave", function () { esconderBarra(false); });
    document.addEventListener("mousedown", aoClicarFora, true);
    document.addEventListener("keydown", aoTeclar);
    document.addEventListener("estacao-selecionada", aoSelecionar);
    document.addEventListener("estacao-renderizada", aoRenderizar);
    $("area-doc").addEventListener("scroll", function () { if (pop) posicionarPopover(); }, { passive: true });
    window.addEventListener("resize", function () { if (pop) posicionarPopover(); });
    window.addEventListener("beforeprint", function () { fecharPopover(true); confirmarTexto(); esconderBarra(true); limparHover(); });
    window.addEventListener("beforeunload", function (ev) {
      if (!pendente() && !textoAlterado()) return;
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
      copiaVazia: copiaVazia,
      serializar: serializar,
      normalizado: normalizado,
      confere: confere,
      corrigirPalavra: corrigirPalavra,
      editarTexto: function (caminho) { var n = primeiroDe(caminho); return !!(n && podeEditarNoTexto(n, caminho) && iniciarTexto(n, caminho, null, false)); },
      confirmarTexto: confirmarTexto,
      cancelarTexto: cancelarTexto,
      formatar: formatar,
      opBloco: function (op, caminho, extra) { var n = nivelDoBloco(caminho); return n ? opBloco(op, n, extra) : Promise.resolve(false); },
      opTabela: function (op, celula) { if (celula) celulaAtual = celula; return opTabela(op); },
      modoTexto: function (v) { if (v != null) definirModoTexto(v); return modoTexto; }
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
