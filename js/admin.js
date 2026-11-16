/* =====================================================================
 * admin.js — Área do ADMINISTRADOR do Módulo de Aplicação (online).
 * Registra Online.registrarTela('admin', {...}) (núcleo: online/js/nucleo.js).
 *
 * Abas: Usuários · Estações publicadas · Sessões · Acompanhamento ·
 *       Parâmetros de pontuação · Pré-visualizar como · Visualizador local
 *
 * Regras:
 * - Nenhum innerHTML com dados: todo texto entra por textContent.
 * - Toda ação destrutiva pede confirmação (Online.confirmar).
 * - Quem decide permissão é o SERVIDOR (RPCs SECURITY DEFINER). Esta tela
 *   só organiza as chamadas; nada aqui é barreira de segurança.
 * - Os nomes das RPCs de administração ficam todos no objeto API, abaixo,
 *   para conciliar com online/supabase/API.md (Agente BANCO).
 * - O arquivo estacao.js NUNCA é executado: o objeto é extraído como texto
 *   (argumento de registrarEstacao(...)), sem comentários, e lido com JSON.parse.
 * ===================================================================== */
(function () {
  "use strict";

  var BUCKET = "estacoes";
  var INTERVALO_PAINEL_MS = 10000;
  var BANCAS = [
    ["einstein", "Einstein"], ["sirio-libanes", "Sírio-Libanês"], ["usp-ribeirao", "USP Ribeirão Preto"],
    ["unifesp-r1", "Unifesp R1"], ["unifesp-rmais", "Unifesp R+"], ["tradicional", "Tradicional"]
  ];
  var PERFIS = [["admin", "Administrador"], ["aplicador", "Aplicador"], ["ator", "Ator / atriz"], ["aluno", "Aluno"]];
  var SITUACAO_AV = { pendente: "Pendente", nao_avaliada: "Pendente", rascunho: "Em andamento", finalizada: "Finalizada", liberada: "Liberada" };
  var SITUACAO_SESSAO = { planejada: "Planejada", aberta: "Aberta", encerrada: "Encerrada" };
  var MAX_IMAGEM = 10 * 1024 * 1024;
  var TIPOS_IMAGEM = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

  function O() { return window.Online; }

  /* ------------------------------------------------------------------
   * API — chamadas ao servidor (nomes e argumentos conciliados com API.md)
   * ------------------------------------------------------------------ */
  function rpc(nome, args) { return O().rpc(nome, args || {}); }
  function lista(v) { return Array.isArray(v) ? v : (v && Array.isArray(v.linhas) ? v.linhas : []); }

  var API = {
    // usuários
    listarUsuarios: function () { return rpc("listar_usuarios", { p_incluir_inativos: true }).then(lista); },
    criarUsuario: function (u) { return rpc("criar_usuario", { p_nome: u.nome, p_email: u.email, p_perfil: u.perfil, p_turma: u.turma || null }); },
    editarUsuario: function (id, dados) { return rpc("editar_usuario", { p_id: id, p_dados: dados }); },     // dados: só as chaves que mudam
    definirAtivo: function (id, ativo) { return rpc("desativar_usuario", { p_id: id, p_ativo: !!ativo }); },
    importarAlunos: function (alunos, sessaoId) { return rpc("importar_alunos", { p_alunos: alunos, p_sessao_id: sessaoId || null }); },
    exportarAluno: function (id) { return rpc("exportar_dados_aluno", { p_usuario_id: id }); },
    excluirAluno: function (id, motivo) { return rpc("excluir_dados_aluno", { p_usuario_id: id, p_motivo: motivo }); },
    // estações
    listarEstacoes: function (soProntas) { return rpc("listar_estacoes_publicadas", { p_apenas_prontas: !!soProntas }).then(lista); },
    publicar: function (conteudo) { return rpc("publicar_estacao", { p_conteudo: conteudo }); },
    confirmarPublicacao: function (id) { return rpc("confirmar_publicacao", { p_id: id }); },
    previsualizar: function (pubId, papel) { return rpc("previsualizar_como", { p_estacao_publicada_id: pubId, p_papel: papel }); },
    // sessões
    listarSessoes: function () { return rpc("listar_sessoes").then(lista); },
    detalheSessao: function (id) { return rpc("detalhe_sessao", { p_id: id }); },
    criarSessao: function (dados) { return rpc("criar_sessao", { p_dados: dados }); },
    editarSessao: function (id, dados) { return rpc("editar_sessao", { p_id: id, p_dados: dados }); },
    encerrarSessao: function (id) { return rpc("encerrar_sessao", { p_id: id }); },
    excluirSessao: function (id) { return rpc("excluir_sessao", { p_id: id }); },
    adicionarEstacao: function (sessaoId, pubId) { return rpc("adicionar_estacao_sessao", { p_sessao_id: sessaoId, p_estacao_publicada_id: pubId }); },
    removerEstacao: function (seId) { return rpc("remover_estacao_sessao", { p_sessao_estacao_id: seId }); },
    reordenarEstacoes: function (sessaoId, seIds) { return rpc("reordenar_estacoes_sessao", { p_sessao_id: sessaoId, p_ids: seIds }); },
    atribuir: function (seId, usuarioId, papel) { return rpc("atribuir", { p_sessao_estacao_id: seId, p_usuario_id: usuarioId, p_papel: papel }); },
    desatribuir: function (atribuicaoId) { return rpc("remover_atribuicao", { p_atribuicao_id: atribuicaoId }); },
    inscrever: function (sessaoId, alunoIds) { return rpc("inscrever_alunos", { p_sessao_id: sessaoId, p_aluno_ids: alunoIds }); },
    desinscrever: function (sessaoId, alunoId) { return rpc("remover_inscricao", { p_sessao_id: sessaoId, p_aluno_id: alunoId }); },
    // acompanhamento
    painel: function (sessaoId) { return rpc("painel_sessao", { p_sessao_id: sessaoId }).then(lista); },
    resultados: function (sessaoId) { return rpc("resultados_sessao", { p_sessao_id: sessaoId }); },   // {sessao, estacoes, alunos, linhas}
    reabrir: function (avId, motivo) { return rpc("reabrir_avaliacao", { p_avaliacao_id: avId, p_motivo: motivo }); },
    liberar: function (sessaoId, ids) { return rpc("liberar_avaliacoes", { p_sessao_id: sessaoId, p_ids: ids || null }); },
    // parâmetros
    listarParametros: function () { return rpc("listar_parametros").then(lista); },
    definirParametro: function (chave, valor) { return rpc("definir_parametro", { p_chave: chave, p_valor: valor }); },
    recalcular: function (sessaoId) { return rpc("recalcular_notas", { p_sessao_id: sessaoId }); }
  };

  /* ------------------------------------------------------------------
   * Utilitários de DOM (sem innerHTML)
   * ------------------------------------------------------------------ */
  function h(tag, props) {
    var e = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === undefined || v === null || v === false) return;
        if (k === "cls") e.className = v;
        else if (k === "txt") e.textContent = String(v);
        else if (k.slice(0, 2) === "on" && typeof v === "function") e.addEventListener(k.slice(2), v);
        else if (k === "valor") e.value = v;
        else if (k === "marcado") e.checked = !!v;
        else if (k === "desab") e.disabled = !!v;
        else e.setAttribute(k, v === true ? "" : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) anexar(e, arguments[i]);
    return e;
  }
  function anexar(pai, filho) {
    if (filho === null || filho === undefined || filho === false) return;
    if (Array.isArray(filho)) { filho.forEach(function (f) { anexar(pai, f); }); return; }
    pai.appendChild(typeof filho === "object" ? filho : document.createTextNode(String(filho)));
  }
  function limpar(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }
  function botao(texto, aoClicar, cls, extra) {
    var p = { cls: "adm-btn" + (cls ? " " + cls : ""), type: "button", txt: texto, onclick: aoClicar };
    if (extra) Object.keys(extra).forEach(function (k) { p[k] = extra[k]; });
    return h("button", p);
  }
  function campo(rotulo, controle, dica) {
    return h("label", { cls: "adm-campo" }, h("span", { txt: rotulo }), controle, dica ? h("small", { cls: "adm-sub", txt: dica }) : null);
  }
  function selectDe(opcoes, valor, props) {
    var s = h("select", props || {});
    opcoes.forEach(function (o) {
      var op = h("option", { value: o[0], txt: o[1] });
      if (String(o[0]) === String(valor === undefined || valor === null ? "" : valor)) op.selected = true;
      s.appendChild(op);
    });
    return s;
  }
  function tag(situacao, texto) {
    var cls = !situacao || situacao === "nao_avaliada" ? "pendente" : situacao;
    return h("span", { cls: "adm-tag " + cls, txt: texto || SITUACAO_AV[situacao] || situacao || "Pendente" });
  }
  function tabela(cabecalhos, linhas) {
    var thead = h("thead", null, h("tr", null, cabecalhos.map(function (c) {
      return typeof c === "string" ? h("th", { txt: c }) : h("th", { cls: c.cls, txt: c.txt });
    })));
    var tbody = h("tbody", null, linhas);
    return h("div", { cls: "adm-tabela-rol" }, h("table", { cls: "adm-tabela" }, thead, tbody));
  }
  function td(conteudo, cls) { var c = h("td", cls ? { cls: cls } : null); anexar(c, conteudo); return c; }
  function msg(tipo, texto) { return h("div", { cls: "adm-" + tipo, role: tipo === "erro" ? "alert" : "status", txt: texto }); }
  function carregando() { return h("p", { cls: "adm-vazio", txt: "Carregando…" }); }

  function toast(texto, tipo) {
    if (O() && O().toast) O().toast(texto, tipo);
    else window.alert(texto);
  }
  function confirmar(texto, op) {
    if (O() && O().confirmar) return Promise.resolve(O().confirmar(texto, op || {}));
    return Promise.resolve(window.confirm(texto));
  }
  /* Mensagem amigável a partir do erro da RPC */
  var ERROS = {
    sem_permissao: "Sem permissão para esta ação (perfil administrador e usuário ativo são exigidos).",
    motivo_obrigatorio: "Informe o motivo.",
    nada_a_reabrir: "Essa avaliação não está finalizada; não há o que reabrir.",
    aluno_inexistente: "Aluno não encontrado (pode já ter sido excluído).",
    parametro_inexistente: "Parâmetro inexistente no servidor.",
    estacao_nao_aprovada: "O servidor só aceita estações com status \"aprovada\".",
    funcao_inexistente: "Função ainda não disponível no servidor.",
    so_publica_estacao_aprovada: "O servidor só aceita estações com status \"aprovada\".",
    email_ja_cadastrado: "Já existe um usuário com este e-mail.",
    email_invalido: "E-mail inválido.",
    nome_invalido: "Nome inválido (mínimo de 2 caracteres).",
    perfil_invalido: "Perfil inválido.",
    usuario_com_vinculos: "Não dá para mudar o perfil: a pessoa já tem atribuições ou inscrições. Remova-as antes ou cadastre outro usuário.",
    ultimo_admin: "Não é possível desativar ou rebaixar o último administrador ativo.",
    email_de_outro_perfil: "E-mail já cadastrado com outro perfil.",
    lote_grande_demais: "Arquivo grande demais: envie no máximo 2000 alunos por vez.",
    sessao_com_avaliacoes: "A sessão já tem avaliações e não pode ser excluída (encerre-a).",
    estacao_com_avaliacoes: "Esta estação já tem avaliações na sessão e não pode ser removida.",
    aluno_com_avaliacao: "O aluno já tem avaliação nesta sessão; a inscrição não pode ser removida.",
    estacao_ja_na_sessao: "Essa versão da estação já está na sessão.",
    estacao_nao_pronta: "A estação ainda não está pronta (faltam imagens). Confirme a publicação antes.",
    ja_existem_avaliacoes_nesta_estacao: "Já existem avaliações nesta estação da sessão.",
    perfil_incompativel_com_papel: "O perfil da pessoa não combina com o papel (aplicador ↔ perfil aplicador; ator ↔ perfil ator).",
    inscricao_so_de_aluno: "Só usuários com perfil aluno podem ser inscritos.",
    lista_incompleta: "A lista de estações para reordenar está incompleta; recarregue a página.",
    ordem_ocupada: "Essa posição já está ocupada; recarregue a página.",
    caminho_de_imagem_invalido: "Caminho de imagem inválido no arquivo (use img/<arquivo>.png|jpg|webp|gif).",
    versao_esquema_nao_suportada: "versao_esquema não suportada (esperado 1).",
    estacao_grande_demais: "Estação grande demais para publicar.",
    titulo_obrigatorio: "A estação não tem título.",
    checklist_sem_grupos: "O checklist não tem grupos.",
    escala_invalida: "Escala do checklist inválida.",
    banca_invalida: "Banca inválida.",
    data_invalida: "Data inválida.",
    nao_encontrado: "Registro não encontrado (pode ter sido removido); recarregue a página.",
    papel_invalido: "Papel inválido."
  };
  function textoErro(e) {
    if (!e) return "Erro desconhecido.";
    var m = String(e.message || e);
    var cod = e.code || "";
    var chave = Object.keys(ERROS).filter(function (k) { return m.indexOf(k) >= 0 || cod === k; })[0];
    if (cod === "PGRST202" || /Could not find the function/i.test(m)) chave = "funcao_inexistente";
    return chave ? ERROS[chave] + (chave === "funcao_inexistente" ? " (" + m + ")" : "") : m;
  }
  function falhou(e, onde) {
    console.error("[admin]", onde || "", e);
    if (e && e.code === "sem_permissao") return;          // o núcleo já avisa
    toast((onde ? onde + ": " : "") + textoErro(e), "erro");
  }

  /* Janela modal com formulário. campos: [{nome, rotulo, tipo, valor, opcoes, obrigatorio, dica}] → Promise<obj|null> */
  function modalForm(titulo, campos, opcoes) {
    opcoes = opcoes || {};
    return new Promise(function (resolve) {
      var ctrls = {};
      var erro = h("div");
      var form = h("form", { cls: "adm-form", novalidate: true });
      campos.forEach(function (c) {
        var ctl;
        if (c.tipo === "select") ctl = selectDe(c.opcoes, c.valor, { name: c.nome });
        else if (c.tipo === "textarea") ctl = h("textarea", { name: c.nome, valor: c.valor || "", maxlength: c.max || 2000 });
        else if (c.tipo === "check") {
          ctl = h("input", { type: "checkbox", name: c.nome, marcado: c.valor });
          ctrls[c.nome] = ctl;
          form.appendChild(h("label", { cls: "adm-check" }, ctl, c.rotulo));
          return;
        } else ctl = h("input", { type: c.tipo || "text", name: c.nome, valor: c.valor === undefined || c.valor === null ? "" : c.valor, maxlength: c.max || 200 });
        if (c.desab) ctl.disabled = true;
        ctrls[c.nome] = ctl;
        var cp = campo(c.rotulo + (c.obrigatorio ? " *" : ""), ctl, c.dica);
        if (c.inteiro) cp.style.gridColumn = "1 / -1";
        form.appendChild(cp);
      });
      if (opcoes.aoMontar) opcoes.aoMontar(ctrls);
      function fechar(v) { document.removeEventListener("keydown", esc); fundo.remove(); resolve(v); }
      function esc(ev) { if (ev.key === "Escape") fechar(null); }
      function enviar(ev) {
        if (ev) ev.preventDefault();
        var out = {};
        var faltou = [];
        campos.forEach(function (c) {
          var ctl = ctrls[c.nome];
          out[c.nome] = c.tipo === "check" ? ctl.checked : String(ctl.value || "").trim();
          if (c.obrigatorio && !ctl.disabled && !out[c.nome]) faltou.push(c.rotulo);
        });
        limpar(erro);
        if (faltou.length) { erro.appendChild(msg("erro", "Preencha: " + faltou.join(", ") + ".")); return; }
        if (opcoes.validar) {
          var problema = opcoes.validar(out);
          if (problema) { erro.appendChild(msg("erro", problema)); return; }
        }
        fechar(out);
      }
      form.addEventListener("submit", enviar);
      var modal = h("div", { cls: "adm-modal", role: "dialog", "aria-modal": "true", "aria-label": titulo },
        h("h3", { txt: titulo }),
        opcoes.texto ? h("p", { txt: opcoes.texto }) : null,
        form, erro,
        h("div", { cls: "adm-modal-acoes" },
          botao("Cancelar", function () { fechar(null); }, "sec"),
          botao(opcoes.ok || "Salvar", enviar, opcoes.perigo ? "perigo" : "")));
      var fundo = h("div", { cls: "adm-modal-fundo adm", onclick: function (ev) { if (ev.target === fundo) fechar(null); } }, modal);
      document.body.appendChild(fundo);
      document.addEventListener("keydown", esc);
      var primeiro = form.querySelector("input:not([disabled]),select,textarea");
      if (primeiro) setTimeout(function () { primeiro.focus(); }, 30);
    });
  }

  /* ------------------------------------------------------------------
   * Formatação, arquivos e CSV
   * ------------------------------------------------------------------ */
  function fmtNum(n) {
    if (n === null || n === undefined || n === "" || isNaN(Number(n))) return "—";
    return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  }
  function fmtData(d) {
    if (!d) return "—";
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
    if (m) return m[3] + "/" + m[2] + "/" + m[1];
    var dt = new Date(d);
    return isNaN(dt) ? String(d) : dt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }
  function nomeBanca(b) { var x = BANCAS.filter(function (p) { return p[0] === b; })[0]; return x ? x[1] : (b || "—"); }
  function nomePerfil(p) { var x = PERFIS.filter(function (q) { return q[0] === p; })[0]; return x ? x[1] : (p || "—"); }
  function slug(s) {
    return String(s || "arquivo").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "arquivo";
  }
  function hoje() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }

  function baixar(nome, conteudo, tipo) {
    var blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo || "application/octet-stream" });
    var url = URL.createObjectURL(blob);
    var a = h("a", { href: url, download: nome });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  /* CSV para o Excel brasileiro: UTF-8 com BOM, separador ";", CRLF */
  function celulaCSV(v) {
    if (v === null || v === undefined) return "";
    var s = typeof v === "number" ? String(v).replace(".", ",") : String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v !== "number") s = "'" + s;   // evita fórmula no Excel
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function gerarCSV(linhas) { return "﻿" + linhas.map(function (l) { return l.map(celulaCSV).join(";"); }).join("\r\n") + "\r\n"; }

  function lerTexto(arquivo) {
    function ler(cod) {
      return new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () { res(String(fr.result || "")); };
        fr.onerror = function () { rej(fr.error || new Error("Falha ao ler o arquivo.")); };
        fr.readAsText(arquivo, cod);
      });
    }
    // planilhas salvas no Excel do Windows costumam vir em Windows-1252
    return ler("utf-8").then(function (t) { return t.indexOf("�") >= 0 ? ler("windows-1252") : t; })
      .then(function (t) { return t.replace(/^﻿/, ""); });
  }

  /* Parser de CSV: separador ";" ou "," (detectado na 1ª linha), aspas duplas, CRLF */
  function parseCSV(texto) {
    var primeira = (texto.split(/\r?\n/).filter(function (l) { return l.trim(); })[0]) || "";
    var sep = (primeira.split(";").length - 1) >= (primeira.split(",").length - 1) && primeira.indexOf(";") >= 0 ? ";" : ",";
    var linhas = [], linha = [], cel = "", aspas = false, i, c;
    for (i = 0; i < texto.length; i++) {
      c = texto[i];
      if (aspas) {
        if (c === '"') { if (texto[i + 1] === '"') { cel += '"'; i++; } else aspas = false; }
        else cel += c;
      } else if (c === '"') aspas = true;
      else if (c === sep) { linha.push(cel); cel = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && texto[i + 1] === "\n") i++;
        linha.push(cel); linhas.push(linha); linha = []; cel = "";
      } else cel += c;
    }
    if (cel !== "" || linha.length) { linha.push(cel); linhas.push(linha); }
    return { sep: sep, linhas: linhas };
  }
  var RX_EMAIL = /^[^\s@;,"]+@[^\s@;,"]+\.[^\s@;,"]+$/;
  function normalizarEmail(e) { return String(e || "").trim().toLowerCase(); }

  /* Converte o CSV em linhas de importação com validação local */
  function prepararImportacao(texto, existentes) {
    var p = parseCSV(texto);
    var out = [], vistos = {};
    var porEmail = {};
    (existentes || []).forEach(function (u) { porEmail[normalizarEmail(u.email)] = u; });
    p.linhas.forEach(function (cols, idx) {
      var n = idx + 1;
      cols = cols.map(function (x) { return String(x || "").trim(); });
      if (!cols.join("")) return;                                  // linha vazia
      if (idx === 0 && /^nome$/i.test(cols[0]) && /e-?mail/i.test(cols[1] || "")) return;   // cabeçalho
      var r = { linha: n, nome: cols[0] || "", email: normalizarEmail(cols[1]), turma: cols[2] || "", erro: null, aviso: null };
      if (cols.length > 3 && cols.slice(3).join("")) r.aviso = "Colunas a mais ignoradas.";
      if (r.nome.length < 2) r.erro = "Nome ausente ou curto demais.";
      else if (r.nome.length > 200) r.erro = "Nome com mais de 200 caracteres.";
      else if (!RX_EMAIL.test(r.email)) r.erro = "E-mail inválido.";
      else if (vistos[r.email]) r.erro = "E-mail repetido no arquivo (linha " + vistos[r.email] + ").";
      else if (porEmail[r.email] && porEmail[r.email].perfil !== "aluno") r.erro = "E-mail já cadastrado com perfil " + nomePerfil(porEmail[r.email].perfil) + ".";
      else if (porEmail[r.email]) r.aviso = (r.aviso ? r.aviso + " " : "") + "Já cadastrado: nome e turma serão atualizados.";
      if (!r.erro) vistos[r.email] = n;
      out.push(r);
    });
    return { sep: p.sep, linhas: out };
  }

  /* ------------------------------------------------------------------
   * Leitura do estacao.js SEM executar o arquivo
   * ------------------------------------------------------------------ */
  /* Remove comentários // e /* *\/ que estejam FORA de strings ("…", '…', `…`) */
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
      if (c === "/" && d === "*") {
        var fim = t.indexOf("*/", i + 2);
        i = fim < 0 ? n : fim + 2; out += " "; continue;
      }
      out += c; i++;
    }
    return out;
  }
  /* Devolve o texto entre os parênteses de registrarEstacao( ... ) respeitando strings */
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
  function lerEstacaoDeTexto(texto) {
    var arg;
    try { arg = argumentoRegistrar(semComentarios(String(texto).replace(/^﻿/, ""))); }
    catch (e) { var e1 = new Error(e.message); e1.normalizar = true; throw e1; }
    var obj;
    try { obj = JSON.parse(arg); }
    catch (e) {
      var e2 = new Error("O conteúdo de registrarEstacao(…) não é JSON estrito (" + e.message + ").");
      e2.normalizar = true; throw e2;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) { var e3 = new Error("registrarEstacao(…) não recebeu um objeto."); e3.normalizar = true; throw e3; }
    return obj;
  }
  /* Mesma regra de privado.imagens_do_json: todo valor string de chave "arquivo" */
  function imagensDoObjeto(o) {
    var acc = {};
    (function andar(v) {
      if (Array.isArray(v)) v.forEach(andar);
      else if (v && typeof v === "object") Object.keys(v).forEach(function (k) {
        if (k === "arquivo" && typeof v[k] === "string") acc[v[k]] = true; else andar(v[k]);
      });
    })(o);
    return Object.keys(acc).sort();
  }
  function resumoChecklist(e) {
    var ck = e.checklist || {}, grupos = Array.isArray(ck.grupos) ? ck.grupos : [];
    var r = { escala: ck.escala || "—", grupos: grupos.length, itens: 0, negativos: 0, soma: 0, semValor: 0, parciais: 0, total_esperado: ck.total_esperado };
    grupos.forEach(function (g) {
      (g.itens || []).forEach(function (it) {
        r.itens++;
        if (it.negativo) { r.negativos++; return; }
        if (typeof it.valor === "number") r.soma += it.valor; else r.semValor++;
        if (it.parcial && !/^n[ãa]o se aplica/i.test(String(it.parcial))) r.parciais++;
      });
    });
    var soft = (e.soft_skills && Array.isArray(e.soft_skills.itens)) ? e.soft_skills.itens : [];
    r.soft = soft.length;
    r.softMax = soft.reduce(function (s, x) { return s + (typeof x.valor === "number" ? x.valor : 0); }, 0);
    r.soma = Math.round(r.soma * 100) / 100;
    return r;
  }

  /* ------------------------------------------------------------------
   * Envio de imagens ao bucket privado
   * ------------------------------------------------------------------ */
  function enviarImagem(caminho, arquivo) {
    var ext = (arquivo.name.split(".").pop() || "").toLowerCase();
    var tipo = TIPOS_IMAGEM[ext] || arquivo.type;
    if (O().enviarImagem) return Promise.resolve(O().enviarImagem(caminho, arquivo, tipo));   // se o núcleo oferecer
    var sb = O().sb;
    if (!sb || !sb.storage) return Promise.reject(new Error("Armazenamento indisponível neste ambiente."));
    return sb.storage.from(BUCKET).upload(caminho, arquivo, { contentType: tipo, upsert: false, cacheControl: "3600" })
      .then(function (r) {
        if (r && r.error) {
          var m = String(r.error.message || r.error);
          if (/exist|duplicate|409/i.test(m) || String(r.error.statusCode) === "409") return { jaExistia: true };
          throw new Error(m);
        }
        return r && r.data;
      });
  }

  /* ==================================================================
   * TELA
   * ================================================================== */
  function montar(container, ctx) {
    var raiz = h("div", { cls: "adm" });
    limpar(container).appendChild(raiz);
    var estado = { aba: null, timers: [], cacheUsuarios: null, cacheEstacoes: null, cacheSessoes: null };

    function vivo() { return document.body.contains(raiz); }
    function pararTimers() { estado.timers.forEach(clearInterval); estado.timers = []; }
    if (ctx && ctx.nav && ctx.nav.aoSair) ctx.nav.aoSair(pararTimers);

    var abas = [
      ["usuarios", "Usuários", telaUsuarios],
      ["estacoes", "Estações publicadas", telaEstacoes],
      ["sessoes", "Sessões", telaSessoes],
      ["acompanhamento", "Acompanhamento", telaAcompanhamento],
      ["parametros", "Parâmetros de pontuação", telaParametros],
      ["previa", "Pré-visualizar como", telaPrevia],
      ["local", "Visualizador local", telaLocal]
    ];
    var eu = (O().eu && O().eu()) || {};
    raiz.appendChild(h("h2", { txt: "Administração" }));
    raiz.appendChild(h("p", { cls: "adm-sub", txt: (eu.nome ? eu.nome + " · " : "") + "Usuários, publicação, sessões, acompanhamento e notas. Criação, edição e revisão de estações continuam no visualizador local." }));
    var nav = h("div", { cls: "adm-abas", role: "tablist" });
    var corpo = h("div", { cls: "adm-corpo", role: "tabpanel" });
    raiz.appendChild(nav); raiz.appendChild(corpo);
    abas.forEach(function (a) {
      nav.appendChild(h("button", { cls: "adm-aba", type: "button", role: "tab", "data-aba": a[0], "aria-selected": "false", txt: a[1], onclick: function () { irPara(a[0]); } }));
    });

    function irPara(id, arg) {
      pararTimers();
      estado.aba = id;
      Array.prototype.forEach.call(nav.children, function (b) { b.setAttribute("aria-selected", b.getAttribute("data-aba") === id ? "true" : "false"); });
      limpar(corpo);
      var a = abas.filter(function (x) { return x[0] === id; })[0] || abas[0];
      try { history.replaceState(history.state, "", location.pathname + location.search + "#admin/" + a[0]); } catch (e) { /* file:// */ }
      Promise.resolve(a[2](corpo, arg)).catch(function (e) { corpo.appendChild(msg("erro", textoErro(e))); console.error(e); });
    }

    /* caches com recarga explícita */
    function usuarios(forcar) {
      if (!forcar && estado.cacheUsuarios) return Promise.resolve(estado.cacheUsuarios);
      return API.listarUsuarios().then(function (l) { estado.cacheUsuarios = l; return l; });
    }
    function estacoes(forcar) {
      if (!forcar && estado.cacheEstacoes) return Promise.resolve(estado.cacheEstacoes);
      return API.listarEstacoes().then(function (l) { estado.cacheEstacoes = l; return l; });
    }
    function sessoes(forcar) {
      if (!forcar && estado.cacheSessoes) return Promise.resolve(estado.cacheSessoes);
      return API.listarSessoes().then(function (l) { estado.cacheSessoes = l; return l; });
    }

    /* ================================================================
     * USUÁRIOS
     * ================================================================ */
    function telaUsuarios(alvo) {
      var filtroPerfil = selectDe([["", "Todos os perfis"]].concat(PERFIS), "", { "aria-label": "Filtrar por perfil" });
      var filtroAtivo = selectDe([["ativos", "Ativos"], ["todos", "Ativos e desativados"], ["inativos", "Desativados"]], "ativos", { "aria-label": "Situação" });
      var busca = h("input", { type: "search", placeholder: "Buscar nome, e-mail ou turma", "aria-label": "Buscar" });
      var area = h("div");
      var contagem = h("p", { cls: "adm-sub" });
      anexar(alvo, [
        h("div", { cls: "adm-barra" },
          campo("Perfil", filtroPerfil), campo("Situação", filtroAtivo), campo("Busca", busca),
          h("span", { cls: "adm-esp" }),
          botao("Novo usuário", function () { editarUsuario(null); }),
          botao("Importar alunos (CSV)", function () { importarCSV(); }, "sec")),
        contagem, area,
        h("div", { cls: "adm-info" },
          h("strong", { txt: "LGPD: " }),
          "guardamos só nome, e-mail e turma. Em cada aluno, \"Exportar dados\" gera o arquivo com cadastro, inscrições e avaliações; \"Excluir dados\" apaga tudo (com motivo registrado na auditoria). A conta de login correspondente é removida depois no painel da Supabase (Authentication › Users).")
      ]);
      [filtroPerfil, filtroAtivo].forEach(function (c) { c.addEventListener("change", desenhar); });
      busca.addEventListener("input", desenhar);

      function desenhar() {
        var l = estado.cacheUsuarios || [];
        var p = filtroPerfil.value, a = filtroAtivo.value, b = busca.value.trim().toLowerCase();
        var f = l.filter(function (u) {
          if (p && u.perfil !== p) return false;
          if (a === "ativos" && u.ativo === false) return false;
          if (a === "inativos" && u.ativo !== false) return false;
          if (b && [u.nome, u.email, u.turma].join(" ").toLowerCase().indexOf(b) < 0) return false;
          return true;
        }).sort(function (x, y) { return String(x.nome).localeCompare(String(y.nome), "pt-BR"); });
        contagem.textContent = f.length + " de " + l.length + " usuário(s).";
        limpar(area);
        if (!f.length) { area.appendChild(h("p", { cls: "adm-vazio", txt: "Nenhum usuário com esses filtros." })); return; }
        area.appendChild(tabela(["Nome", "E-mail", "Perfil", "Turma", "Situação", "Ações"], f.map(function (u) {
          var acoes = [botao("Editar", function () { editarUsuario(u); }, "sec mini")];
          acoes.push(u.ativo === false
            ? botao("Reativar", function () { alternarAtivo(u, true); }, "sec mini")
            : botao("Desativar", function () { alternarAtivo(u, false); }, "perigo sec mini"));
          if (u.perfil === "aluno") {
            acoes.push(botao("Exportar dados", function () { exportarAluno(u); }, "sec mini"));
            acoes.push(botao("Excluir dados", function () { excluirAluno(u); }, "perigo sec mini"));
          }
          return h("tr", { cls: u.ativo === false ? "inativo" : null },
            td(u.nome), td(u.email), td(nomePerfil(u.perfil)), td(u.turma || "—"),
            td(u.ativo === false ? tag("erro", "Desativado") : tag("ok", "Ativo")),
            td(acoes, "acoes"));
        })));
      }
      function recarregar() {
        limpar(area).appendChild(carregando());
        return usuarios(true).then(desenhar).catch(function (e) { limpar(area).appendChild(msg("erro", "Não foi possível listar os usuários: " + textoErro(e))); });
      }

      function editarUsuario(u) {
        var novo = !u;
        modalForm(novo ? "Novo usuário" : "Editar usuário", [
          { nome: "nome", rotulo: "Nome completo", valor: u && u.nome, obrigatorio: true },
          { nome: "email", rotulo: "E-mail (login por código)", tipo: "email", valor: u && u.email, obrigatorio: true },
          { nome: "perfil", rotulo: "Perfil", tipo: "select", opcoes: PERFIS, valor: u ? u.perfil : "aluno" },
          { nome: "turma", rotulo: "Turma (só aluno)", valor: u && u.turma, dica: "Ex.: Einstein 2027 — Turma A" }
        ].concat(novo ? [] : [{ nome: "ativo", rotulo: "Ativo (pode entrar)", tipo: "check", valor: u.ativo !== false }]), {
          ok: novo ? "Cadastrar" : "Salvar",
          texto: novo ? "A pessoa entra com o código enviado a este e-mail. Nenhum e-mail é enviado agora." : null,
          aoMontar: function (c) {
            function sinc() { c.turma.disabled = c.perfil.value !== "aluno"; if (c.turma.disabled) c.turma.value = ""; }
            c.perfil.addEventListener("change", sinc); sinc();
          },
          validar: function (v) {
            if (v.nome.length < 2) return "Nome curto demais.";
            if (!RX_EMAIL.test(normalizarEmail(v.email))) return "E-mail inválido.";
            return null;
          }
        }).then(function (v) {
          if (!v) return;
          var dados = { id: u && u.id, nome: v.nome, email: normalizarEmail(v.email), perfil: v.perfil, turma: v.perfil === "aluno" ? v.turma : null, ativo: novo ? true : v.ativo };
          var aviso = (!novo && u.perfil !== v.perfil) ? confirmar("Mudar o perfil de " + u.nome + " de " + nomePerfil(u.perfil) + " para " + nomePerfil(v.perfil) + "? A mudança fica registrada na auditoria.") : Promise.resolve(true);
          return aviso.then(function (ok) {
            if (!ok) return;
            var req;
            if (novo) req = API.criarUsuario(dados);
            else {
              var mudou = {};
              ["nome", "email", "perfil", "turma", "ativo"].forEach(function (k) {
                var antes = u[k] === undefined ? null : u[k], depois = dados[k] === undefined ? null : dados[k];
                if (k === "turma") { antes = antes || null; depois = depois || null; }
                if (antes !== depois) mudou[k] = depois;
              });
              if (!Object.keys(mudou).length) { toast("Nada mudou.", "info"); return; }
              req = API.editarUsuario(u.id, mudou);
            }
            return req.then(function (r) {
              toast(novo ? "Usuário cadastrado." : "Usuário atualizado.", "ok");
              if (r && r.aviso === "vinculo_de_login_desfeito") toast("O e-mail mudou: no próximo login a pessoa entra com o novo e-mail (o vínculo com a conta antiga foi desfeito).", "aviso");
              return recarregar();
            });
          });
        }).catch(function (e) { falhou(e, "Salvar usuário"); });
      }
      function alternarAtivo(u, ativo) {
        confirmar(ativo ? "Reativar " + u.nome + "? A pessoa volta a poder entrar." : "Desativar " + u.nome + "? A pessoa perde o acesso imediatamente (os dados ficam guardados).", ativo ? {} : { ok: "Desativar", perigo: true })
          .then(function (ok) {
            if (!ok) return;
            return API.definirAtivo(u.id, ativo).then(function () { toast(ativo ? "Usuário reativado." : "Usuário desativado.", "ok"); return recarregar(); });
          }).catch(function (e) { falhou(e, ativo ? "Reativar" : "Desativar"); });
      }
      function exportarAluno(u) {
        API.exportarAluno(u.id).then(function (dados) {
          baixar("dados-aluno-" + slug(u.nome) + "-" + hoje() + ".json", JSON.stringify(dados, null, 2), "application/json;charset=utf-8");
          toast("Arquivo gerado. A exportação fica registrada na auditoria.", "ok");
        }).catch(function (e) { falhou(e, "Exportar dados"); });
      }
      function excluirAluno(u) {
        modalForm("Excluir dados de " + u.nome, [
          { nome: "motivo", rotulo: "Motivo (fica na auditoria, sem dados pessoais)", tipo: "textarea", obrigatorio: true, inteiro: true },
          { nome: "conf", rotulo: "Digite EXCLUIR para confirmar", obrigatorio: true }
        ], {
          ok: "Excluir definitivamente", perigo: true,
          texto: "Apaga cadastro, inscrições e avaliações deste aluno. Não há como desfazer. Sugestão: use \"Exportar dados\" antes.",
          validar: function (v) { return v.conf.toUpperCase() !== "EXCLUIR" ? "Digite EXCLUIR para confirmar." : null; }
        }).then(function (v) {
          if (!v) return;
          return confirmar("Última confirmação: excluir permanentemente os dados de " + u.nome + " (" + u.email + ")?", { ok: "Excluir", perigo: true }).then(function (ok) {
            if (!ok) return;
            return API.excluirAluno(u.id, v.motivo).then(function (r) {
              var n = r && r.avaliacoes_apagadas;
              toast("Dados excluídos" + (n !== undefined ? " (" + n + " avaliação(ões))" : "") + ".", "ok");
              if (r && r.login_removido === false && r.auth_user_id_para_remover) toast("Remova também a conta de login no painel da Supabase (Authentication › Users), id " + r.auth_user_id_para_remover + ".", "aviso");
              return recarregar();
            });
          });
        }).catch(function (e) { falhou(e, "Excluir dados"); });
      }

      function importarCSV() {
        var arq = h("input", { type: "file", accept: ".csv,.txt,text/csv,text/plain" });
        var colar = h("textarea", { placeholder: "nome;email;turma\nMaria Exemplo;maria@exemplo.test;Turma A", rows: 5 });
        var previa = h("div");
        var rel = h("div");
        var enviar = botao("Enviar", function () { enviarLinhas(); }, "", { desab: true });
        var slSessao = selectDe([["", "Não inscrever agora"]], "", { "aria-label": "Inscrever na sessão" });
        sessoes(true).then(function (l) {
          l.filter(function (x) { return x.situacao !== "encerrada"; }).forEach(function (x) { slSessao.appendChild(h("option", { value: x.id, txt: x.nome + " · " + fmtData(x.data) })); });
        }).catch(function () { /* sem sessões: só cadastra */ });
        var dados = null;
        var fundo;
        function fechar() { fundo.remove(); }
        var modal = h("div", { cls: "adm-modal", role: "dialog", "aria-modal": "true", "aria-label": "Importar alunos", style: "max-width:900px" },
          h("h3", { txt: "Importar alunos por CSV" }),
          h("p", { txt: "Colunas: nome; e-mail; turma (nessa ordem). Aceita vírgula ou ponto e vírgula; o cabeçalho é opcional. Todos entram com perfil Aluno. Nenhum e-mail é enviado na importação." }),
          h("div", { cls: "adm-form" }, campo("Arquivo .csv", arq), campo("…ou cole o conteúdo", colar), campo("Inscrever também na sessão (opcional)", slSessao)),
          h("div", { cls: "adm-barra" }, botao("Ver prévia", function () { verPrevia(colar.value); }, "sec")),
          previa, rel,
          h("div", { cls: "adm-modal-acoes" }, botao("Fechar", fechar, "sec"), enviar));
        fundo = h("div", { cls: "adm-modal-fundo adm" }, modal);
        document.body.appendChild(fundo);
        arq.addEventListener("change", function () {
          if (!arq.files[0]) return;
          lerTexto(arq.files[0]).then(function (t) { colar.value = t; verPrevia(t); }).catch(function (e) { falhou(e, "Ler CSV"); });
        });
        function verPrevia(texto) {
          limpar(rel); limpar(previa);
          if (!texto.trim()) { previa.appendChild(msg("aviso", "Nenhum conteúdo.")); enviar.disabled = true; return; }
          usuarios(false).catch(function () { return []; }).then(function (exist) {
            dados = prepararImportacao(texto, exist);
            var ok = dados.linhas.filter(function (r) { return !r.erro; });
            var ruins = dados.linhas.length - ok.length;
            previa.appendChild(h("p", null, h("strong", { txt: "Prévia: " }),
              dados.linhas.length + " linha(s) · " + ok.length + " válida(s) · " + ruins + " com erro · separador \"" + dados.sep + "\"."));
            previa.appendChild(tabela(["Linha", "Nome", "E-mail", "Turma", "Situação"], dados.linhas.map(function (r) {
              return h("tr", { cls: r.erro ? "linha-erro" : null }, td(String(r.linha), "num"), td(r.nome), td(r.email), td(r.turma || "—"),
                td(r.erro ? tag("erro", r.erro) : (r.aviso ? tag("rascunho", r.aviso) : tag("ok", "OK"))));
            })));
            enviar.textContent = "Enviar " + ok.length + " aluno(s)";
            enviar.disabled = !ok.length;
          });
        }
        function enviarLinhas() {
          if (!dados) return;
          var ok = dados.linhas.filter(function (r) { return !r.erro; });
          confirmar("Cadastrar/atualizar " + ok.length + " aluno(s)?").then(function (sim) {
            if (!sim) return;
            enviar.disabled = true;
            return API.importarAlunos(ok.map(function (r) { return { nome: r.nome, email: r.email, turma: r.turma || null }; }), slSessao.value ? Number(slSessao.value) : null)
              .then(function (res) {
                res = res || {};
                var errosSrv = Array.isArray(res.erros) ? res.erros : [];
                var errosLoc = dados.linhas.filter(function (r) { return r.erro; }).map(function (r) { return { linha: r.linha, email: r.email, motivo: r.erro }; });
                // o servidor numera pela posição no lote enviado (1, 2, …): volta para a linha do CSV
                var todos = errosLoc.concat(errosSrv.map(function (x) {
                  var orig = ok[(Number(x.linha) || 0) - 1];
                  var cod = x.erro || x.motivo || "recusado";
                  return { linha: orig ? orig.linha : x.linha, email: x.email, motivo: ERROS[cod] || cod };
                })).sort(function (a, b) { return (a.linha || 0) - (b.linha || 0); });
                limpar(rel);
                rel.appendChild(msg(todos.length ? "aviso" : "ok",
                  "Relatório: " + (res.criados !== undefined ? res.criados : "?") + " cadastrado(s), " +
                  (res.atualizados !== undefined ? res.atualizados : 0) + " atualizado(s)" +
                  (slSessao.value ? ", " + (res.inscritos || 0) + " inscrito(s) na sessão" : "") + ", " + todos.length + " erro(s)."));
                if (todos.length) {
                  rel.appendChild(tabela(["Linha", "E-mail", "Motivo"], todos.map(function (x) { return h("tr", null, td(String(x.linha || "—"), "num"), td(x.email || "—"), td(x.motivo)); })));
                  rel.appendChild(botao("Baixar relatório de erros (CSV)", function () {
                    baixar("importacao-erros-" + hoje() + ".csv", gerarCSV([["linha", "email", "motivo"]].concat(todos.map(function (x) { return [x.linha, x.email, x.motivo]; }))), "text/csv;charset=utf-8");
                  }, "sec"));
                }
                return recarregar();
              });
          }).catch(function (e) { enviar.disabled = false; falhou(e, "Importar"); });
        }
      }

      return recarregar();
    }

    /* ================================================================
     * ESTAÇÕES PUBLICADAS + PUBLICAR
     * ================================================================ */
    function telaEstacoes(alvo) {
      var area = h("div");
      var pub = h("div", { cls: "adm-cartao destaque" });
      anexar(alvo, [
        h("h3", { txt: "Publicar estação" }), pub,
        h("h3", { txt: "Estações publicadas" }),
        h("p", { cls: "adm-sub", txt: "Cada publicação é uma cópia congelada (versão). Editar a estação no app local e publicar de novo cria a versão seguinte; sessões já montadas continuam presas à versão escolhida." }),
        area
      ]);
      montarPublicar(pub, function () { carregarLista(); });

      function carregarLista() {
        limpar(area).appendChild(carregando());
        return estacoes(true).then(function (l) {
          limpar(area);
          if (!l.length) { area.appendChild(h("p", { cls: "adm-vazio", txt: "Nenhuma estação publicada ainda." })); return; }
          l = l.slice().sort(function (a, b) { return String(a.titulo).localeCompare(String(b.titulo), "pt-BR") || (b.versao - a.versao); });
          area.appendChild(tabela(["Título", "Identificador", { txt: "Versão", cls: "num" }, "Banca", "Imagens", "Publicada em", "Ações"], l.map(function (e) {
            return h("tr", null, td(e.titulo), td(h("code", { txt: e.estacao_id || "—" })), td("v" + (e.versao || "?"), "num"),
              td(nomeBanca(e.banca)), td(e.pronta ? tag("ok", "Pronta") : tag("rascunho", "Imagens pendentes")),
              td(fmtData(e.publicado_em)),
              td([
                botao("Pré-visualizar", function () { irPara("previa", { pubId: e.id }); }, "sec mini"),
                e.pronta ? null : botao("Confirmar imagens", function () {
                  API.confirmarPublicacao(e.id).then(function (r) {
                    if (r && r.pronta) toast("Estação pronta para uso em sessões.", "ok");
                    else toast("Ainda faltam imagens: " + ((r && r.faltam) || []).join(", ") + ". Publique de novo selecionando as imagens.", "erro");
                    return carregarLista();
                  }).catch(function (er) { falhou(er, "Confirmar"); });
                }, "sec mini")
              ], "acoes"));
          })));
        }).catch(function (e) { limpar(area).appendChild(msg("erro", "Não foi possível listar as estações: " + textoErro(e))); });
      }
      return carregarLista();
    }

    function montarPublicar(alvo, aoPublicar) {
      var inPasta = h("input", { type: "file", webkitdirectory: true, directory: true, multiple: true });
      var inJs = h("input", { type: "file", accept: ".js,text/javascript" });
      var inImg = h("input", { type: "file", accept: ".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif", multiple: true });
      var saida = h("div");
      var sel = { estacao: null, arquivoJs: null, imagens: {} };   // imagens: { "img/x.png": File }
      var parametros = null;
      API.listarParametros().then(function (l) { parametros = l; }).catch(function () { parametros = []; });

      anexar(alvo, [
        h("p", { txt: "Escolha a pasta da estação (saidas/<id>/) ou, separadamente, o arquivo estacao.js e as imagens da pasta img/. O arquivo é lido como texto e nunca é executado." }),
        h("div", { cls: "adm-form" },
          campo("Pasta inteira saidas/<id>/", inPasta, "Pega estacao.js e img/* de uma vez (Chrome/Edge)."),
          campo("…ou o arquivo estacao.js", inJs),
          campo("…e as imagens de img/", inImg, "PNG, JPEG, WebP ou GIF; até 10 MB cada.")),
        saida
      ]);

      inPasta.addEventListener("change", function () {
        var fs = Array.prototype.slice.call(inPasta.files || []);
        var js = fs.filter(function (f) { return /(^|\/)estacao\.js$/i.test(f.webkitRelativePath || f.name) && (f.webkitRelativePath || "").split("/").length <= 2; })[0]
          || fs.filter(function (f) { return /\.js$/i.test(f.name) && !/\/versoes\//.test(f.webkitRelativePath || ""); })[0];
        sel.imagens = {};
        fs.forEach(function (f) { if (/(^|\/)img\/[^/]+$/.test(f.webkitRelativePath || "")) sel.imagens["img/" + f.name] = f; });
        if (!js) { limpar(saida).appendChild(msg("erro", "Não achei estacao.js nessa pasta.")); return; }
        carregarJs(js);
      });
      inJs.addEventListener("change", function () { if (inJs.files[0]) carregarJs(inJs.files[0]); });
      inImg.addEventListener("change", function () {
        Array.prototype.forEach.call(inImg.files || [], function (f) { sel.imagens["img/" + f.name] = f; });
        desenharResumo();
      });

      function carregarJs(arquivo) {
        sel.arquivoJs = arquivo; sel.estacao = null;
        lerTexto(arquivo).then(function (t) {
          try { sel.estacao = lerEstacaoDeTexto(t); desenharResumo(); }
          catch (e) {
            limpar(saida).appendChild(msg("erro", "Não foi possível ler " + arquivo.name + ": " + e.message));
            if (e.normalizar) saida.appendChild(msg("info", "Como resolver: abra a estação no visualizador local (app/index.html), entre no modo edição e salve uma vez. O visualizador regrava o arquivo no formato normalizado (registrarEstacao com JSON estrito), que esta tela consegue ler sem executar código."));
          }
        }).catch(function (e) { falhou(e, "Ler arquivo"); });
      }

      function aceitaNaoAprovada() {
        var p = (parametros || []).filter(function (x) { return x.chave === "publicacao.aceita_exemplos"; })[0];
        return !!(p && (p.valor === true || p.valor === "true"));
      }

      function desenharResumo() {
        limpar(saida);
        var e = sel.estacao;
        if (!e) { if (Object.keys(sel.imagens).length) saida.appendChild(msg("info", Object.keys(sel.imagens).length + " imagem(ns) selecionada(s). Falta escolher o estacao.js.")); return; }
        var ck = resumoChecklist(e);
        var imgs = imagensDoObjeto(e);
        var faltam = imgs.filter(function (i) { return !sel.imagens[i]; });
        var invalidas = imgs.filter(function (i) { return !/^img\/[A-Za-z0-9._-]+\.(png|jpe?g|webp|gif)$/i.test(i); });
        var grandes = imgs.filter(function (i) { return sel.imagens[i] && sel.imagens[i].size > MAX_IMAGEM; });
        var aprovada = e.status === "aprovada";
        var teste = !aprovada && aceitaNaoAprovada();
        var problemas = [];
        if (e.versao_esquema !== 1) problemas.push("versao_esquema diferente de 1.");
        if (!e.id) problemas.push("Campo id ausente.");
        if (!aprovada && !teste) problemas.push("Status \"" + (e.status || "—") + "\": só estações com status \"aprovada\" podem ser publicadas. Conclua a revisão no visualizador local e marque como aprovada.");
        if (invalidas.length) problemas.push("Caminhos de imagem fora do padrão img/<arquivo>.(png|jpg|webp|gif): " + invalidas.join(", "));
        if (faltam.length) problemas.push("Imagens não selecionadas: " + faltam.join(", ") + ".");
        if (grandes.length) problemas.push("Imagens acima de 10 MB: " + grandes.join(", ") + ".");

        var totalTxt = ck.itens + " itens em " + ck.grupos + " grupo(s); escala " + ck.escala +
          "; soma dos valores " + fmtNum(ck.soma) + (ck.total_esperado !== undefined && ck.total_esperado !== null ? " (total esperado " + fmtNum(ck.total_esperado) + ")" : " (sem total esperado)") +
          (ck.negativos ? "; " + ck.negativos + " item(ns) negativo(s)" : "") + (ck.semValor ? "; " + ck.semValor + " sem valor" : "") +
          (ck.parciais ? "; " + ck.parciais + " com Parcial" : "") + (ck.soft ? "; soft skills: " + ck.soft + " domínio(s), " + fmtNum(ck.softMax) + " pontos" : "");
        var somaDiverge = typeof ck.total_esperado === "number" && Math.abs(ck.soma - ck.total_esperado) > 0.001;

        saida.appendChild(h("dl", { cls: "adm-resumo" },
          h("dt", { txt: "Título" }), h("dd", { txt: e.titulo || "—" }),
          h("dt", { txt: "Identificador" }), h("dd", null, h("code", { txt: e.id || "—" })),
          h("dt", { txt: "Banca" }), h("dd", { txt: nomeBanca(e.banca) + (e.edicao ? " · " + e.edicao : "") + (e.area ? " · " + e.area : "") }),
          h("dt", { txt: "Status" }), h("dd", null, aprovada ? tag("ok", "aprovada") : tag("erro", e.status || "sem status"), e.eh_exemplo ? " (exemplo de layout)" : null),
          h("dt", { txt: "Checklist" }), h("dd", { txt: totalTxt }),
          h("dt", { txt: "Imagens" }), h("dd", null, imgs.length ? imgs.map(function (i) { return h("div", null, sel.imagens[i] ? tag("ok", "ok") : tag("erro", "falta"), " ", i); }) : "nenhuma")));
        if (somaDiverge) saida.appendChild(msg("aviso", "A soma dos valores (" + fmtNum(ck.soma) + ") difere do total esperado (" + fmtNum(ck.total_esperado) + "). Confira no visualizador local antes de publicar."));
        if (teste) saida.appendChild(msg("aviso", "Ambiente de TESTE: o servidor aceita estação não aprovada (publicacao.aceita_exemplos = true). Não use isso no projeto de produção."));
        if (e.revisao) saida.appendChild(msg("info", "O bloco \"revisao\" é removido pelo servidor e não vai para a área online."));
        problemas.forEach(function (p) { saida.appendChild(msg("erro", p)); });

        var log = h("ul", { cls: "adm-log" });
        var bt = botao("Publicar esta estação", function () { publicar(bt, log, imgs); }, "", { desab: problemas.length > 0 });
        saida.appendChild(h("div", { cls: "adm-barra" }, bt));
        saida.appendChild(log);
      }

      function publicar(bt, log, imgs) {
        var e = sel.estacao;
        function linha(cls, t) { log.appendChild(h("li", { cls: cls, txt: t })); }
        confirmar("Publicar \"" + e.titulo + "\" (" + nomeBanca(e.banca) + ")? Será criada uma nova versão congelada na área online.").then(function (ok) {
          if (!ok) return;
          bt.disabled = true; limpar(log);
          linha("info", "Enviando o conteúdo ao servidor…");
          return API.publicar(e).then(function (r) {
            r = r || {};
            linha("ok", (r.ja_existia ? "Conteúdo idêntico já publicado: versão " : "Criada a versão ") + r.versao + " (id " + r.id + ").");
            if (r.ja_existia && r.pronta) { linha("ok", "Essa versão já está pronta. Nada a enviar."); return r; }
            var caminhos = Array.isArray(r.imagens) ? r.imagens : imgs;
            var prefixo = r.prefixo || (r.id + "/");
            var seq = Promise.resolve();
            caminhos.forEach(function (c) {
              seq = seq.then(function () {
                var f = sel.imagens[c];
                if (!f) { linha("erro", c + ": arquivo não selecionado."); return; }
                return enviarImagem(prefixo + c, f).then(function (x) {
                  linha("ok", c + (x && x.jaExistia ? " (já estava no armazenamento)" : " enviada."));
                }, function (er) { linha("erro", c + ": " + textoErro(er)); });
              });
            });
            return seq.then(function () { return API.confirmarPublicacao(r.id); }).then(function (c) {
              if (c && c.pronta) linha("ok", "Publicação confirmada: a estação já pode entrar em sessões.");
              else linha("erro", "Faltam imagens no armazenamento: " + ((c && c.faltam) || []).join(", ") + ". Selecione-as e publique de novo (a mesma versão é reaproveitada).");
              return r;
            });
          }).then(function () { if (aoPublicar) aoPublicar(); })
            .catch(function (er) {
              var t = textoErro(er);
              if (/aprovad/i.test(String(er && er.message))) t = ERROS.estacao_nao_aprovada;
              linha("erro", "Publicação recusada: " + t);
            })
            .then(function () { bt.disabled = false; });
        });
      }
    }

    /* ================================================================
     * SESSÕES
     * ================================================================ */
    function telaSessoes(alvo, arg) {
      if (arg && arg.sessaoId) return telaSessao(alvo, arg.sessaoId);
      var area = h("div");
      anexar(alvo, [
        h("div", { cls: "adm-barra" }, h("span", { cls: "adm-esp" }), botao("Nova sessão", function () { editarSessao(null, function (id) { irPara("sessoes", { sessaoId: id }); }); })),
        area
      ]);
      limpar(area).appendChild(carregando());
      return sessoes(true).then(function (l) {
        limpar(area);
        if (!l.length) { area.appendChild(h("p", { cls: "adm-vazio", txt: "Nenhuma sessão criada." })); return; }
        l = l.slice().sort(function (a, b) { return String(b.data).localeCompare(String(a.data)); });
        area.appendChild(tabela(["Sessão", "Banca / curso", "Data", "Turma", "Liberação", "Situação", { txt: "Estações", cls: "num" }, { txt: "Inscritos", cls: "num" }, "Ações"], l.map(function (s) {
          return h("tr", null, td(s.nome), td(nomeBanca(s.banca) + (s.curso ? " · " + s.curso : "")), td(fmtData(s.data)), td(s.turma || "—"),
            td(s.modo_liberacao === "ao_finalizar" ? "Ao finalizar" : "Manual"),
            td(tag(s.situacao === "encerrada" ? "pendente" : (s.situacao === "aberta" ? "ok" : "finalizada"), SITUACAO_SESSAO[s.situacao] || s.situacao)),
            td(fmtNum(s.estacoes), "num"), td(fmtNum(s.inscritos), "num"),
            td([botao("Abrir", function () { irPara("sessoes", { sessaoId: s.id }); }, "sec mini"),
                botao("Acompanhar", function () { irPara("acompanhamento", { sessaoId: s.id }); }, "sec mini")], "acoes"));
        })));
      }).catch(function (e) { limpar(area).appendChild(msg("erro", "Não foi possível listar as sessões: " + textoErro(e))); });
    }

    function editarSessao(s, depois) {
      modalForm(s ? "Editar sessão" : "Nova sessão", [
        { nome: "nome", rotulo: "Nome", valor: s && s.nome, obrigatorio: true, dica: "Ex.: Simulado Einstein — Turma A", inteiro: true },
        { nome: "banca", rotulo: "Banca", tipo: "select", opcoes: BANCAS, valor: s ? s.banca : "einstein" },
        { nome: "curso", rotulo: "Curso", valor: s && s.curso, dica: "Ex.: Hands-on Einstein" },
        { nome: "data", rotulo: "Data", tipo: "date", valor: s ? s.data : hoje(), obrigatorio: true },
        { nome: "turma", rotulo: "Turma", valor: s && s.turma },
        { nome: "modo_liberacao", rotulo: "Liberação das notas", tipo: "select", valor: s ? s.modo_liberacao : "manual",
          opcoes: [["manual", "Manual — liberar todas juntas quando eu mandar"], ["ao_finalizar", "Ao finalizar — assim que o aplicador finalizar"]], inteiro: true }
      ], { ok: s ? "Salvar" : "Criar sessão" }).then(function (v) {
        if (!v) return;
        var dados = { nome: v.nome, banca: v.banca, curso: v.curso || null, turma: v.turma || null, data: v.data, modo_liberacao: v.modo_liberacao };
        return (s ? API.editarSessao(s.id, dados) : API.criarSessao(dados)).then(function (r) {
          toast(s ? "Sessão atualizada." : "Sessão criada.", "ok");
          estado.cacheSessoes = null;
          if (depois) depois((r && (r.id || r.sessao_id)) || (s && s.id) || r);
        });
      }).catch(function (e) { falhou(e, "Salvar sessão"); });
    }

    function telaSessao(alvo, sessaoId) {
      var area = h("div");
      anexar(alvo, [h("div", { cls: "adm-barra" }, botao("‹ Todas as sessões", function () { irPara("sessoes"); }, "sec")), area]);

      function recarregar() {
        limpar(area).appendChild(carregando());
        return Promise.all([API.detalheSessao(sessaoId), usuarios(true), estacoes(true)]).then(function (r) { desenhar(r[0] || {}, r[1], r[2]); })
          .catch(function (e) { limpar(area).appendChild(msg("erro", "Não foi possível abrir a sessão: " + textoErro(e))); });
      }

      function desenhar(det, us, pubs) {
        limpar(area);
        var s = det.sessao || det;
        var ests = (det.estacoes || []).slice().sort(function (a, b) { return a.ordem - b.ordem; });
        var inscritos = det.inscritos || det.alunos || [];
        var encerrada = s.situacao === "encerrada";
        var ativos = us.filter(function (u) { return u.ativo !== false; });

        // Cabeçalho
        area.appendChild(h("div", { cls: "adm-cartao destaque" },
          h("h3", { txt: s.nome, style: "margin-top:0" }),
          h("dl", { cls: "adm-resumo" },
            h("dt", { txt: "Banca / curso" }), h("dd", { txt: nomeBanca(s.banca) + (s.curso ? " · " + s.curso : "") }),
            h("dt", { txt: "Data" }), h("dd", { txt: fmtData(s.data) }),
            h("dt", { txt: "Turma" }), h("dd", { txt: s.turma || "—" }),
            h("dt", { txt: "Liberação" }), h("dd", { txt: s.modo_liberacao === "ao_finalizar" ? "Ao finalizar (automática, se não houver pendência de regra)" : "Manual (pelo Acompanhamento)" }),
            h("dt", { txt: "Situação" }), h("dd", { txt: SITUACAO_SESSAO[s.situacao] || s.situacao || "—" })),
          h("div", { cls: "adm-barra" },
            encerrada ? null : botao("Editar dados", function () { editarSessao(s, recarregar); }, "sec"),
            botao("Acompanhar", function () { irPara("acompanhamento", { sessaoId: sessaoId }); }, "sec"),
            h("span", { cls: "adm-esp" }),
            encerrada ? null : botao("Encerrar sessão", function () {
              confirmar("Encerrar \"" + s.nome + "\"? Aplicadores e atores deixam de ver as estações desta sessão e não será possível alterar estações, atribuições nem inscrições. As notas continuam disponíveis.", { ok: "Encerrar", perigo: true }).then(function (ok) {
                if (!ok) return;
                return API.encerrarSessao(sessaoId).then(function () { toast("Sessão encerrada.", "ok"); estado.cacheSessoes = null; return recarregar(); });
              }).catch(function (e) { falhou(e, "Encerrar"); });
            }, "perigo"),
            botao("Excluir sessão", function () {
              confirmar("Excluir a sessão \"" + s.nome + "\"? Só é possível enquanto não houver nenhuma avaliação; estações, atribuições e inscrições dela são apagadas. Não há como desfazer.", { ok: "Excluir", perigo: true }).then(function (ok) {
                if (!ok) return;
                return API.excluirSessao(sessaoId).then(function () { toast("Sessão excluída.", "ok"); estado.cacheSessoes = null; irPara("sessoes"); });
              }).catch(function (e) { falhou(e, "Excluir sessão"); });
            }, "perigo sec"))));
        if (encerrada) area.appendChild(msg("info", "Sessão encerrada: somente leitura."));

        // Estações e atribuições
        area.appendChild(h("h3", { txt: "Estações da sessão (" + ests.length + ")" }));
        area.appendChild(h("p", { cls: "adm-sub", txt: "O aluno vê só \"Estação N\" (a ordem abaixo) até a liberação da nota. A ordem fica travada nesta tela assim que a sessão tiver qualquer avaliação (para o \"Estação N\" do aluno não mudar); estação com avaliação não pode ser removida." }));
        var ol = h("ol", { cls: "adm-ordem" });
        area.appendChild(ol);
        var ordemIds = ests.map(function (e) { return e.sessao_estacao_id; });
        var pubsNaSessao = ests.map(function (e) { return e.estacao_publicada_id; });
        var sessaoComAvaliacao = ests.some(function (e) { var a = e.avaliacoes || {}; return (Number(a.rascunho) || 0) + (Number(a.finalizada) || 0) + (Number(a.liberada) || 0) > 0; });
        function salvarOrdem(novos) {
          return API.reordenarEstacoes(sessaoId, novos).then(function () { toast("Ordem atualizada.", "ok"); return recarregar(); })
            .catch(function (e) { falhou(e, "Reordenar"); });
        }
        if (!ests.length) ol.appendChild(h("li", { cls: "adm-vazio", txt: "Nenhuma estação ainda." }));
        ests.forEach(function (e, idx) {
          var pub = pubs.filter(function (p) { return p.id === e.estacao_publicada_id; })[0] || {};
          var bancaDif = (e.banca || pub.banca) && s.banca && s.banca !== "tradicional" && (e.banca || pub.banca) !== s.banca;
          var av = e.avaliacoes || {};
          var nAv = (Number(av.rascunho) || 0) + (Number(av.finalizada) || 0) + (Number(av.liberada) || 0);
          var cab = h("div", { cls: "adm-ordem-cab" },
            h("strong", { txt: "Estação " + (e.ordem || idx + 1) }),
            h("span", { txt: (e.titulo || pub.titulo || "—") + " · " + nomeBanca(e.banca || pub.banca) + " · v" + (e.versao || pub.versao || "?") }),
            bancaDif ? tag("rascunho", "banca diferente da sessão") : null,
            e.tem_ator === false ? tag("pendente", "sem ator") : null,
            nAv ? tag("finalizada", nAv + " avaliação(ões)") : null,
            h("span", { cls: "adm-esp" }),
            encerrada ? null : [
              botao("↑", function () { var n = ordemIds.slice(); n.splice(idx - 1, 0, n.splice(idx, 1)[0]); salvarOrdem(n); }, "sec mini", { desab: idx === 0 || sessaoComAvaliacao, "aria-label": "Subir" }),
              botao("↓", function () { var n = ordemIds.slice(); n.splice(idx + 1, 0, n.splice(idx, 1)[0]); salvarOrdem(n); }, "sec mini", { desab: idx === ests.length - 1 || sessaoComAvaliacao, "aria-label": "Descer" }),
              botao("Remover", function () {
                confirmar("Remover a Estação " + (idx + 1) + " (" + (e.titulo || pub.titulo) + ") desta sessão? As atribuições dela também saem.", { ok: "Remover", perigo: true }).then(function (ok) {
                  if (!ok) return;
                  return API.removerEstacao(e.sessao_estacao_id).then(function () {
                    toast("Estação removida da sessão.", "ok");
                    // fecha o buraco na numeração ("Estação N" contínuo)
                    var resto = ordemIds.filter(function (_, i) { return i !== idx; });
                    return resto.length ? API.reordenarEstacoes(sessaoId, resto).catch(function () { /* mantém a numeração */ }) : null;
                  }).then(recarregar);
                }).catch(function (er) { falhou(er, "Remover estação"); });
              }, "perigo sec mini", { desab: nAv > 0, title: nAv ? "Já há avaliações nesta estação" : null })
            ]);
          var seId = e.sessao_estacao_id;
          var papeis = h("div", { cls: "adm-papeis" },
            blocoPapel("Aplicador(es)", "aplicador", e.aplicadores || [], seId),
            blocoPapel("Ator / atriz", "ator", e.atores || [], seId));
          ol.appendChild(h("li", null, cab, papeis));
        });
        function blocoPapel(rotulo, papel, atuais, seId) {
          var chips = h("div", { cls: "adm-chips" });
          if (!atuais.length) chips.appendChild(h("span", { cls: "adm-sub", txt: "ninguém atribuído" }));
          atuais.forEach(function (p) {
            chips.appendChild(h("span", { cls: "adm-chip" }, p.nome || p.email || p.id,
              encerrada ? null : h("button", { type: "button", "aria-label": "Remover " + (p.nome || ""), txt: "×", onclick: function () {
                confirmar("Remover " + (p.nome || "esta pessoa") + " como " + papel + " desta estação?", { ok: "Remover", perigo: true }).then(function (ok) {
                  if (!ok) return;
                  return API.desatribuir(p.atribuicao_id).then(recarregar);
                }).catch(function (er) { falhou(er, "Remover atribuição"); });
              } })));
          });
          var ids = atuais.map(function (p) { return p.usuario_id; });
          var candidatos = ativos.filter(function (u) { return u.perfil === papel && ids.indexOf(u.id) < 0; });
          var add = null;
          if (!encerrada) {
            var sl = selectDe([["", candidatos.length ? "Escolher " + (papel === "ator" ? "ator/atriz" : "aplicador") + "…" : "Sem " + (papel === "ator" ? "atores" : "aplicadores") + " ativos disponíveis"]]
              .concat(candidatos.map(function (u) { return [u.id, u.nome + " (" + u.email + ")"]; })), "", { "aria-label": "Atribuir " + papel });
            add = h("div", { cls: "adm-add" }, sl, botao("Atribuir", function () {
              if (!sl.value) return;
              API.atribuir(seId, sl.value, papel).then(function () { toast("Atribuído.", "ok"); return recarregar(); }).catch(function (er) { falhou(er, "Atribuir"); });
            }, "sec mini"));
          }
          return h("div", { cls: "adm-papel" }, h("span", { txt: rotulo }), chips, add);
        }
        if (!encerrada) {
          var prontas = pubs.filter(function (p) { return p.pronta && pubsNaSessao.indexOf(p.id) < 0; })
            .sort(function (a, b) { return (a.banca === s.banca ? 0 : 1) - (b.banca === s.banca ? 0 : 1) || String(a.titulo).localeCompare(String(b.titulo), "pt-BR"); });
          var slE = selectDe([["", prontas.length ? "Escolher estação publicada…" : "Nenhuma estação publicada e pronta disponível"]].concat(prontas.map(function (p) {
            return [p.id, p.titulo + " · " + nomeBanca(p.banca) + " · v" + p.versao + (p.banca !== s.banca ? " (outra banca)" : "")];
          })), "", { "aria-label": "Acrescentar estação" });
          area.appendChild(h("div", { cls: "adm-add", style: "max-width:720px" }, slE, botao("Acrescentar como Estação " + (ests.length + 1), function () {
            if (!slE.value) return;
            API.adicionarEstacao(sessaoId, Number(slE.value)).then(function (r) {
              toast("Acrescentada como " + ((r && r.estacao) || "nova estação") + ".", "ok");
              if (r && r.aviso === "banca_diferente_da_sessao") toast("Atenção: a banca da estação é diferente da banca da sessão.", "aviso");
              return recarregar();
            }).catch(function (er) { falhou(er, "Acrescentar estação"); });
          }, "sec")));
        }

        // Inscrições
        area.appendChild(h("h3", { txt: "Alunos inscritos (" + inscritos.length + ")" }));
        var idsInsc = inscritos.map(function (a) { return a.aluno_id; });
        var alunos = ativos.filter(function (u) { return u.perfil === "aluno"; });
        if (!encerrada) {
          var turmas = {};
          alunos.forEach(function (a) { if (a.turma) { turmas[a.turma] = (turmas[a.turma] || 0) + (idsInsc.indexOf(a.id) < 0 ? 1 : 0); } });
          var slT = selectDe([["", "Escolher turma…"]].concat(Object.keys(turmas).sort().map(function (t) { return [t, t + " (" + turmas[t] + " a inscrever)"]; })), s.turma && turmas[s.turma] !== undefined ? s.turma : "", { "aria-label": "Turma" });
          var livres = alunos.filter(function (a) { return idsInsc.indexOf(a.id) < 0; }).sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), "pt-BR"); });
          var slA = selectDe([["", livres.length ? "Escolher aluno…" : "Todos os alunos ativos já estão inscritos"]].concat(livres.map(function (a) { return [a.id, a.nome + (a.turma ? " · " + a.turma : "")]; })), "", { "aria-label": "Aluno" });
          area.appendChild(h("div", { cls: "adm-form" },
            h("div", { cls: "adm-campo" }, h("span", { txt: "Inscrever uma turma inteira" }), h("div", { cls: "adm-add" }, slT, botao("Inscrever turma", function () {
              if (!slT.value) return;
              var ids = alunos.filter(function (a) { return a.turma === slT.value && idsInsc.indexOf(a.id) < 0; }).map(function (a) { return a.id; });
              if (!ids.length) { toast("Todos os alunos ativos dessa turma já estão inscritos.", "info"); return; }
              confirmar("Inscrever " + ids.length + " aluno(s) da turma " + slT.value + "?").then(function (ok) {
                if (!ok) return;
                return API.inscrever(sessaoId, ids).then(function (r) { toast(((r && r.inscritos) || 0) + " aluno(s) inscrito(s).", "ok"); return recarregar(); });
              }).catch(function (e) { falhou(e, "Inscrever"); });
            }, "sec mini"))),
            h("div", { cls: "adm-campo" }, h("span", { txt: "Inscrever individualmente" }), h("div", { cls: "adm-add" }, slA, botao("Inscrever", function () {
              if (!slA.value) return;
              API.inscrever(sessaoId, [slA.value]).then(function () { toast("Aluno inscrito.", "ok"); return recarregar(); }).catch(function (e) { falhou(e, "Inscrever"); });
            }, "sec mini")))));
        }
        if (!inscritos.length) area.appendChild(h("p", { cls: "adm-vazio", txt: "Nenhum aluno inscrito." }));
        else area.appendChild(tabela(["Aluno", "Turma", "E-mail", "Ações"], inscritos.slice().sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), "pt-BR"); }).map(function (a) {
          return h("tr", null, td(a.nome), td(a.turma || "—"), td(a.email || "—"), td(encerrada ? "—" : botao("Remover", function () {
            confirmar("Remover " + a.nome + " desta sessão? Se já houver avaliação dele(a), o servidor recusa.", { ok: "Remover", perigo: true }).then(function (ok) {
              if (!ok) return;
              return API.desinscrever(sessaoId, a.aluno_id).then(function () { toast("Inscrição removida.", "ok"); return recarregar(); });
            }).catch(function (e) { falhou(e, "Remover inscrição"); });
          }, "perigo sec mini"), "acoes"));
        })));
      }
      return recarregar();
    }

    /* ================================================================
     * ACOMPANHAMENTO
     * ================================================================ */
    function telaAcompanhamento(alvo, arg) {
      var slS = h("select", { "aria-label": "Sessão" });
      var relogio = h("span", { cls: "adm-relogio" });
      var pausa = h("input", { type: "checkbox" });
      var painel = h("div");
      var resultados = h("div");
      var visao = selectDe([["estacao", "Por estação"], ["aluno", "Por aluno"]], "estacao", { "aria-label": "Visão dos resultados" });
      var dados = { painel: [], res: [], info: {} };
      var marcados = {};

      anexar(alvo, [
        h("div", { cls: "adm-barra" },
          campo("Sessão", slS), h("span", { cls: "adm-esp" }),
          h("label", { cls: "adm-check" }, pausa, "Pausar atualização"), relogio),
        h("h3", { txt: "Painel ao vivo" }), painel,
        h("h3", { txt: "Resultados" }),
        h("div", { cls: "adm-barra" },
          campo("Visão", visao), h("span", { cls: "adm-esp" }),
          botao("Liberar selecionadas", function () { liberar(true); }, "sec"),
          botao("Liberar todas as finalizadas", function () { liberar(false); }),
          botao("Exportar CSV", exportar, "sec")),
        resultados
      ]);
      visao.addEventListener("change", desenharResultados);

      sessoes(true).then(function (l) {
        l = l.slice().sort(function (a, b) { return String(b.data).localeCompare(String(a.data)); });
        if (!l.length) { limpar(painel).appendChild(h("p", { cls: "adm-vazio", txt: "Nenhuma sessão criada." })); return; }
        l.forEach(function (s) { slS.appendChild(h("option", { value: s.id, txt: s.nome + " · " + fmtData(s.data) + (s.situacao === "encerrada" ? " (encerrada)" : "") })); });
        var inicial = (arg && arg.sessaoId) || (l.filter(function (s) { return s.situacao !== "encerrada"; })[0] || l[0]).id;
        slS.value = String(inicial);
        slS.addEventListener("change", function () { marcados = {}; atualizar(); });
        atualizar();
        estado.timers.push(setInterval(function () {
          if (!vivo()) { pararTimers(); return; }
          if (pausa.checked || document.hidden || estado.aba !== "acompanhamento") return;
          atualizar(true);
        }, INTERVALO_PAINEL_MS));
      }).catch(function (e) { limpar(painel).appendChild(msg("erro", textoErro(e))); });

      function sessaoAtual() { return Number(slS.value) || slS.value; }
      function sessaoObj() { return (estado.cacheSessoes || []).filter(function (s) { return String(s.id) === String(slS.value); })[0] || {}; }

      function atualizar(silencioso) {
        var id = sessaoAtual();
        if (!id) return Promise.resolve();
        if (!silencioso) { limpar(painel).appendChild(carregando()); limpar(resultados); }
        return Promise.all([API.painel(id), API.resultados(id)]).then(function (r) {
          if (String(id) !== String(sessaoAtual())) return;
          dados.painel = r[0];
          dados.info = r[1] && !Array.isArray(r[1]) ? r[1] : {};
          dados.res = Array.isArray(r[1]) ? r[1] : ((r[1] && r[1].linhas) || []);
          relogio.textContent = "Atualizado às " + new Date().toLocaleTimeString("pt-BR") + " · a cada 10 s";
          desenharPainel(); desenharResultados();
        }).catch(function (e) {
          relogio.textContent = "Falha na atualização: " + textoErro(e);
          if (!silencioso) limpar(painel).appendChild(msg("erro", textoErro(e)));
        });
      }

      function desenharPainel() {
        limpar(painel);
        if (!dados.painel.length) { painel.appendChild(h("p", { cls: "adm-vazio", txt: "Sessão sem estações." })); return; }
        var grade = h("div", { cls: "adm-painel" });
        dados.painel.forEach(function (p) {
          var seId = p.sessao_estacao_id;
          var ins = Number(p.inscritos) || 0;
          var lib = Number(p.liberada) || 0, fin = Number(p.finalizada) || 0, ras = Number(p.rascunho) || 0;
          var pend = p.nao_iniciadas !== undefined ? Number(p.nao_iniciadas) : Math.max(0, ins - lib - fin - ras);
          function seg(cls, n) { return n && ins ? h("i", { cls: cls, style: "width:" + (100 * n / ins).toFixed(1) + "%", title: n + " " + cls }) : null; }
          var daEst = dados.res.filter(function (r) { return String(r.sessao_estacao_id) === String(seId); })
            .sort(function (a, b) { return ordemSit(a.situacao) - ordemSit(b.situacao) || String(a.aluno).localeCompare(String(b.aluno), "pt-BR"); });
          grade.appendChild(h("div", { cls: "adm-estacao-ao-vivo" },
            h("h4", { txt: (p.estacao || "Estação") + " — " + (p.titulo || "") }),
            h("div", { cls: "adm-sub", txt: (fin + lib) + " de " + ins + " avaliado(s) · " + ras + " em andamento · " + pend + " pendente(s)" + (Number(p.com_pendencia) ? " · " + p.com_pendencia + " com pendência de regra" : "") }),
            !Array.isArray(p.aplicadores) ? null : p.aplicadores.length ? h("div", { cls: "adm-sub", txt: "Aplicador(es): " + p.aplicadores.map(function (x) { return typeof x === "string" ? x : x.nome; }).join(", ") }) : h("div", { cls: "adm-sub", txt: "Sem aplicador atribuído" }),
            h("div", { cls: "adm-barra-prog", role: "img", "aria-label": (fin + lib) + " de " + ins + " avaliados" }, seg("liberada", lib), seg("finalizada", fin), seg("rascunho", ras)),
            daEst.length ? h("ul", { cls: "adm-alunos-estacao" }, daEst.map(function (r) {
              return h("li", null, h("span", { txt: r.aluno || r.aluno_nome || "—" }), tag(r.situacao || "pendente"));
            })) : null));
        });
        painel.appendChild(grade);
      }
      function ordemSit(s) { return { rascunho: 0, finalizada: 1, liberada: 2 }[s] !== undefined ? { rascunho: 0, finalizada: 1, liberada: 2 }[s] : 3; }

      function linhaAvaliada(r) { return r.avaliacao_id || (r.situacao && r.situacao !== "pendente" ? r.id : null); }

      function desenharResultados() {
        limpar(resultados);
        var res = dados.res || [];
        if (!res.length) { resultados.appendChild(h("p", { cls: "adm-vazio", txt: "Sem resultados ainda." })); return; }
        var bloqueadas = res.filter(function (r) { return r.situacao === "finalizada" && (r.nota_total === null || r.nota_total === undefined); }).length;
        if (bloqueadas) resultados.appendChild(msg("aviso", bloqueadas + " avaliação(ões) finalizada(s) com pendência de regra de pontuação (nota em branco): não podem ser liberadas até o parâmetro ser decidido em \"Parâmetros de pontuação\" e as notas recalculadas."));
        if (visao.value === "aluno") desenharPorAluno(res); else desenharPorEstacao(res);
      }

      function celulaNota(r) {
        if (r.nota_total === null || r.nota_total === undefined) return r.situacao === "finalizada" || r.situacao === "liberada" ? tag("bloqueada", "pendência") : "—";
        return fmtNum(r.nota_total) + (r.nota_maxima !== null && r.nota_maxima !== undefined ? " / " + fmtNum(r.nota_maxima) : "");
      }
      function textoDominios(r) {
        return (r.dominios || []).map(function (d) { return (d.dominio || "?") + ": " + fmtNum(d.nota) + (d.maximo !== undefined ? "/" + fmtNum(d.maximo) : ""); }).join(" · ");
      }

      function desenharPorEstacao(res) {
        var porEst = {};
        res.forEach(function (r) { var k = r.estacao || ("Estação " + r.ordem); (porEst[k] = porEst[k] || []).push(r); });
        Object.keys(porEst).sort(function (a, b) { return a.localeCompare(b, "pt-BR", { numeric: true }); }).forEach(function (k) {
          var linhas = porEst[k];
          var infoE = (dados.info.estacoes || []).filter(function (x) { return String(x.sessao_estacao_id) === String(linhas[0].sessao_estacao_id); })[0];
          resultados.appendChild(h("h4", { txt: k + " — " + (linhas[0].titulo || "") + (infoE ? " · " + fmtNum(infoE.avaliadas) + " avaliada(s) · média " + fmtNum(infoE.media) + (infoE.nota_maxima !== null && infoE.nota_maxima !== undefined ? " / " + fmtNum(infoE.nota_maxima) : "") : "") }));
          resultados.appendChild(tabela(["", "Aluno", "Turma", "Aplicador", "Situação", { txt: "Nota", cls: "num" }, "Domínios", "Feedback", "Ações"], linhas
            .sort(function (a, b) { return String(a.aluno).localeCompare(String(b.aluno), "pt-BR"); })
            .map(function (r) {
              var avId = linhaAvaliada(r);
              var podeLiberar = avId && r.situacao === "finalizada" && r.nota_total !== null && r.nota_total !== undefined;
              var cb = h("input", { type: "checkbox", "aria-label": "Selecionar " + (r.aluno || ""), desab: !podeLiberar, marcado: !!marcados[avId] });
              cb.addEventListener("change", function () { if (cb.checked) marcados[avId] = true; else delete marcados[avId]; });
              var fb = r.feedback ? h("details", null, h("summary", { txt: "ver" }), h("p", { txt: r.feedback })) : "—";
              return h("tr", null, td(cb), td(r.aluno || "—"), td(r.turma || "—"), td(r.aplicador || "—"), td(tag(r.situacao || "pendente")),
                td(celulaNota(r), "num"), td(textoDominios(r) || "—"), td(fb),
                td(avId && (r.situacao === "finalizada" || r.situacao === "liberada") ? botao("Reabrir", function () { reabrir(r, avId); }, "perigo sec mini") : "—", "acoes"));
            })));
        });
      }

      function desenharPorAluno(res) {
        var estacoesSessao = [];
        res.forEach(function (r) { var k = r.estacao || ("Estação " + r.ordem); if (estacoesSessao.indexOf(k) < 0) estacoesSessao.push(k); });
        estacoesSessao.sort(function (a, b) { return a.localeCompare(b, "pt-BR", { numeric: true }); });
        var porAluno = {};
        res.forEach(function (r) { var k = r.aluno_id || r.aluno; (porAluno[k] = porAluno[k] || { id: r.aluno_id, nome: r.aluno, turma: r.turma, por: {} }).por[r.estacao || ("Estação " + r.ordem)] = r; });
        var somas = {};
        (dados.info.alunos || []).forEach(function (a) { somas[a.aluno_id] = a; });
        var cab = ["Aluno", "Turma"].concat(estacoesSessao.map(function (e) { return { txt: e, cls: "num" }; })).concat([{ txt: "Soma", cls: "num" }, { txt: "Concluídas", cls: "num" }]);
        resultados.appendChild(tabela(cab, Object.keys(porAluno).map(function (k) { return porAluno[k]; })
          .sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), "pt-BR"); })
          .map(function (a) {
            var feitas = 0;
            var cels = estacoesSessao.map(function (e) {
              var r = a.por[e];
              if (r && (r.situacao === "finalizada" || r.situacao === "liberada")) feitas++;
              return td(r ? [celulaNota(r), " ", tag(r.situacao || "pendente")] : "—", "num");
            });
            var sm = somas[a.id];
            var soma = sm && sm.soma !== null && sm.soma !== undefined ? fmtNum(sm.soma) + (sm.soma_maxima ? " / " + fmtNum(sm.soma_maxima) : "") : "—";
            return h("tr", null, [td(a.nome || "—"), td(a.turma || "—")].concat(cels).concat([td(soma, "num"), td(feitas + "/" + estacoesSessao.length, "num")]));
          })));
      }

      function reabrir(r, avId) {
        modalForm("Reabrir avaliação", [{ nome: "motivo", rotulo: "Motivo (obrigatório; fica na auditoria)", tipo: "textarea", obrigatorio: true, inteiro: true }], {
          ok: "Reabrir", perigo: true,
          texto: (r.aluno || "Aluno") + " · " + (r.estacao || "") + ". A avaliação volta a rascunho para o aplicador corrigir; se já estava liberada, a nota some da tela do aluno até ser liberada de novo."
        }).then(function (v) {
          if (!v) return;
          return confirmar("Confirmar a reabertura da avaliação de " + (r.aluno || "aluno") + "?", { ok: "Reabrir", perigo: true }).then(function (ok) {
            if (!ok) return;
            return API.reabrir(avId, v.motivo).then(function () { toast("Avaliação reaberta.", "ok"); return atualizar(true); });
          });
        }).catch(function (e) { falhou(e, "Reabrir"); });
      }

      function liberar(soSelecionadas) {
        var ids = soSelecionadas ? Object.keys(marcados) : null;
        if (soSelecionadas && !ids.length) { toast("Marque ao menos uma avaliação finalizada.", "info"); return; }
        var n = soSelecionadas ? ids.length : dados.res.filter(function (r) { return r.situacao === "finalizada" && r.nota_total !== null && r.nota_total !== undefined; }).length;
        if (!n) { toast("Não há avaliações finalizadas para liberar.", "info"); return; }
        confirmar("Liberar " + n + " nota(s) para os alunos? Eles passam a ver nota, domínios, feedback e o título da estação.").then(function (ok) {
          if (!ok) return;
          return API.liberar(sessaoAtual(), ids).then(function (r) {
            r = r || {};
            var bl = Array.isArray(r.bloqueadas) ? r.bloqueadas : [];
            toast((r.liberadas || 0) + " nota(s) liberada(s)" + (bl.length ? "; " + bl.length + " bloqueada(s) por pendência de regra" : "") + ".", bl.length ? "aviso" : "ok");
            marcados = {};
            return atualizar(true);
          });
        }).catch(function (e) { falhou(e, "Liberar"); });
      }

      function exportar() {
        var s = sessaoObj();
        var res = dados.res || [];
        if (!res.length) { toast("Nada para exportar.", "info"); return; }
        var nomesDom = [];
        res.forEach(function (r) { (r.dominios || []).forEach(function (d) { if (nomesDom.indexOf(d.dominio) < 0) nomesDom.push(d.dominio); }); });
        var cab = ["Sessão", "Data", "Estação", "Título", "Aluno", "E-mail", "Turma", "Aplicador", "Situação", "Nota", "Nota máxima"]
          .concat(nomesDom.map(function (d) { return "Domínio: " + d; })).concat(["Pendências", "Feedback", "Finalizada em", "Liberada em"]);
        var linhas = res.slice().sort(function (a, b) { return String(a.estacao).localeCompare(String(b.estacao), "pt-BR", { numeric: true }) || String(a.aluno).localeCompare(String(b.aluno), "pt-BR"); })
          .map(function (r) {
            var dm = {};
            (r.dominios || []).forEach(function (d) { dm[d.dominio] = d.nota; });
            return [s.nome || "", fmtData(s.data), r.estacao || "", r.titulo || "", r.aluno || "", r.email || "", r.turma || "", r.aplicador || "",
              SITUACAO_AV[r.situacao] || r.situacao || "Pendente",
              typeof r.nota_total === "number" ? r.nota_total : (r.nota_total ? Number(r.nota_total) : ""),
              typeof r.nota_maxima === "number" ? r.nota_maxima : (r.nota_maxima ? Number(r.nota_maxima) : "")]
              .concat(nomesDom.map(function (d) { return dm[d] === undefined || dm[d] === null ? "" : Number(dm[d]); }))
              .concat([(r.pendencias || []).join(", "), r.feedback || "", r.finalizada_em ? fmtData(r.finalizada_em) : "", r.liberada_em ? fmtData(r.liberada_em) : ""]);
          });
        baixar("resultados-" + slug(s.nome || "sessao") + "-" + hoje() + ".csv", gerarCSV([cab].concat(linhas)), "text/csv;charset=utf-8");
      }
    }

    /* ================================================================
     * PARÂMETROS DE PONTUAÇÃO
     * ================================================================ */
    function telaParametros(alvo) {
      var area = h("div");
      var recalc = h("div", { cls: "adm-cartao" });
      anexar(alvo, [
        msg("aviso", "Valores PROVISÓRIOS — confirmar com o Alexandre. Toda alteração fica registrada na auditoria. Depois de alterar, recalcule as notas: o recálculo não muda os itens marcados, só a nota."),
        area, h("h3", { txt: "Recalcular notas" }), recalc
      ]);
      function carregar() {
        limpar(area).appendChild(carregando());
        return API.listarParametros().then(function (l) {
          limpar(area);
          if (!l.length) { area.appendChild(h("p", { cls: "adm-vazio", txt: "Nenhum parâmetro retornado pelo servidor." })); return; }
          area.appendChild(tabela(["Parâmetro", "Descrição", "Valor atual", "Situação", "Decidido em", ""], l.map(function (p) {
            var v = p.valor === null || p.valor === undefined ? h("em", { txt: "pendente (vazio)" }) : h("code", { txt: JSON.stringify(p.valor) });
            return h("tr", null, td(h("code", { txt: p.chave })), td(p.descricao || "—"), td(v),
              td(p.provisorio === false ? tag("ok", "decidido") : tag("rascunho", "provisório")), td(fmtData(p.decidido_em)),
              td(botao("Alterar", function () { alterar(p); }, "sec mini"), "acoes"));
          })));
        }).catch(function (e) { limpar(area).appendChild(msg("erro", "Não foi possível ler os parâmetros: " + textoErro(e))); });
      }
      function alterar(p) {
        modalForm("Alterar " + p.chave, [
          { nome: "valor", rotulo: "Novo valor (JSON: número, true/false, \"texto\", null, objeto)", valor: p.valor === undefined ? "" : JSON.stringify(p.valor), obrigatorio: true, inteiro: true,
            dica: "Exemplos: 0.5 · true · \"desconta\" · {\"20\":[0,5,10,15,20]}. Use ponto como separador decimal." }
        ], {
          texto: p.descricao || "",
          validar: function (v) { try { JSON.parse(v.valor); return null; } catch (e) { return "Valor não é JSON válido (" + e.message + ")."; } }
        }).then(function (v) {
          if (!v) return;
          var novo = JSON.parse(v.valor);
          return confirmar("Alterar " + p.chave + " de " + JSON.stringify(p.valor) + " para " + JSON.stringify(novo) + "? Isso muda a regra de nota (auditado).").then(function (ok) {
            if (!ok) return;
            return API.definirParametro(p.chave, novo).then(function () {
              toast("Parâmetro alterado.", "ok");
              return carregar().then(function () { return oferecerRecalculo(); });
            });
          });
        }).catch(function (e) { falhou(e, "Alterar parâmetro"); });
      }
      function abertas() { return sessoes(true).then(function (l) { return l.filter(function (s) { return s.situacao !== "encerrada"; }); }); }
      function recalcularLista(lista) {
        var total = 0, seq = Promise.resolve();
        lista.forEach(function (s) { seq = seq.then(function () { return API.recalcular(s.id).then(function (n) { total += Number(n && n.linhas !== undefined ? n.linhas : n) || 0; }); }); });
        return seq.then(function () { toast("Notas recalculadas: " + total + " avaliação(ões) em " + lista.length + " sessão(ões).", "ok"); });
      }
      function oferecerRecalculo() {
        return abertas().then(function (l) {
          if (!l.length) return;
          return confirmar("Recalcular agora as notas das " + l.length + " sessão(ões) não encerrada(s)? Notas já liberadas também são recalculadas.").then(function (ok) {
            if (ok) return recalcularLista(l);
          });
        }).catch(function (e) { falhou(e, "Recalcular"); });
      }
      sessoes(true).then(function (l) {
        var sl = selectDe([["__abertas", "Todas as sessões não encerradas"]].concat(l.map(function (s) { return [s.id, s.nome + " · " + fmtData(s.data) + (s.situacao === "encerrada" ? " (encerrada)" : "")]; })), "__abertas", { "aria-label": "Sessão para recalcular" });
        anexar(recalc, [
          h("p", { txt: "Use depois de alterar um parâmetro. Avaliações com pendência de regra passam a ter nota quando o parâmetro é decidido." }),
          h("div", { cls: "adm-add", style: "max-width:640px" }, sl, botao("Recalcular", function () {
            var alvoL = sl.value === "__abertas" ? l.filter(function (s) { return s.situacao !== "encerrada"; }) : l.filter(function (s) { return String(s.id) === sl.value; });
            if (!alvoL.length) { toast("Nenhuma sessão para recalcular.", "info"); return; }
            confirmar("Recalcular as notas de " + alvoL.length + " sessão(ões)?").then(function (ok) { if (ok) return recalcularLista(alvoL); }).catch(function (e) { falhou(e, "Recalcular"); });
          }))
        ]);
      }).catch(function (e) { recalc.appendChild(msg("erro", textoErro(e))); });
      return carregar();
    }

    /* ================================================================
     * PRÉ-VISUALIZAR COMO
     * ================================================================ */
    function telaPrevia(alvo, arg) {
      var slE = h("select", { "aria-label": "Estação publicada" });
      var slP = selectDe([["ator", "Ator / atriz"], ["aplicador", "Aplicador"], ["aluno", "Aluno"]], "ator", { "aria-label": "Perfil" });
      var saida = h("div");
      anexar(alvo, [
        h("p", { txt: "Mostra exatamente o que o servidor entrega a cada perfil (filtro no servidor, previsualizar_como). Nada é escondido pelo navegador." }),
        h("div", { cls: "adm-barra" }, campo("Estação publicada", slE), campo("Ver como", slP), botao("Ver", ver)),
        saida
      ]);
      function ver() {
        if (!slE.value) return;
        var papel = slP.value;
        var pubId = Number(slE.value);
        limpar(saida).appendChild(carregando());
        API.previsualizar(pubId, papel).then(function (d) {
          limpar(saida);
          d = d || {};
          var titulo = (slE.options[slE.selectedIndex] || {}).text || "";
          var caixa = h("div", { cls: "adm-previa" }, h("div", { cls: "adm-previa-cab", txt: "Como " + (papel === "ator" ? "ATOR / ATRIZ" : papel.toUpperCase()) + " vê — " + titulo }));
          saida.appendChild(caixa);
          if (papel === "aluno") {
            [["antes", "Antes da liberação"], ["depois", "Depois da liberação (exemplo, sem nota real)"]].forEach(function (par) {
              var r = d[par[0]] || (par[0] === "antes" && !d.antes ? d : {});
              var linhas = [h("h4", { txt: par[1] }),
                h("p", null, h("strong", { txt: r.estacao || "Estação N" }), " · ", r.situacao === "concluida" ? tag("finalizada", "Concluída") : tag("pendente", "Pendente"))];
              if (r.titulo) linhas.push(h("p", null, h("strong", { txt: "Título: " }), r.titulo + (r.area ? " · " + r.area : "")));
              if (r.liberada) {
                linhas.push(h("p", null, h("strong", { txt: "Nota: " }), (r.nota_total === null || r.nota_total === undefined ? "(nota do aluno)" : fmtNum(r.nota_total)) + " / " + fmtNum(r.nota_maxima)));
                (r.dominios || []).forEach(function (dm) { linhas.push(h("p", { cls: "adm-sub", txt: (dm.dominio || "Domínio") + ": " + (dm.nota === null || dm.nota === undefined ? "—" : fmtNum(dm.nota)) + " / " + fmtNum(dm.maximo) })); });
                linhas.push(h("p", null, h("strong", { txt: "Feedback: " }), r.feedback || "—"));
              } else linhas.push(h("p", { cls: "adm-sub", txt: "Sem título, área, conteúdo, nota nem feedback." }));
              caixa.appendChild(h("div", { cls: "adm-cartao" }, linhas));
            });
          } else {
            var c = d.conteudo || d;            // formato antigo: o próprio conteúdo filtrado
            saida.insertBefore(h("p", { cls: "adm-sub", txt: "Campos do conteúdo entregues: " + (Object.keys(c).join(", ") || "—") + (d.tempo_minutos ? " · cronômetro: " + d.tempo_minutos + " min" : "") }), caixa);
            if (O().renderFluxo) {
              var alvoR = h("div");
              caixa.appendChild(alvoR);
              alvoR.appendChild(carregando());
              // URLs assinadas só das imagens que vieram no conteúdo filtrado (o admin pode assinar qualquer uma)
              var arqs = imagensDoObjeto(c);
              Promise.all(arqs.map(function (a) {
                return Promise.resolve(O().urlImagem ? O().urlImagem(pubId, a) : null).then(function (u) { return [a, u]; }, function () { return [a, null]; });
              })).then(function (pares) {
                var mapa = {};
                pares.forEach(function (p) { if (p[1]) mapa[p[0]] = p[1]; });
                return O().renderFluxo(alvoR, c, { imagens: mapa });
              }).catch(function (e) { limpar(alvoR).appendChild(msg("erro", "Falha ao desenhar: " + textoErro(e))); });
            } else caixa.appendChild(msg("aviso", "Renderizador indisponível; veja o JSON abaixo."));
          }
          saida.appendChild(h("details", null, h("summary", { txt: "JSON bruto recebido do servidor" }), h("pre", { cls: "adm-json", txt: JSON.stringify(d, null, 2) })));
        }).catch(function (e) { limpar(saida).appendChild(msg("erro", textoErro(e))); });
      }
      return estacoes(true).then(function (l) {
        if (!l.length) { slE.appendChild(h("option", { value: "", txt: "Nenhuma estação publicada" })); return; }
        l.slice().sort(function (a, b) { return String(a.titulo).localeCompare(String(b.titulo), "pt-BR") || b.versao - a.versao; }).forEach(function (e) {
          slE.appendChild(h("option", { value: e.id, txt: e.titulo + " · " + nomeBanca(e.banca) + " · v" + e.versao }));
        });
        if (arg && arg.pubId) { slE.value = String(arg.pubId); ver(); }
      }).catch(function (e) { saida.appendChild(msg("erro", textoErro(e))); });
    }

    /* ================================================================
     * VISUALIZADOR LOCAL (atalho documentado)
     * ================================================================ */
    function telaLocal(alvo) {
      var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === "file:";
      anexar(alvo, [
        h("div", { cls: "adm-cartao destaque" },
          h("h3", { txt: "Criação, edição e revisão: no visualizador local", style: "margin-top:0" }),
          h("p", { txt: "A área online só aplica e avalia. Criar, editar, revisar, aprovar e imprimir estações continua no visualizador local, no computador do administrador, que não vai para a internet." }),
          h("ol", null,
            h("li", { txt: "Abra o visualizador: duplo clique em \"Abrir Estações no Chrome.command\" (na pasta do projeto) ou abra app/index.html no Chrome." }),
            h("li", { txt: "Edite e revise a estação; quando estiver pronta, mude o status para \"aprovada\" e salve (o salvar também normaliza o arquivo)." }),
            h("li", { txt: "Volte aqui em \"Estações publicadas\" › Publicar estação e escolha a pasta saidas/<id>/." })),
          local ? h("p", null, h("a", { cls: "adm-btn sec", href: "../app/index.html", target: "_blank", rel: "noopener", txt: "Abrir o visualizador local (app/index.html)" })) :
            h("p", { cls: "adm-sub", txt: "Este atalho só funciona no computador do administrador (servidor local); na área publicada o visualizador não existe de propósito." }))
      ]);
    }

    // Aba inicial: a do endereço (#admin/<aba>) ou Usuários
    var m = /#admin\/([a-z]+)/.exec(location.hash || "");
    complementoDemo().then(function () { irPara(m && abas.some(function (a) { return a[0] === m[1]; }) ? m[1] : "usuarios"); });

    return { desmontar: function () { pararTimers(); limpar(container); } };
  }

  /* ------------------------------------------------------------------
   * Modo demonstração: complemento opcional com as RPCs de administração
   * que o backend falso (demo.js) não tiver. Só no computador local e só com
   * ?demo=1; o arquivo admin-demo.js não vai para a casca publicada.
   * ------------------------------------------------------------------ */
  var promessaDemo = null;
  function complementoDemo() {
    var on = O();
    var local = /^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(location.hostname);
    if (!on || !on.demo || !local || !window.Demo) return Promise.resolve();
    if (window.AdminDemo) return Promise.resolve();
    if (!promessaDemo) promessaDemo = new Promise(function (ok) {
      var s = document.createElement("script");
      s.src = "js/admin-demo.js";
      s.onload = function () { ok(); };
      s.onerror = function () { console.warn("[admin] admin-demo.js ausente: usando só o demo.js"); ok(); };
      document.head.appendChild(s);
    });
    return promessaDemo;
  }

  /* ------------------------------------------------------------------
   * Registro no núcleo (espera window.Online, se ainda não carregou)
   * ------------------------------------------------------------------ */
  var exportados = {
    // expostos para testes (sem dados): leitura do estacao.js, CSV
    _lerEstacaoDeTexto: lerEstacaoDeTexto, _semComentarios: semComentarios, _parseCSV: parseCSV,
    _prepararImportacao: prepararImportacao, _gerarCSV: gerarCSV, _imagensDoObjeto: imagensDoObjeto, _resumoChecklist: resumoChecklist,
    API: API
  };
  window.OnlineAdmin = exportados;

  var tentativas = 0;
  function registrar() {
    var on = window.Online;
    if (on && typeof on.registrarTela === "function") {
      on.registrarTela("admin", { titulo: "Administração", montar: montar });
      return;
    }
    if (++tentativas > 200) { console.error("[admin] window.Online.registrarTela não encontrado."); return; }
    setTimeout(registrar, 25);
  }
  registrar();
})();
