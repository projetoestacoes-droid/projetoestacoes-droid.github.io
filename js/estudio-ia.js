/* =====================================================================
 * estudio-ia.js — Aba "IA: gerar e importar" do ESTÚDIO online.
 *
 * Formulário igual ao "Nova estação" do visualizador local (app/js/pedido.js):
 * banca, área, dia (Einstein), tema, ideia, foco de soft skills e referências de
 * soft skills (Einstein e Sírio-Libanês), observações e referências técnicas.
 *
 * Fluxo: referências → bucket privado "referencias" (pedidos/<id>/tecnicas|soft-skills/<arquivo>)
 *   → gerar_criar_pedido(p_dados) → função do servidor gerar-estacao {acao:"enviar"}
 *   → lista de pedidos com "Verificar agora" ({acao:"verificar"}) → quando concluído,
 *   a estação aparece no estúdio como RASCUNHO (origem "gerada") e o pedido ganha
 *   o link "Abrir no estúdio".
 * Sem a chave ANTHROPIC_API_KEY no Supabase, a função responde 503 e a aba avisa.
 *
 * "Quem gera" (migração 010): "Claude Code no meu computador" (PADRÃO, sem custo de API) ou
 * "API da Anthropic". Com o Claude Code, o pedido é criado (referências no bucket, como antes)
 * com executor "claude_code" e a função NÃO é chamada: o pedido fica "Aguardando o Claude Code"
 * até o Alexandre abrir o Claude Code na pasta do projeto e dizer "processar pedidos pendentes"
 * (ver o guia do Claude Code no repositório privado). Pedidos
 * parados ("aguardando"/"erro") trocam de executor pela RPC gerar_definir_executor — é assim que
 * um pedido de importar PDF (criado pela API) vai para o Claude Code ("Gerar pelo Claude Code").
 *
 * A lista mostra também os pedidos tipo "importar" (PDF transcrito pela IA, criados
 * em "Importar arquivos…" por estudio-importar.js): arquivo, páginas e um botão
 * "Abrir no estúdio" para cada estação criada (estacao_ids).
 * ===================================================================== */
(function () {
  "use strict";
  var E = window.Estudio;
  if (!E) return;
  var ui = E.ui, el = ui.el;

  var BANCAS = [["einstein", "Einstein"], ["sirio-libanes", "Sírio-Libanês"], ["usp-ribeirao", "USP Ribeirão"],
    ["unifesp-r1", "Unifesp R1"], ["unifesp-rmais", "Unifesp R+"], ["tradicional", "Tradicional"]];
  var AREAS = ["Clínica Médica", "Cirurgia Geral", "Ginecologia e Obstetrícia", "Pediatria", "Preventiva"];
  var AREA_PROC = "Procedimento";
  var COM_SOFT = { "einstein": true, "sirio-libanes": true };
  // DOCX não é lido pela IA (a função só anexa PDF, imagem e texto): não é aceito aqui.
  var ACEITOS = /\.(pdf|txt|png|jpe?g|webp)$/i;
  // Limite por pedido, somando técnicas + soft skills (o mesmo da função gerar-estacao:
  // 23 MB de arquivos ≈ 31 MB em base64, dentro dos 32 MB por requisição).
  var MAX_TOTAL = 23 * 1024 * 1024;
  var MAX_REF = MAX_TOTAL;
  var STATUS = {
    aguardando: ["Aguardando envio", "st-aguardando"], enviando: ["Enviando à IA", "st-em-criacao"],
    enviado: ["Enviado", "st-em-criacao"], processando: ["Processando", "st-em-criacao"],
    concluido: ["Concluído", "st-gerada"], erro: ["Erro", "st-erro"], cancelado: ["Cancelado", ""]
  };
  var AVISO_SEM_CHAVE = "A geração por IA ainda não está ativa: falta colocar a chave da API no Supabase (ver guia).";
  var EXEC_CC = "claude_code", EXEC_API = "api";
  var CHAVE_EXECUTOR = "estudio-ia-executor";   // lembra a última escolha neste navegador (só conveniência)
  var DICA_CC = "Abra o Claude Code na pasta do projeto e diga: processar pedidos pendentes";
  // Rótulo do estado conforme quem gera (mesmos estados do banco; o executor muda só o texto)
  function rotuloStatus(p) {
    if (p.executor === EXEC_CC) {
      if (p.status === "aguardando") return ["Aguardando o Claude Code", "st-aguardando"];
      if (p.status === "processando") return p.reserva_expirada ? ["Claude Code: reserva vencida", "st-aguardando"] : ["Com o Claude Code", "st-em-criacao"];
    }
    return STATUS[p.status] || [p.status || "?", ""];
  }
  function executorSalvo() {
    try { return localStorage.getItem(CHAVE_EXECUTOR) === EXEC_API ? EXEC_API : EXEC_CC; } catch (e) { return EXEC_CC; }
  }
  function executorEscolhido() { return f.execApi && f.execApi.checked ? EXEC_API : EXEC_CC; }

  var f = {};            // controles do formulário
  var arquivos = { tec: [], soft: [] };
  var semChave = false;

  function nomeBanca(b) { var x = BANCAS.filter(function (p) { return p[0] === b; })[0]; return x ? x[1] : (b || "—"); }
  function campo(rotulo, controle, extra) {
    var c = el("div", "campo");
    var l = el("label", null, rotulo);
    if (controle.id) l.htmlFor = controle.id;
    c.appendChild(l); c.appendChild(controle);
    if (extra) ui.anexar(c, extra);
    return c;
  }
  function opc(texto) { return el("span", "opc", texto); }
  function tamanho(n) { return n > 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }

  function listarArquivos(tipo) {
    var ul = f["l" + tipo];
    ui.limpar(ul);
    arquivos[tipo].forEach(function (a, i) {
      var li = el("li");
      var nome = el("span", "nome-arq", a.name); nome.title = a.name;
      li.appendChild(nome);
      li.appendChild(el("span", "tam-arq", tamanho(a.size)));
      var rm = el("button", "btn-remover", "×"); rm.type = "button"; rm.setAttribute("aria-label", "Remover " + a.name);
      rm.addEventListener("click", function () { arquivos[tipo].splice(i, 1); listarArquivos(tipo); });
      li.appendChild(rm);
      ul.appendChild(li);
    });
  }
  function somaRefs(comSoft) {
    return arquivos.tec.concat(comSoft ? arquivos.soft : []).reduce(function (s, a) { return s + (a.size || 0); }, 0);
  }
  function msgLimite(total) {
    return "As referências somam " + tamanho(total) + "; o limite por pedido é 23 MB (envie só os capítulos usados ou PDFs comprimidos).";
  }
  function adicionar(tipo, lista) {
    var recusados = [], estourou = 0;
    Array.prototype.slice.call(lista || []).forEach(function (a) {
      if (/\.docx$/i.test(a.name)) { recusados.push(a.name + " (DOCX não é lido pela IA: salve como PDF)"); return; }
      if (!ACEITOS.test(a.name)) { recusados.push(a.name + " (use PDF, TXT, PNG, JPG ou WEBP)"); return; }
      if (a.size > MAX_REF) { recusados.push(a.name + " (" + tamanho(a.size) + "; maior que 23 MB)"); return; }
      if (arquivos[tipo].some(function (x) { return x.name === a.name && x.size === a.size; })) return;
      var total = somaRefs(true) + a.size;
      if (total > MAX_TOTAL) { recusados.push(a.name + " (passaria do limite somado)"); estourou = total; return; }
      arquivos[tipo].push(a);
    });
    listarArquivos(tipo);
    if (recusados.length) mensagem("Arquivos recusados: " + recusados.join("; ") + "." + (estourou ? " " + msgLimite(estourou) : ""), "erro");
  }
  function upload(tipo, rotuloId) {
    var w = el("div", "campo upload");
    var rot = el("span", "rotulo-campo", tipo === "tec" ? "Referências técnicas" : "Referências de soft skills"); rot.id = rotuloId;
    var inp = el("input", "vh"); inp.type = "file"; inp.multiple = true; inp.id = "ia-ref-" + tipo; inp.accept = ".pdf,.txt,.png,.jpg,.jpeg,.webp";
    inp.setAttribute("aria-labelledby", rotuloId);
    inp.addEventListener("change", function () { adicionar(tipo, this.files); this.value = ""; });
    var lbl = el("label", "btn btn-arquivo", "Adicionar arquivos…"); lbl.htmlFor = inp.id;
    f["l" + tipo] = el("ul", "lista-arquivos");
    ui.anexar(w, [rot, inp, lbl, f["l" + tipo]]);
    if (tipo === "tec") w.appendChild(el("p", "dica", "A IA usa SOMENTE as referências enviadas; sem referência, usa a base/perfil da banca e registra a lacuna. PDF, TXT ou imagem, até 23 MB somando todas as referências. DOCX não é lido pela IA: salve como PDF."));
    return w;
  }
  function mensagem(t, tipo) { f.msg.textContent = t || ""; f.msg.className = "msg-form" + (tipo ? " " + tipo : ""); }
  function atualizarBanca() {
    var b = f.banca.value;
    var atualA = f.area.value;
    ui.limpar(f.area);
    var o0 = el("option", null, "Escolha a área…"); o0.value = ""; f.area.appendChild(o0);
    AREAS.concat(b === "einstein" ? [AREA_PROC] : []).forEach(function (a) { var o = el("option", null, a); o.value = a; f.area.appendChild(o); });
    if (Array.prototype.some.call(f.area.options, function (o) { return o.value === atualA; })) f.area.value = atualA;
    f.campoDia.hidden = b !== "einstein";
    f.soft.hidden = !COM_SOFT[b];
  }
  function mostrarAviso() {
    f.aviso.hidden = !semChave;
  }

  function montar(painel) {
    ui.limpar(painel);
    f.aviso = el("div", "es-aviso-ia", [el("b", null, AVISO_SEM_CHAVE), el("span", null, " Depois que o Alexandre colar o segredo ANTHROPIC_API_KEY no Supabase (Edge Functions › Secrets) e publicar a função gerar-estacao, os pedidos aguardando podem ser enviados pelo botão “Enviar”. Guia: online/supabase/functions/README.md, no projeto.")]);
    f.aviso.setAttribute("role", "alert");
    f.aviso.hidden = true;
    painel.appendChild(f.aviso);
    painel.appendChild(el("p", "es-sutil es-intro-ia", "Pedido de estação nova. Quem gera pode ser o Claude Code no seu computador (sem custo de API, quando você pedir) ou a API da Anthropic (automático, pago). A estação volta sempre como rascunho no estúdio, para editar, revisar e aprovar. Para transcrever um PDF (ex.: Checklists Dominados), use “Importar arquivos…” na aba Estações: o pedido aparece nesta lista e pode ir para o Claude Code pelo botão “Gerar pelo Claude Code”."));

    var form = el("form", "form-pedido"); form.noValidate = true;
    // Quem gera (padrão: Claude Code)
    var quem = el("fieldset", "es-quem-gera", el("legend", null, "Quem gera"));
    function radio(id, valor, rotulo, dica) {
      var r = el("input"); r.type = "radio"; r.name = "ia-executor"; r.id = id; r.value = valor;
      r.addEventListener("change", atualizarExecutor);
      var l = el("label", null, [r, " ", el("b", null, rotulo)]); l.htmlFor = id;
      return { r: r, bloco: el("div", "campo", [l, el("p", "dica", dica)]) };
    }
    var rc = radio("ia-exec-cc", EXEC_CC, "Claude Code no meu computador (sem custo de API)",
      "O pedido fica “Aguardando o Claude Code”. " + DICA_CC + ".");
    var ra = radio("ia-exec-api", EXEC_API, "API da Anthropic (automático)",
      "Envia na hora para a IA (pago; exige a chave da API no Supabase).");
    f.execCc = rc.r; f.execApi = ra.r;
    (executorSalvo() === EXEC_API ? ra.r : rc.r).checked = true;
    quem.appendChild(rc.bloco); quem.appendChild(ra.bloco);
    form.appendChild(quem);
    f.banca = el("select"); f.banca.id = "ia-banca";
    var b0 = el("option", null, "Escolha a banca…"); b0.value = ""; f.banca.appendChild(b0);
    BANCAS.forEach(function (b) { var o = el("option", null, b[1]); o.value = b[0]; f.banca.appendChild(o); });
    f.banca.addEventListener("change", atualizarBanca);
    form.appendChild(campo("Banca", f.banca));
    f.area = el("select"); f.area.id = "ia-area";
    form.appendChild(campo("Grande área", f.area));
    f.dia = el("select"); f.dia.id = "ia-dia";
    ["Dia 1", "Dia 2"].forEach(function (d) { var o = el("option", null, d); o.value = d; f.dia.appendChild(o); });
    f.campoDia = campo("Dia", f.dia); f.campoDia.hidden = true;
    form.appendChild(f.campoDia);

    var tec = el("fieldset", null, el("legend", null, "Conteúdo técnico"));
    f.tema = el("input"); f.tema.type = "text"; f.tema.id = "ia-tema"; f.tema.autocomplete = "off";
    tec.appendChild(campo(["Tema técnico ", el("span", "obrig", "(obrigatório)")], f.tema));
    f.ideia = el("textarea"); f.ideia.id = "ia-ideia"; f.ideia.rows = 3;
    tec.appendChild(campo(["Ideia / cenário ", opc("(opcional)")], f.ideia));
    tec.appendChild(upload("tec", "ia-r-tec"));
    form.appendChild(tec);

    f.soft = el("fieldset", null, el("legend", null, "Soft skills")); f.soft.hidden = true;
    f.foco = el("input"); f.foco.type = "text"; f.foco.id = "ia-foco"; f.foco.autocomplete = "off";
    f.soft.appendChild(campo(["Foco de soft skills ", opc("(opcional)")], f.foco));
    f.soft.appendChild(upload("soft", "ia-r-soft"));
    form.appendChild(f.soft);

    f.obs = el("textarea"); f.obs.id = "ia-obs"; f.obs.rows = 2;
    form.appendChild(campo(["Observações ", opc("(opcional)")], f.obs));
    f.enviar = el("button", "btn primario", "Criar pedido para o Claude Code"); f.enviar.type = "submit";
    form.appendChild(el("div", "acoes-form", f.enviar));
    f.msg = el("div", "msg-form"); f.msg.setAttribute("role", "status"); f.msg.setAttribute("aria-live", "polite");
    form.appendChild(f.msg);
    form.addEventListener("submit", function (ev) { ev.preventDefault(); enviarPedido(); });
    painel.appendChild(form);

    var cab = el("h2", null, ["Pedidos ", ui.botao("atualizar", "btn-link", function () { carregarPedidos(); })]);
    f.lista = el("ul", "es-pedidos"); f.lista.id = "lista-pedidos-ia";
    painel.appendChild(el("div", "pedidos", [cab, f.lista]));
    atualizarBanca();
    atualizarExecutor();
  }
  function atualizarExecutor() {
    var ex = executorEscolhido();
    f.enviar.textContent = ex === EXEC_CC ? "Criar pedido para o Claude Code" : "Gerar estação (API)";
    try { localStorage.setItem(CHAVE_EXECUTOR, ex); } catch (e) { /* sem armazenamento local: tudo bem */ }
  }

  /* ---------------- envio ---------------- */
  function enviarRefs(id, tipo, pasta) {
    var usados = {};
    return arquivos[tipo].reduce(function (p, a) {
      return p.then(function (acc) {
        var n = ui.nomeSeguro(a.name), base = n, k = 1;
        while (usados[n.toLowerCase()]) { k++; n = base.replace(/(\.[^.]+)?$/, "-" + k + "$1"); }
        usados[n.toLowerCase()] = true;
        var caminho = "pedidos/" + id + "/" + pasta + "/" + n;
        return E.arm.enviar(E.arm.REFERENCIAS, caminho, a, { tipo: ui.tipoArquivo(a.name), substituir: true }).then(function () { return acc.concat([caminho]); });
      });
    }, Promise.resolve([]));
  }
  function enviarPedido() {
    var b = f.banca.value, a = f.area.value, tema = f.tema.value.trim();
    if (!b) { mensagem("Escolha a banca.", "erro"); f.banca.focus(); return; }
    if (!a) { mensagem("Escolha a grande área.", "erro"); f.area.focus(); return; }
    if (!tema) { mensagem("Informe o tema técnico.", "erro"); f.tema.focus(); return; }
    var id = ui.uuid();
    var executor = executorEscolhido();
    var soft = !!COM_SOFT[b];
    if (somaRefs(soft) > MAX_TOTAL) { mensagem(msgLimite(somaRefs(soft)), "erro"); return; }
    f.enviar.disabled = true;
    mensagem("Enviando as referências…");
    var refsTec, refsSoft;
    enviarRefs(id, "tec", "tecnicas").then(function (t) {
      refsTec = t;
      return soft ? enviarRefs(id, "soft", "soft-skills") : [];
    }).then(function (s) {
      refsSoft = s;
      mensagem("Criando o pedido…");
      return E.api.criarPedido({
        id: id, banca: b, area: a, dia: b === "einstein" ? f.dia.value : null, tema: tema,
        ideia: f.ideia.value.trim() || null, foco_soft_skills: soft ? (f.foco.value.trim() || null) : null,
        observacoes: f.obs.value.trim() || null, referencias_tecnicas: refsTec, referencias_soft: refsSoft,
        executor: executor
      });
    }).then(function (r) {
      var pid = (r && r.id) || id;
      if (executor === EXEC_CC && !(r && r.executor === EXEC_CC)) {
        // banco sem a migração 010: o servidor ignorou "executor" e o pedido nasceu da API
        limparForm();
        mensagem("Pedido criado, mas para a API: a migração 010 (Claude Code) ainda não foi aplicada no Supabase. Ele fica “Aguardando envio”.", "erro");
        return { pronto: true };
      }
      if (executor === EXEC_CC) {   // o Claude Code busca o pedido depois: a função não é chamada
        limparForm();
        mensagem("Pedido criado: aguardando o Claude Code. " + DICA_CC + ".", "ok");
        return { pronto: true };
      }
      mensagem("Pedido criado. Enviando à IA…");
      return E.gerar("enviar", pid).then(function (g) { return { pid: pid, g: g }; });
    }).then(function (x) {
      if (x.pronto) return carregarPedidos();   // Claude Code: nada a enviar agora
      limparForm();
      tratarResposta(x.g, "enviar");
      if (x.g.ok) mensagem("Pedido enviado. A geração em lote costuma levar de alguns minutos a 1 hora; use “Verificar agora” na lista.", "ok");
      else if (x.g.semChave) mensagem("Pedido guardado (aguardando envio). " + AVISO_SEM_CHAVE, "erro");
      else mensagem("Pedido guardado, mas o envio à IA falhou: " + x.g.mensagem + " Tente “Enviar” na lista.", "erro");
      return carregarPedidos();
    }).catch(function (e) {
      mensagem("Não foi possível criar o pedido: " + ui.textoErro(e), "erro");
    }).then(function () { f.enviar.disabled = false; });
  }
  function limparForm() {
    f.tema.value = ""; f.ideia.value = ""; f.foco.value = ""; f.obs.value = "";
    arquivos.tec = []; arquivos.soft = [];
    listarArquivos("tec"); listarArquivos("soft");
  }
  function tratarResposta(g, acao) {
    if (g.semChave) { semChave = true; mostrarAviso(); return; }
    if (g.ok) { semChave = false; mostrarAviso(); }
    if (!g.ok) return;
    var d = g.dados || {};
    if (acao === "enviar" && d.avisos && d.avisos.length) ui.toast("Avisos do envio: " + d.avisos.join(" "));
    if (acao === "verificar") {
      var ids = idsDe(d);
      if (d.status === "concluido" && ids.length > 1) ui.toast(ids.length + " estações criadas! Estão no estúdio como rascunho.", "ok");
      else if (d.status === "concluido" && ids.length) ui.toast("Estação criada! Ela está no estúdio como rascunho.", "ok");
      else if (d.status === "concluido") ui.toast("Pedido concluído, mas nenhuma estação foi encontrada" + (d.erro || d.mensagem ? ": " + (d.erro || d.mensagem) : ".") , "erro");
      else if (d.status === "erro") ui.toast("A geração terminou com erro: " + (d.erro || d.mensagem || "veja a lista") + (d.pode_reenviar ? " Use “Enviar de novo” na lista." : ""), "erro");
      else if (d.mensagem) ui.toast(d.mensagem);
      else ui.toast("Ainda em processamento" + (d.status ? " (" + (STATUS[d.status] ? STATUS[d.status][0].toLowerCase() : d.status) + ")" : "") + ". Verifique de novo mais tarde.");
    }
  }

  /* ---------------- lista de pedidos ---------------- */
  function idsDe(p) {
    var ids = Array.isArray(p && p.estacao_ids) ? p.estacao_ids.filter(Boolean) : [];
    if (!ids.length && p && p.estacao_id) ids = [p.estacao_id];
    return ids;
  }
  // estação criada pelo pedido e depois excluída de vez no Estúdio (009): o pedido guarda o id, mas o
  // servidor devolve o item sem título e sem "arquivada" (a linha não existe mais)
  function excluida(p, id) {
    var x = Array.isArray(p.estacoes) ? p.estacoes.filter(function (e) { return e && e.id === id; })[0] : null;
    return !!x && x.arquivada == null && x.titulo == null;
  }
  function tituloDe(id) {
    var x = window.App && window.App.entradaPorId ? window.App.entradaPorId(id) : null;
    return x && x.linha && x.linha.titulo ? String(x.linha.titulo) : "";
  }
  function carregarPedidos() {
    if (!f.lista) return Promise.resolve();
    return E.api.listarPedidos().then(function (ps) {
      ui.limpar(f.lista);
      ps = ps.slice().sort(function (a, b) { return String(b.criado_em || "").localeCompare(String(a.criado_em || "")); });
      if (!ps.length) { f.lista.appendChild(el("li", "vazio", "Nenhum pedido ainda.")); return; }
      ps.forEach(function (p) { f.lista.appendChild(itemPedido(p)); });
    }, function (e) {
      ui.limpar(f.lista).appendChild(el("li", "vazio es-aviso-erro", "Não foi possível carregar os pedidos: " + ui.textoErro(e)));
    });
  }
  function itemPedido(p) {
    var imp = p.tipo === "importar";
    var li = el("li", "pedido" + (imp ? " es-pedido-importar" : ""));
    var cc = p.executor === EXEC_CC;
    li.appendChild(el("span", "tit", imp ? String(p.arquivo_original || "PDF importado") : String(p.tema || "(sem tema)")));
    var st = rotuloStatus(p);
    li.appendChild(el("span", "meta", [
      el("span", "selo-ui " + (imp ? "es-tipo-importar" : "es-tipo-gerar"), imp ? "Importar PDF" : "Gerar"),
      el("span", "selo-ui banca", imp && !p.banca ? "Banca: detectar" : nomeBanca(p.banca)),
      el("span", "selo-ui " + st[1], st[0]),
      el("span", "selo-ui", cc ? "Claude Code" : "API"),
      imp ? el("span", "selo-ui", "Páginas " + (p.paginas || "todas")) : null,
      !imp && p.area ? el("span", "selo-ui", p.area + (p.dia ? " · " + p.dia : "")) : null
    ]));
    var info = [ui.fmtData(p.criado_em)];
    if (p.custo_estimado_usd != null) info.push("custo estimado ≈ US$ " + ui.fmtNum(p.custo_estimado_usd, 2));
    var uso = p.uso || null;
    if (uso && (uso.input_tokens != null || uso.output_tokens != null)) info.push(ui.fmtNum((uso.input_tokens || 0) / 1000, 0) + " mil tokens de entrada, " + ui.fmtNum((uso.output_tokens || 0) / 1000, 0) + " mil de saída");
    var nRefs = p.n_referencias_tecnicas != null || p.n_referencias_soft != null ? (p.n_referencias_tecnicas || 0) + (p.n_referencias_soft || 0) :
      (p.referencias_tecnicas || []).length + (p.referencias_soft || []).length;
    if (!imp) info.push(nRefs + " referência(s)");
    var ids = idsDe(p);
    if (imp && p.status === "concluido") info.push(ids.length + " estação(ões) criada(s)");
    li.appendChild(el("span", "es-sutil es-peq", info.join(" · ")));
    if (p.estacao_titulo && ids.length <= 1) li.appendChild(el("span", "es-sutil es-peq", "Estação: " + p.estacao_titulo));
    if (p.erro) li.appendChild(el("span", "es-aviso-erro es-peq", String(p.erro)));
    if (cc && p.status === "aguardando") li.appendChild(el("span", "es-sutil es-peq", DICA_CC + "."));
    if (cc && p.status === "processando") li.appendChild(el("span", "es-sutil es-peq", (p.reserva_expirada
      ? "A sessão do Claude Code que pegou este pedido parou há mais de 3 horas; ele volta para a fila na próxima vez que você pedir “processar pedidos pendentes”."
      : "O Claude Code está gerando" + (p.reservado_por_nome ? " (sessão de " + p.reservado_por_nome + ")" : "") + (p.reservado_em ? " desde " + ui.fmtData(p.reservado_em) : "") + ". A estação aparece aqui como rascunho quando ele enviar.")));
    var acoes = el("div", "es-linha-botoes");
    var parado = p.status === "aguardando" || p.status === "erro";
    if (cc) {
      if (p.status === "processando" && p.reserva_expirada) {
        acoes.appendChild(ui.botao("Devolver à fila", "mini primario", function () { trocarExecutor(this, p, EXEC_CC); },
          "A sessão do Claude Code parou no meio: o pedido volta a “Aguardando o Claude Code”"));
        acoes.appendChild(ui.botao("Passar para a API", "mini", function () { trocarExecutor(this, p, EXEC_API); }));
      }
      if (p.status === "erro") acoes.appendChild(ui.botao("Tentar de novo pelo Claude Code", "mini primario", function () { trocarExecutor(this, p, EXEC_CC); }));
      if (parado) acoes.appendChild(ui.botao("Passar para a API", "mini", function () { trocarExecutor(this, p, EXEC_API); }));
    } else {
      if (parado) acoes.appendChild(ui.botao(p.status === "erro" ? "Enviar de novo" : "Enviar", "mini", function () { acao(this, "enviar", p); }));
      if (parado) acoes.appendChild(ui.botao("Gerar pelo Claude Code", "mini" + (semChave ? " primario" : ""), function () { trocarExecutor(this, p, EXEC_CC); },
        "Tira o pedido da API e põe na fila do Claude Code no seu computador (sem custo de API)"));
      // "enviando"/"enviado" sem lote: "Verificar agora" destrava o envio interrompido (após 10 min) → "Enviar de novo"
      if (p.status === "enviando" || p.status === "enviado" || p.status === "processando") acoes.appendChild(ui.botao("Verificar agora", "mini primario", function () { acao(this, "verificar", p); }));
    }
    if (p.status === "concluido") ids.forEach(function (eid, i) {
      var tit = tituloDe(eid);
      var rot = ids.length > 1 ? "Abrir no estúdio (" + (i + 1) + "/" + ids.length + ")" : "Abrir no estúdio";
      if (excluida(p, eid)) { acoes.appendChild(el("span", "es-sutil es-peq", (ids.length > 1 ? "Estação " + (i + 1) + ": " : "") + "estação excluída")); return; }
      acoes.appendChild(ui.botao(rot, "mini primario", function () { abrir(eid); }, tit ? "Abrir “" + tit + "”" : null));
    });
    if (p.status === "aguardando" || p.status === "enviando" || p.status === "enviado" || p.status === "processando") acoes.appendChild(ui.botao("Cancelar", "mini perigo", function () { cancelar(p); }));
    if (acoes.firstChild) li.appendChild(acoes);
    return li;
  }
  function acao(bt, qual, p) {
    bt.disabled = true;
    var t = bt.textContent; bt.textContent = qual === "enviar" ? "Enviando…" : "Verificando…";
    E.gerar(qual, p.id).then(function (g) {
      tratarResposta(g, qual);
      if (!g.ok && !g.semChave) ui.toast("Falhou: " + g.mensagem, "erro");
      if (g.ok && qual === "enviar") ui.toast("Pedido enviado à IA.", "ok");
      var antes = g.ok && qual === "verificar" && g.dados && g.dados.status === "concluido" && window.App ? window.App.recarregarLista() : Promise.resolve();
      return antes.catch(function () { /* a lista do estúdio recarrega depois */ }).then(function () { return carregarPedidos(); });
    }).then(function () { bt.disabled = false; bt.textContent = t; });
  }
  function trocarExecutor(bt, p, executor) {
    bt.disabled = true;
    E.api.definirExecutor(p.id, executor).then(function () {
      ui.toast(executor === EXEC_CC ? "Pedido na fila do Claude Code. " + DICA_CC + "." : "Pedido passado para a API: use “Enviar”.", "ok");
      return carregarPedidos();
    }, function (e) { bt.disabled = false; ui.toast(ui.textoErro(e), "erro"); });
  }
  function abrir(estacaoId) {
    var App = window.App;
    if (!App) return;
    App.recarregarLista().then(function () {
      return App.abrirPorId(estacaoId);
    }).then(function (ok) { if (ok === false && !App.entradaPorId(estacaoId)) ui.toast("A estação não está na lista (foi arquivada?). Marque “Mostrar arquivadas”.", "erro"); });
  }
  function cancelar(p) {
    ui.confirmar("Cancelar o pedido?", "“" + (p.tipo === "importar" ? (p.arquivo_original || "PDF") : (p.tema || "")) + "”: o pedido deixa de ser processado. Se já estiver na IA, o resultado é descartado.", "Cancelar pedido", true).then(function (ok) {
      if (!ok) return;
      E.api.cancelarPedido(p.id).then(function () { ui.toast("Pedido cancelado.", "ok"); return carregarPedidos(); }, function (e) { ui.toast(ui.textoErro(e), "erro"); });
    });
  }

  function iniciar() {
    var painel = document.getElementById("painel-ia");
    if (!painel) return;
    montar(painel);
    E.aoPronto(function () { carregarPedidos(); });
    document.addEventListener("aba-lateral", function (ev) { if (ev.detail === "ia" && E.eu()) carregarPedidos(); });
  }
  E.ia = { carregarPedidos: function () { return carregarPedidos(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
