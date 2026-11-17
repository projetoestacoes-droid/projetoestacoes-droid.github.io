/* =====================================================================
 * revisao.js — Módulo de revisão automática das estações (Projeto Estações)
 *
 * Uso no navegador (script clássico, sem módulos):
 *     <script src="js/revisao.js"></script>
 *     var problemas = window.revisarEstacao(estacao);
 * Uso no node:
 *     var revisarEstacao = require("./revisao.js").revisarEstacao;
 *
 * Retorno: array de { nivel: "erro"|"aviso"|"info", secao, mensagem, regra }
 *   - "regra" é o código da regra (ex.: "CK-03"), documentado em
 *     app/esquema/REGRAS-REVISAO.md, com a origem de cada uma.
 *   - A lista sai ordenada: erros, depois avisos, depois infos.
 *
 * Contrato de dados: app/esquema/ESQUEMA.md (versão 1).
 * A função nunca lança exceção: cada grupo de regras roda protegido e,
 * se falhar, vira um aviso "Revisão automática" e os demais continuam.
 * As regras por banca ficam no objeto REGRAS_BANCAS logo abaixo (também
 * exposto como window.REGRAS_BANCAS, só para consulta).
 * ===================================================================== */
var revisarEstacao = (function (raiz) {
  "use strict";

  /* -------------------------------------------------------------------
   * 1. REGRAS POR BANCA
   *    secoes: "obrigatorio" (ausente = erro), "recomendado" (ausente = aviso),
   *            "ausente" (preenchido = aviso), "opcional" (sem regra).
   * ------------------------------------------------------------------- */
  var REGRAS_BANCAS = {
    "einstein": {
      nome: "Einstein",
      perfil: "analises/perfil-einstein.md",
      escala: "valor-pontos",
      tempo_min: 8,
      total_checklist: 30,
      total_checklist_procedimento: 50,
      faixa_itens: [10, 16],          // típica (perfil, seção 4)
      faixa_itens_limite: 21,         // até 21 com várias tarefas (perfil, seção 4)
      faixa_itens_procedimento: [10, 25],
      faixa_valor: [1, 5],            // 1,0 a 5,0 por item no 2026 (perfil, seção 4)
      pontua_por_peso: true,
      soft_skills: "pontuado",        // 70 pontos em 3 domínios
      total_soft_skills: 70,
      valores_dominio_soft: [20, 30],
      negativo_permitido: true,
      titulos_bloco: ["Competências técnicas"],
      areas: ["Clínica Médica", "Cirurgia Geral", "Ginecologia e Obstetrícia", "Pediatria", "Preventiva", "Procedimento"],
      faixa_palavras_discussao: [450, 850],
      faixa_palavras_soft: [300, 600],
      secoes: {
        dia: "obrigatorio", objetivos: "obrigatorio", criterios: "obrigatorio", roteiro: "obrigatorio",
        local: "obrigatorio", filipetas: "obrigatorio", orientacoes_examinador: "obrigatorio",
        checklist: "obrigatorio", discussao_tecnica: "obrigatorio", referencias: "obrigatorio",
        soft_skills: "recomendado", numero_estacao: "ausente", orientacoes_estacao: "ausente",
        discussao_banca: "ausente", sugestoes_frases: "ausente", referencias_imagens: "ausente"
      },
      secoes_procedimento: {
        dia: "obrigatorio", orientacoes_estacao: "obrigatorio", objetivos: "obrigatorio",
        roteiro: "obrigatorio", local: "recomendado", filipetas: "obrigatorio",
        orientacoes_examinador: "recomendado", checklist: "obrigatorio",
        discussao_tecnica: "obrigatorio", referencias: "obrigatorio",
        criterios: "ausente", soft_skills: "ausente", numero_estacao: "ausente",
        discussao_banca: "ausente", sugestoes_frases: "ausente", referencias_imagens: "ausente"
      },
      subcampos_roteiro: ["atores", "materiais"]
    },

    "sirio-libanes": {
      nome: "Sírio-Libanês (HSL)",
      perfil: "analises/perfil-sirio-libanes.md",
      escala: "sim-nao-valor",
      tempo_min: 8,
      total_checklist: 100,
      faixa_itens: [6, 12],           // padrão 2026 (perfil, seção 4.4)
      faixa_valor: [5, 20],
      multiplo_valor: 5,              // múltiplos de 5 (perfil, seções 4.2 e 10)
      pontua_por_peso: true,
      soft_skills: "texto",           // seção narrativa, sem pontuação própria
      negativo_permitido: true,
      titulos_bloco: ["Competências técnicas", "Competências Cognitivas e Não-Cognitivas"],
      faixa_referencias: [2, 3],
      secoes: {
        objetivos: "obrigatorio", criterios: "obrigatorio", roteiro: "obrigatorio", local: "obrigatorio",
        filipetas: "obrigatorio", orientacoes_examinador: "obrigatorio", checklist: "obrigatorio",
        discussao_tecnica: "obrigatorio", referencias: "obrigatorio",
        dia: "ausente", numero_estacao: "ausente", orientacoes_estacao: "ausente", discussao_banca: "ausente",
        soft_skills: "opcional", sugestoes_frases: "opcional", referencias_imagens: "opcional"
      },
      subcampos_roteiro: ["cenario_descricao", "materiais", "tempo"]
    },

    "usp-ribeirao": {
      nome: "USP Ribeirão Preto",
      perfil: "analises/perfil-usp-ribeirao.md",
      escala: "sim-parcial-nao",
      tempo_min: 5,
      totais_aceitos: [10, null],     // 10 quando há pesos; null quando não há
      faixa_itens: [8, 12],           // 2023–2026 (perfil, seção 4)
      pontua_por_peso: false,         // só quando total_esperado = 10
      soft_skills: "nao",
      negativo_permitido: true,
      titulos_bloco: ["Checklist fornecido pela banca examinadora"],
      titulo_bloco_obrigatorio: "Checklist fornecido pela banca examinadora",
      faixa_referencias: [2, 4],
      secoes: {
        objetivos: "obrigatorio", criterios: "obrigatorio", roteiro: "obrigatorio", local: "obrigatorio",
        filipetas: "obrigatorio", orientacoes_examinador: "obrigatorio", checklist: "obrigatorio",
        discussao_banca: "obrigatorio", discussao_tecnica: "obrigatorio", referencias: "obrigatorio",
        dia: "ausente", numero_estacao: "ausente", orientacoes_estacao: "ausente", soft_skills: "ausente",
        sugestoes_frases: "ausente", referencias_imagens: "ausente"
      },
      subcampos_roteiro: ["atores", "materiais"]
    },

    "unifesp-r1": {
      nome: "Unifesp R1",
      perfil: "analises/perfil-unifesp.md",
      escala: "sim-nao-pontos",
      tempo_min: 5,
      total_checklist: 10,
      faixa_itens: [6, 14],
      faixa_itens_limite: 24,         // até ~24 com 5–6 tarefas (perfil, seção 9.1)
      faixa_valor: [0.2, 2.5],
      pontua_por_peso: true,
      soft_skills: "nao",
      negativo_permitido: false,      // "Não fez X" pontua positivamente; não há desconto
      titulos_bloco: ["Competências técnicas"],
      areas: ["Clínica Médica", "Cirurgia", "Cirurgia Geral", "Pediatria", "Ginecologia e Obstetrícia"],
      faixa_referencias: [1, 4],
      faixa_palavras_discussao: [350, 850],
      somente_criterio_tecnico: true,
      secoes: {
        objetivos: "obrigatorio", criterios: "obrigatorio", roteiro: "obrigatorio", local: "obrigatorio",
        filipetas: "obrigatorio", checklist: "obrigatorio", discussao_tecnica: "obrigatorio",
        referencias: "obrigatorio", orientacoes_examinador: "opcional",
        dia: "ausente", numero_estacao: "ausente", orientacoes_estacao: "ausente", soft_skills: "ausente",
        discussao_banca: "ausente", sugestoes_frases: "ausente", referencias_imagens: "ausente"
      },
      subcampos_roteiro: ["atores", "materiais"]
    },

    "unifesp-rmais": {
      nome: "Unifesp R+",
      perfil: "analises/perfil-unifesp.md",
      escala: "sim-nao-pontos",
      tempo_min: 5,
      total_checklist: 10,
      faixa_itens: [10, 14],          // perfil, seção 9.2
      faixa_valor: [0.2, 2.5],
      pontua_por_peso: true,
      soft_skills: "nao",
      negativo_permitido: false,
      titulos_bloco: ["Competências técnicas"],
      faixa_referencias: [1, 4],
      faixa_palavras_discussao: [650, 1000],
      subtitulos_discussao: ["CENÁRIO", "VOLTANDO À ESTAÇÃO"],
      secoes: {
        numero_estacao: "obrigatorio", filipetas: "obrigatorio", checklist: "obrigatorio",
        discussao_tecnica: "obrigatorio", referencias: "obrigatorio",
        objetivos: "ausente", criterios: "ausente", roteiro: "ausente", local: "ausente",
        orientacoes_examinador: "ausente", orientacoes_ator: "ausente", dia: "ausente",
        orientacoes_estacao: "ausente", soft_skills: "ausente", discussao_banca: "ausente",
        sugestoes_frases: "ausente", referencias_imagens: "ausente"
      },
      subcampos_roteiro: []
    },

    "tradicional": {
      nome: "Tradicional",
      perfil: null,                   // sem perfil em analises/: só regras gerais
      escala: "sim-nao-valor",
      tempo_min: null,
      pontua_por_peso: true,
      soft_skills: "opcional",
      negativo_permitido: true,
      secoes: {
        filipetas: "obrigatorio", checklist: "obrigatorio", discussao_tecnica: "obrigatorio",
        referencias: "obrigatorio", discussao_banca: "ausente", numero_estacao: "ausente",
        orientacoes_estacao: "ausente"
      },
      subcampos_roteiro: []
    }
  };

  var ESCALAS = ["sim-nao-valor", "valor-pontos", "sim-parcial-nao", "sim-nao-pontos"];
  var STATUS = ["rascunho", "em-revisao", "aprovada"];
  var TIPOS_BLOCO = ["paragrafo", "subtitulo", "rotulo", "lista", "sinais", "tarefa", "tabela", "imagem", "fala", "nota"];

  var NOME_SECAO = {
    id: "Metadados", banca: "Metadados", edicao: "Metadados", status: "Metadados", titulo: "Metadados",
    area: "Metadados", dia: "Metadados", numero_estacao: "Metadados", versao_esquema: "Metadados",
    eh_exemplo: "Metadados",
    orientacoes_estacao: "Orientações da estação", objetivos: "Objetivos", criterios: "Critérios de avaliação",
    roteiro: "Roteiro da estação", local: "Local/Cenário", filipetas: "Filipetas",
    apos_filipetas: "Blocos após as filipetas", orientacoes_examinador: "Orientações ao examinador",
    orientacoes_ator: "Orientações ao ator", checklist: "Checklist", soft_skills: "Soft skills",
    discussao_banca: "Discussão (banca)", discussao_tecnica: "Discussão técnica",
    sugestoes_frases: "Sugestões de frases", referencias: "Referências",
    referencias_imagens: "Referências das imagens", revisao: "Revisão interna"
  };

  var ROTULO_CAMPO = {
    dia: "Dia (pílula \"Área | Dia N\")",
    numero_estacao: "Número da estação (título \"Estação N - Tema\")"
  };

  /* -------------------------------------------------------------------
   * 2. UTILITÁRIOS DEFENSIVOS
   * ------------------------------------------------------------------- */
  function ehObj(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function obj(x) { return ehObj(x) ? x : {}; }
  function str(x) { return typeof x === "string" ? x : ""; }
  function num(x) { return typeof x === "number" && isFinite(x); }
  function pega(o, chave) { try { return ehObj(o) ? o[chave] : undefined; } catch (e) { return undefined; } }

  function vazio(x) {
    if (x === undefined || x === null) return true;
    if (typeof x === "string") return x.trim() === "";
    if (Array.isArray(x)) return x.length === 0;
    if (ehObj(x)) return Object.keys(x).length === 0;
    return false;
  }

  function fmt(n) {
    if (!num(n)) return String(n);
    var r = Math.round(n * 100) / 100;
    return String(r).replace(".", ",");
  }

  function iguais(a, b) { return num(a) && num(b) && Math.abs(a - b) < 0.001; }

  function normaliza(s) {
    return str(s).toLowerCase()
      .replace(/[áàâã]/g, "a").replace(/[éê]/g, "e").replace(/[í]/g, "i")
      .replace(/[óôõ]/g, "o").replace(/[ú]/g, "u").replace(/[ç]/g, "c")
      .replace(/\s+/g, " ").trim();
  }

  function contaPalavras(s) {
    var t = str(s).replace(/\*+/g, " ").trim();
    return t ? t.split(/\s+/).length : 0;
  }

  /* Percorre qualquer valor e chama fn(valor, caminho, chave) para cada nó.
     Protegido contra ciclos e profundidade excessiva. */
  function percorre(valor, caminho, fn, vistos, prof) {
    vistos = vistos || [];
    prof = prof || 0;
    if (prof > 14) return;
    if (valor !== null && typeof valor === "object") {
      if (vistos.indexOf(valor) !== -1) return;
      vistos.push(valor);
    }
    var chave = caminho.length ? caminho[caminho.length - 1] : null;
    try { fn(valor, caminho, chave); } catch (e) { /* ignora falha pontual */ }
    if (Array.isArray(valor)) {
      for (var i = 0; i < valor.length; i++) percorre(valor[i], caminho.concat([i]), fn, vistos, prof + 1);
    } else if (ehObj(valor)) {
      var ks;
      try { ks = Object.keys(valor); } catch (e) { ks = []; }
      for (var j = 0; j < ks.length; j++) {
        var v;
        try { v = valor[ks[j]]; } catch (e2) { continue; }
        percorre(v, caminho.concat([ks[j]]), fn, vistos, prof + 1);
      }
    }
  }

  function caminhoTexto(caminho) {
    var s = "";
    for (var i = 0; i < caminho.length; i++) {
      if (typeof caminho[i] === "number") s += "[" + caminho[i] + "]";
      else s += (s ? "." : "") + caminho[i];
    }
    return s;
  }

  /* Junta todas as strings de um valor (para buscar "FILIPETA N", "TAREFA N"...). */
  function textos(valor) {
    var out = [];
    percorre(valor, [], function (v) { if (typeof v === "string") out.push(v); });
    return out;
  }

  /* Lista todos os blocos (objetos com "tipo") dentro de um valor. */
  function blocos(valor, base) {
    var out = [];
    percorre(valor, base || [], function (v, caminho) {
      if (ehObj(v) && typeof v.tipo === "string") out.push({ bloco: v, caminho: caminho });
    });
    return out;
  }

  /* -------------------------------------------------------------------
   * 3. CONTEXTO DA ESTAÇÃO
   * ------------------------------------------------------------------- */
  function montaContexto(e) {
    var ctx = {};
    ctx.banca = str(pega(e, "banca"));
    ctx.regra = REGRAS_BANCAS.hasOwnProperty(ctx.banca) ? REGRAS_BANCAS[ctx.banca] : null;
    ctx.ehExemplo = pega(e, "eh_exemplo") === true;
    ctx.area = str(pega(e, "area"));
    ctx.areaProcedimento = /procedimento/i.test(ctx.area);
    ctx.procedimento = ctx.banca === "einstein" && ctx.areaProcedimento;
    ctx.checklist = obj(pega(e, "checklist"));
    ctx.grupos = arr(ctx.checklist.grupos);
    ctx.itens = [];
    for (var g = 0; g < ctx.grupos.length; g++) {
      var grupo = obj(ctx.grupos[g]);
      var its = arr(grupo.itens);
      for (var i = 0; i < its.length; i++) {
        ctx.itens.push({ item: obj(its[i]), bruto: its[i], g: g, i: i, tarefa: grupo.tarefa });
      }
    }
    ctx.referencias = arr(pega(e, "referencias"));
    ctx.soft = pega(e, "soft_skills");
    ctx.roteiro = pega(e, "roteiro");
    return ctx;
  }

  function nomeItem(x) {
    var t = str(x.item.texto).replace(/\*\*|\*/g, "").trim();
    var curto = t.length > 60 ? t.slice(0, 57) + "..." : t;
    return "item " + (x.g + 1) + "." + (x.i + 1) + (curto ? " (\"" + curto + "\")" : "");
  }

  /* Uma seção está "preenchida"? (critério por campo) */
  function preenchida(e, campo) {
    var v = pega(e, campo);
    if (campo === "roteiro") {
      if (!ehObj(v)) return false;
      var ks = Object.keys(v);
      for (var i = 0; i < ks.length; i++) if (!vazio(v[ks[i]])) return true;
      return false;
    }
    if (campo === "discussao_tecnica") return ehObj(v) && arr(v.blocos).length > 0;
    if (campo === "orientacoes_ator") return ehObj(v) && arr(v.blocos).length > 0;
    if (campo === "soft_skills") return ehObj(v) && (arr(v.itens).length > 0 || arr(v.blocos).length > 0);
    if (campo === "checklist") return ehObj(v) && arr(v.grupos).length > 0;
    if (campo === "numero_estacao") return v !== null && v !== undefined && v !== "";
    return !vazio(v);
  }

  /* -------------------------------------------------------------------
   * 4. GRUPOS DE REGRAS
   * ------------------------------------------------------------------- */

  /* ---------- 4.1 Metadados ---------- */
  function regrasMetadados(e, ctx, add) {
    var S = "Metadados";
    var obrig = ["id", "banca", "edicao", "titulo", "area"];
    for (var i = 0; i < obrig.length; i++) {
      var v = pega(e, obrig[i]);
      if (vazio(v) || typeof v !== "string") {
        add("erro", S, "Campo obrigatório \"" + obrig[i] + "\" ausente ou vazio.", "ME-01");
      }
    }
    var id = pega(e, "id");
    if (typeof id === "string" && id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
      add("aviso", S, "O id \"" + id + "\" deve usar só minúsculas sem acento, números e hífens (igual ao nome da pasta em saidas/).", "ME-02");
    }
    var banca = pega(e, "banca");
    if (typeof banca === "string" && banca && !ctx.regra) {
      add("erro", S, "Banca \"" + banca + "\" desconhecida. Use: " + Object.keys(REGRAS_BANCAS).join(", ") + ". As regras específicas de banca não foram aplicadas.", "ME-03");
    }
    var status = pega(e, "status");
    if (STATUS.indexOf(status) === -1) {
      add("erro", S, "Status \"" + (status === undefined ? "(ausente)" : String(status)) + "\" fora do permitido (" + STATUS.join(" | ") + ").", "ME-04");
    }
    var edicao = pega(e, "edicao");
    if (typeof edicao === "string" && edicao && !/^\d{4}$/.test(edicao)) {
      add("aviso", S, "Edição \"" + edicao + "\" fora do padrão de 4 dígitos (ex.: \"2027\"); ela aparece no rodapé.", "ME-05");
    }
    if (pega(e, "versao_esquema") !== 1) {
      add("aviso", S, "versao_esquema deveria ser 1 (valor atual: " + String(pega(e, "versao_esquema")) + ").", "ME-06");
    }
    if (ctx.ehExemplo) {
      add("info", S, "Arquivo de exemplo (eh_exemplo = true): regras de rastreabilidade (refs) e de ineditismo não são cobradas.", "ME-07");
    }
    var r = ctx.regra;
    if (r && r.areas && ctx.area && !ctx.areaProcedimento) {
      var ok = false;
      for (var a = 0; a < r.areas.length; a++) if (normaliza(r.areas[a]) === normaliza(ctx.area)) ok = true;
      if (!ok) add("aviso", S, "Área \"" + ctx.area + "\" fora das áreas documentadas para " + r.nome + " (" + r.areas.join(", ") + ").", "ME-08");
    }
    if (ctx.banca === "einstein") {
      var dia = str(pega(e, "dia"));
      if (dia && !/^Dia [12]$/.test(dia.trim())) add("aviso", S, "Dia \"" + dia + "\" fora do padrão \"Dia 1\" ou \"Dia 2\".", "ME-09");
    }
    if (ctx.banca === "unifesp-rmais") {
      var n = pega(e, "numero_estacao");
      if (n !== null && n !== undefined && !(num(n) || /^\d+$/.test(str(n)))) {
        add("aviso", S, "numero_estacao deveria ser um número (título \"Estação N - Tema\").", "ME-10");
      }
    }
  }

  /* ---------- 4.2 Estrutura por banca ---------- */
  function regrasEstrutura(e, ctx, add) {
    var r = ctx.regra;
    if (!r) return;
    var S = "Estrutura";
    if (ctx.banca === "tradicional") {
      add("info", S, "Banca Tradicional não tem perfil documentado em analises/: só as regras gerais foram aplicadas.", "ES-07");
    }
    var mapa = ctx.procedimento ? r.secoes_procedimento : r.secoes;
    var rotulo = ctx.procedimento ? r.nome + " (procedimento)" : r.nome;
    var ks = Object.keys(mapa);
    for (var i = 0; i < ks.length; i++) {
      var campo = ks[i], exig = mapa[campo], nome = ROTULO_CAMPO[campo] || NOME_SECAO[campo] || campo;
      if (campo === "referencias") continue; // tratado em regrasReferencias (RF-01), que considera eh_exemplo
      var tem = preenchida(e, campo);
      if (exig === "obrigatorio" && !tem) {
        add("erro", NOME_SECAO[campo] || S, "Seção obrigatória em " + rotulo + " ausente ou vazia: " + nome + " (\"" + campo + "\").", "ES-01");
      } else if (exig === "recomendado" && !tem) {
        if (campo === "soft_skills") continue; // tratado em regrasSoftSkills (SS-01)
        add("aviso", NOME_SECAO[campo] || S, "Seção esperada em " + rotulo + " ausente ou vazia: " + nome + " (\"" + campo + "\").", "ES-02");
      } else if (exig === "ausente" && tem) {
        if (campo === "soft_skills") continue; // tratado em regrasSoftSkills (SS-05)
        var extra = "";
        if (ctx.banca === "unifesp-rmais" && ["objetivos", "criterios", "roteiro", "local", "orientacoes_examinador", "orientacoes_ator"].indexOf(campo) !== -1) {
          extra = " O diagramado R+ 2026 começa direto em FILIPETAS; se for roteiro interno de aplicação, confirme se o renderer deve exibi-lo.";
        }
        if (ctx.procedimento && campo === "criterios") {
          extra = " A diagramação (seção 6) diz que CRITÉRIOS não aparece em procedimentos; o esqueleto do perfil Einstein sugere um item \"Competências técnicas (50 pontos)\".";
        }
        add("aviso", NOME_SECAO[campo] || S, "Seção \"" + nome + "\" preenchida, mas não faz parte do formato " + rotulo + "." + extra, "ES-03");
      }
    }

    // Einstein: orientações da estação só em procedimento
    if (ctx.banca === "einstein" && !ctx.procedimento && preenchida(e, "orientacoes_estacao")) {
      // já coberto por ES-03 quando "ausente"; nada a fazer
    }

    // Subcampos do roteiro
    if (ehObj(ctx.roteiro) && preenchida(e, "roteiro")) {
      var sub = arr(r.subcampos_roteiro);
      for (var s = 0; s < sub.length; s++) {
        if (vazio(ctx.roteiro[sub[s]])) {
          add("aviso", "Roteiro da estação", "Subcampo \"roteiro." + sub[s] + "\" vazio (esperado em " + r.nome + ").", "ES-04");
        }
      }
    }

    // Ator x orientações ao ator
    var atores = ehObj(ctx.roteiro) ? str(ctx.roteiro.atores) : "";
    var semAtor = !atores.trim() || /sem\s+atores?|sem\s+atriz|apenas\s+o\s+avaliador/i.test(atores);
    var temOrientAtor = preenchida(e, "orientacoes_ator");
    if (!semAtor && !temOrientAtor && ctx.banca !== "unifesp-rmais") {
      add("aviso", "Orientações ao ator", "O roteiro descreve ator/atriz, mas não há ORIENTAÇÕES AO ATOR.", "ES-05");
    }
    if (semAtor && temOrientAtor && ehObj(ctx.roteiro) && ctx.banca !== "unifesp-rmais") {
      add("aviso", "Orientações ao ator", "Há ORIENTAÇÕES AO ATOR, mas o roteiro não descreve ator/atriz (roteiro.atores vazio ou \"sem atores\").", "ES-05");
    }

    // USP-RP: título do bloco do checklist
    if (r.titulo_bloco_obrigatorio) {
      var tb = str(ctx.checklist.titulo_bloco);
      if (normaliza(tb) !== normaliza(r.titulo_bloco_obrigatorio)) {
        add("aviso", "Checklist", "Título do bloco do checklist deveria ser \"" + r.titulo_bloco_obrigatorio + "\" (atual: \"" + tb + "\").", "ES-06");
      }
    } else if (r.titulos_bloco && ctx.checklist.titulo_bloco !== undefined) {
      var tb2 = str(ctx.checklist.titulo_bloco), okT = false;
      for (var t = 0; t < r.titulos_bloco.length; t++) if (normaliza(tb2) === normaliza(r.titulos_bloco[t])) okT = true;
      if (!okT) add("info", "Checklist", "Título do bloco do checklist \"" + tb2 + "\" diferente do usado em " + r.nome + " (" + r.titulos_bloco.join(" / ") + ").", "ES-06");
    }

    // Unifesp R1: critérios só com "Competências técnicas"
    if (r.somente_criterio_tecnico) {
      var crit = arr(pega(e, "criterios"));
      for (var c = 0; c < crit.length; c++) {
        var dom = normaliza(obj(crit[c]).dominio);
        if (dom && dom.indexOf("tecnic") === -1) {
          add("aviso", "Critérios de avaliação", "Domínio \"" + obj(crit[c]).dominio + "\" no Unifesp R1: a banca lista só \"Competências técnicas\"; atitudes entram como itens do checklist.", "ES-08");
        }
      }
    }

    // Unifesp R+: subtítulos da discussão
    if (r.subtitulos_discussao && preenchida(e, "discussao_tecnica")) {
      var subs = [];
      var bl = arr(obj(pega(e, "discussao_tecnica")).blocos);
      for (var b = 0; b < bl.length; b++) if (obj(bl[b]).tipo === "subtitulo") subs.push(normaliza(obj(bl[b]).texto));
      for (var k = 0; k < r.subtitulos_discussao.length; k++) {
        var alvo = normaliza(r.subtitulos_discussao[k]), achou = false;
        for (var m = 0; m < subs.length; m++) if (subs[m].indexOf(alvo) !== -1) achou = true;
        if (!achou) add("info", "Discussão técnica", "No R+ 2026 a discussão traz o subtítulo \"" + r.subtitulos_discussao[k] + "\"; não encontrado.", "ES-09");
      }
    }

    // Einstein procedimento sem rótulo de área coerente
    if (ctx.banca === "einstein" && !ctx.areaProcedimento && preenchida(e, "orientacoes_estacao")) {
      add("info", "Orientações da estação", "orientacoes_estacao preenchido, mas a área não indica \"Procedimento\"; a estação foi tratada como clínica.", "ES-10");
    }

    // Extensão da discussão técnica (informativo)
    if (r.faixa_palavras_discussao && preenchida(e, "discussao_tecnica")) {
      var pal = 0, ts = textos(arr(obj(pega(e, "discussao_tecnica")).blocos));
      for (var p = 0; p < ts.length; p++) pal += contaPalavras(ts[p]);
      var f = r.faixa_palavras_discussao;
      if (pal < f[0] || pal > f[1]) add("info", "Discussão técnica", "Discussão técnica com cerca de " + pal + " palavras; o perfil " + r.nome + " indica " + f[0] + " a " + f[1] + ".", "ES-11");
    }
  }

  /* ---------- 4.3 Checklist ---------- */
  function regrasChecklist(e, ctx, add) {
    var S = "Checklist";
    var r = ctx.regra;
    var ck = pega(e, "checklist");
    if (!ehObj(ck)) return; // ausência já acusada em ES-01
    var escala = ck.escala;

    // Escala
    if (ESCALAS.indexOf(escala) === -1) {
      add("erro", S, "Escala \"" + String(escala) + "\" inválida. Use: " + ESCALAS.join(" | ") + ".", "CK-01");
    } else if (r && r.escala && escala !== r.escala) {
      add("erro", S, "Escala \"" + escala + "\" incompatível com " + r.nome + " (esperado: \"" + r.escala + "\").", "CK-02");
    }

    // Total esperado coerente com a banca
    var total = ck.total_esperado;
    var semSoft = !preenchida(e, "soft_skills");
    if (r) {
      if (r.totais_aceitos) {
        var aceito = false;
        for (var t = 0; t < r.totais_aceitos.length; t++) {
          if (r.totais_aceitos[t] === null ? (total === null || total === undefined) : iguais(total, r.totais_aceitos[t])) aceito = true;
        }
        if (!aceito) add("erro", S, "total_esperado = " + fmt(total) + " incompatível com " + r.nome + " (use 10 quando houver pesos ou null quando não houver).", "CK-03");
      } else if (ctx.procedimento) {
        if (!iguais(total, r.total_checklist_procedimento)) {
          add("erro", S, "total_esperado = " + fmt(total) + " incompatível com Einstein procedimento (esperado: 50 por procedimento).", "CK-03");
        }
      } else if (num(r.total_checklist)) {
        if (!iguais(total, r.total_checklist)) {
          if (ctx.banca === "einstein" && semSoft) {
            add("aviso", S, "total_esperado = " + fmt(total) + " (Einstein clínico usa 30). Estação sem soft skills é exceção (CG 2026 Dia 1); a pontuação técnica dessa exceção não está documentada no perfil.", "CK-03");
          } else {
            add("erro", S, "total_esperado = " + fmt(total) + " incompatível com " + r.nome + " (esperado: " + fmt(r.total_checklist) + ").", "CK-03");
          }
        }
      }
    }

    // Itens: valores e soma
    var pontuaPeso = r ? (r.pontua_por_peso || (ctx.banca === "usp-ribeirao" && num(total))) : num(total);
    var soma = 0, semValor = 0, comValor = 0, invalidos = 0;
    if (ctx.itens.length === 0 && arr(ck.grupos).length > 0) {
      add("erro", S, "O checklist tem grupos, mas nenhum item.", "CK-04");
    }
    for (var g = 0; g < arr(ck.grupos).length; g++) {
      if (!ehObj(ck.grupos[g])) add("erro", S, "Grupo " + (g + 1) + " do checklist malformado (não é objeto).", "CK-04");
      else if (arr(ck.grupos[g].itens).length === 0) add("aviso", S, "Grupo " + (g + 1) + " do checklist sem itens.", "CK-04");
    }
    var vistos = {};
    for (var i = 0; i < ctx.itens.length; i++) {
      var x = ctx.itens[i], it = x.item, nome = nomeItem(x);
      if (!ehObj(x.bruto)) { add("erro", S, "Item " + (x.g + 1) + "." + (x.i + 1) + " malformado (não é objeto).", "CK-04"); continue; }
      if (vazio(it.texto)) add("erro", S, "Item " + (x.g + 1) + "." + (x.i + 1) + " sem texto.", "CK-05");
      var chave = normaliza(it.texto);
      if (chave) {
        if (vistos[chave]) add("aviso", S, "Texto repetido no checklist: " + nome + " repete o item " + vistos[chave] + ".", "CK-06");
        else vistos[chave] = (x.g + 1) + "." + (x.i + 1);
      }
      var v = it.valor;
      if (v === null || v === undefined) {
        semValor++;
        if (pontuaPeso) add("erro", S, nome + " sem valor; " + (r ? r.nome : "a banca") + " pontua por peso.", "CK-07");
        continue;
      }
      if (!num(v)) { invalidos++; add("erro", S, nome + ": valor \"" + String(v) + "\" não é número (use ponto decimal, ex.: 2.5).", "CK-08"); continue; }
      comValor++;
      if (it.negativo === true) {
        if (r && !r.negativo_permitido) add("aviso", S, nome + " marcado como negativo (desconta pontos), mas " + r.nome + " não desconta: itens \"Não fez X\" pontuam positivamente.", "CK-09");
        continue; // item negativo não entra na soma dos pontos possíveis
      }
      if (v <= 0) add("aviso", S, nome + " com valor " + fmt(v) + " sem estar marcado como negativo.", "CK-10");
      soma += v;
      if (r && r.faixa_valor && !ctx.procedimento && (v < r.faixa_valor[0] - 0.001 || v > r.faixa_valor[1] + 0.001)) {
        add("aviso", S, nome + " vale " + fmt(v) + ", fora da faixa típica de " + r.nome + " (" + fmt(r.faixa_valor[0]) + " a " + fmt(r.faixa_valor[1]) + ").", "CK-11");
      }
      if (r && r.multiplo_valor && Math.abs(v / r.multiplo_valor - Math.round(v / r.multiplo_valor)) > 0.001) {
        add("aviso", S, nome + " vale " + fmt(v) + "; no " + r.nome + " os valores são múltiplos de " + r.multiplo_valor + ".", "CK-11");
      }
    }
    if (num(total)) {
      if (comValor > 0 && !iguais(soma, total)) {
        add("erro", S, "A soma dos valores do checklist é " + fmt(soma) + ", mas total_esperado é " + fmt(total) + " (diferença de " + fmt(total - soma) + ").", "CK-12");
      }
    } else if (total !== null && total !== undefined) {
      add("erro", S, "total_esperado \"" + String(total) + "\" não é número nem null.", "CK-12");
    } else if (comValor > 0 && ctx.banca === "usp-ribeirao") {
      add("aviso", S, "Há itens com valor, mas total_esperado é null. No USP-RP, use total 10 quando houver pesos (padrão CM 2025) ou retire os valores.", "CK-13");
    }

    // Número de itens
    if (r && r.faixa_itens && ctx.itens.length > 0) {
      var n = ctx.itens.length;
      var faixa = ctx.procedimento ? r.faixa_itens_procedimento : r.faixa_itens;
      var limite = ctx.procedimento ? null : r.faixa_itens_limite;
      if (n < faixa[0] || n > (limite || faixa[1])) {
        add("aviso", S, n + " itens no checklist, fora da faixa típica de " + (ctx.procedimento ? "Einstein procedimento" : r.nome) + " (" + faixa[0] + " a " + faixa[1] + (limite ? "; até " + limite + " com várias tarefas" : "") + ").", "CK-14");
      } else if (n > faixa[1]) {
        add("info", S, n + " itens no checklist: acima da faixa típica (" + faixa[0] + " a " + faixa[1] + "), aceitável só em estação com várias tarefas.", "CK-14");
      }
    }

    // Critério de parcial
    if (escala === "sim-parcial-nao") {
      for (var p = 0; p < ctx.itens.length; p++) {
        if (vazio(ctx.itens[p].item.parcial)) {
          add("aviso", S, nomeItem(ctx.itens[p]) + " sem critério de Parcial; escreva o critério ou \"Não se aplica\".", "CK-15");
        }
      }
    } else if (ESCALAS.indexOf(escala) !== -1) {
      for (var q = 0; q < ctx.itens.length; q++) {
        var pc = ctx.itens[q].item.parcial;
        if (!vazio(pc) && normaliza(pc) !== "nao se aplica") {
          add("aviso", S, nomeItem(ctx.itens[q]) + " tem critério de Parcial, mas a escala \"" + escala + "\" não tem coluna PARCIAL; o critério não será exibido como tal.", "CK-15");
        }
      }
    }

    // USP-RP CM: par de comunicação de fechamento
    if (ctx.banca === "usp-ribeirao" && normaliza(ctx.area) === "clinica medica" && ctx.itens.length) {
      var tudo = normaliza(textos(ck.grupos).join(" "));
      if (tudo.indexOf("sequencia logica") === -1 || tudo.indexOf("linguagem clara") === -1) {
        add("info", S, "Em Clínica Médica a USP-RP sempre fecha com \"Seguiu sequência lógica / Aguardou tempo de resposta\" e \"Orientou com linguagem clara / Certificou que entendeu\"; não encontrado.", "CK-16");
      }
    }

    // Item de apresentação em estação com ator
    var atores = ehObj(ctx.roteiro) ? str(ctx.roteiro.atores) : "";
    if (r && ["einstein", "sirio-libanes", "usp-ribeirao"].indexOf(ctx.banca) !== -1 && !ctx.procedimento && atores.trim() && !/sem\s+atores?/i.test(atores)) {
      var tem = false;
      for (var a = 0; a < ctx.itens.length; a++) if (/apresent/i.test(str(ctx.itens[a].item.texto))) tem = true;
      if (!tem && ctx.itens.length) add("info", S, "Estação com ator sem item de apresentação (nome e função), que costuma abrir o checklist em " + r.nome + ".", "CK-17");
    }
  }

  /* ---------- 4.4 Soft skills e critérios ---------- */
  function regrasSoftSkills(e, ctx, add) {
    var S = "Soft skills";
    var r = ctx.regra;
    if (!r) return;
    var tem = preenchida(e, "soft_skills");
    var ss = obj(ctx.soft);

    if (r.soft_skills === "nao" && tem) {
      add("aviso", S, r.nome + " não tem soft skills pontuadas à parte; o bloco soft_skills está preenchido e deveria ser null (comunicação entra como item do checklist).", "SS-05");
      return;
    }
    if (ctx.procedimento && tem) {
      add("aviso", S, "Estação de procedimento do Einstein é 100% técnica (50 + 50); o bloco soft_skills deveria ser null.", "SS-05");
      return;
    }
    if (ctx.banca === "einstein" && !ctx.procedimento && !tem) {
      add("aviso", S, "Estação clínica do Einstein sem soft skills. É exceção possível (CG 2026 Dia 1, 100% técnica); confirme se é intencional.", "SS-01");
    }

    if (tem) {
      var itens = arr(ss.itens);
      var total = ss.total_esperado;
      var soma = 0, comValor = 0;
      for (var i = 0; i < itens.length; i++) {
        var it = obj(itens[i]);
        if (vazio(it.dominio)) add("aviso", S, "Domínio " + (i + 1) + " de soft skills sem nome.", "SS-06");
        if (num(it.valor)) { soma += it.valor; comValor++; }
        else if (r.soft_skills === "pontuado") add("erro", S, "Domínio \"" + str(it.dominio) + "\" sem valor numérico.", "SS-06");
        if (r.valores_dominio_soft && num(it.valor) && r.valores_dominio_soft.indexOf(it.valor) === -1) {
          add("info", S, "Domínio \"" + str(it.dominio) + "\" vale " + fmt(it.valor) + "; no Einstein os domínios valem 20 ou 30.", "SS-07");
        }
      }
      if (num(total) && comValor > 0 && !iguais(soma, total)) {
        add("erro", S, "A soma dos domínios de soft skills é " + fmt(soma) + ", mas soft_skills.total_esperado é " + fmt(total) + ".", "SS-02");
      }
      if (r.soft_skills === "pontuado") {
        if (!iguais(total, r.total_soft_skills)) {
          add("erro", S, "soft_skills.total_esperado = " + fmt(total) + "; no Einstein as soft skills valem 70.", "SS-03");
        }
        if (itens.length && itens.length !== 3) {
          add("aviso", S, itens.length + " domínios de soft skills; o Einstein usa 3 domínios que somam 70.", "SS-04");
        }
        if (!itens.length) add("aviso", S, "Bloco soft_skills sem domínios pontuados (itens): a soma dos 70 pontos não pode ser conferida.", "SS-04");
        if (!arr(ss.blocos).length) add("aviso", S, "Seção Soft Skills sem texto (blocos); no 2026 ela é um texto corrido de 300 a 600 palavras.", "SS-08");
        else {
          var pal = 0, ts = textos(ss.blocos);
          for (var p = 0; p < ts.length; p++) pal += contaPalavras(ts[p]);
          if (pal < 300 || pal > 600) add("info", S, "Texto de Soft Skills com cerca de " + pal + " palavras; o perfil indica 300 a 600.", "SS-08");
        }
      }
      if (r.soft_skills === "texto") {
        if (itens.length || num(total)) {
          add("aviso", S, "No HSL a seção Soft Skills é narrativa: os 100 pontos estão todos no checklist. Remova itens/total_esperado de soft_skills ou confirme o formato.", "SS-09");
        }
        // SS-12: sem itens, o módulo online (D4b, privado.soft_itens) deriva domínios de soft skills
        // dos critérios não técnicos com pontos: aparece um painel de 5 níveis e o total passa de 100.
        if (!itens.length) {
          var critP = arr(pega(e, "criterios")).filter(function (x) {
            x = obj(x);
            return num(x.pontos) && !vazio(x.dominio) && !/^competencias? tecnicas?$/.test(normaliza(x.dominio).trim());
          });
          if (critP.length) {
            add("aviso", "Critérios de avaliação", "No HSL, " + critP.map(function (x) { return "\"" + str(obj(x).dominio) + "\" (" + fmt(obj(x).pontos) + ")"; }).join(", ") +
              " tem pontos nos critérios e a estação tem seção Soft Skills: na aplicação online isso vira um painel de soft skills à parte e o total passa de 100. Tire os pontos dos critérios não técnicos (os 100 pontos ficam no checklist).", "SS-12");
          }
        }
      }
    }

    // Critérios de avaliação com pontos (Einstein clínico)
    if (ctx.banca === "einstein" && !ctx.procedimento) {
      var crit = arr(pega(e, "criterios"));
      if (crit.length) {
        var somaC = 0, tecnico = null, naoTec = [], semPontos = 0;
        for (var c = 0; c < crit.length; c++) {
          var cr = obj(crit[c]);
          if (!num(cr.pontos)) { semPontos++; continue; }
          somaC += cr.pontos;
          if (normaliza(cr.dominio).indexOf("tecnic") !== -1) tecnico = cr.pontos;
          else naoTec.push(cr);
        }
        if (semPontos) add("aviso", "Critérios de avaliação", semPontos + " domínio(s) sem pontos; no Einstein 2026 cada domínio traz a pontuação.", "SS-10");
        var esperado = tem ? 100 : null;
        if (esperado && !iguais(somaC, esperado) && !semPontos) {
          add("aviso", "Critérios de avaliação", "Os domínios dos critérios somam " + fmt(somaC) + "; no Einstein clínico devem somar 100 (técnico 30 + não técnicos 70).", "SS-10");
        }
        if (tecnico !== null && num(ctx.checklist.total_esperado) && !iguais(tecnico, ctx.checklist.total_esperado)) {
          add("aviso", "Critérios de avaliação", "Competências técnicas valem " + fmt(tecnico) + " nos critérios, mas o checklist totaliza " + fmt(ctx.checklist.total_esperado) + ".", "SS-11");
        }
        if (tem && arr(ss.itens).length && naoTec.length) {
          var mapaSS = {};
          var its = arr(ss.itens);
          for (var s = 0; s < its.length; s++) mapaSS[normaliza(obj(its[s]).dominio)] = obj(its[s]).valor;
          for (var n = 0; n < naoTec.length; n++) {
            var dn = normaliza(naoTec[n].dominio);
            if (!mapaSS.hasOwnProperty(dn)) add("aviso", "Critérios de avaliação", "Domínio \"" + str(naoTec[n].dominio) + "\" dos critérios não aparece em soft_skills.itens.", "SS-11");
            else if (!iguais(mapaSS[dn], naoTec[n].pontos)) add("aviso", "Critérios de avaliação", "Domínio \"" + str(naoTec[n].dominio) + "\" vale " + fmt(naoTec[n].pontos) + " nos critérios e " + fmt(mapaSS[dn]) + " em soft_skills.", "SS-11");
          }
        }
      }
    }
  }

  /* ---------- 4.5 Coerência interna (filipetas, tarefas, imagens, blocos) ---------- */
  function regrasCoerencia(e, ctx, add) {
    var r = ctx.regra;
    var fil = arr(pega(e, "filipetas"));

    // Numeração das filipetas
    var existentes = {}, ordem = [];
    for (var i = 0; i < fil.length; i++) {
      var f = obj(fil[i]);
      var m = /FILIPETA\s+(\d+)/i.exec(str(f.rotulo));
      var n = m ? parseInt(m[1], 10) : i + 1;
      if (existentes[n]) add("aviso", "Filipetas", "FILIPETA " + n + " aparece mais de uma vez.", "CO-01");
      existentes[n] = true;
      ordem.push(n);
      if (!arr(f.caixas).length) add("aviso", "Filipetas", "Filipeta " + (i + 1) + (f.rotulo ? " (\"" + str(f.rotulo) + "\")" : "") + " sem caixas.", "CO-02");
      var cx = arr(f.caixas);
      for (var c = 0; c < cx.length; c++) {
        if (!arr(obj(cx[c]).blocos).length) add("aviso", "Filipetas", "Caixa " + (c + 1) + " da filipeta " + (i + 1) + (obj(cx[c]).rotulo ? " (\"" + str(obj(cx[c]).rotulo) + "\")" : "") + " sem blocos.", "CO-02");
      }
    }
    for (var o = 0; o < ordem.length; o++) {
      if (ordem[o] !== o + 1) { add("aviso", "Filipetas", "Numeração das filipetas fora de sequência (" + ordem.join(", ") + ").", "CO-01"); break; }
    }
    if (ctx.banca === "sirio-libanes" && fil.length && !/tempo\s+para\s+leitura/i.test(str(obj(fil[0]).rotulo))) {
      add("info", "Filipetas", "No HSL a FILIPETA 1 traz \"(enunciado) - Tempo para leitura: 1 minuto\" no rótulo.", "CO-03");
    }

    // "FILIPETA N" citada nas orientações
    var fontes = [
      ["orientacoes_examinador", "Orientações ao examinador"],
      ["orientacoes_ator", "Orientações ao ator"],
      ["orientacoes_estacao", "Orientações da estação"],
      ["apos_filipetas", "Blocos após as filipetas"],
      ["roteiro", "Roteiro da estação"]
    ];
    var citadasExaminador = {};
    for (var s = 0; s < fontes.length; s++) {
      var ts = textos(pega(e, fontes[s][0]));
      var jaAvisou = {};
      for (var t = 0; t < ts.length; t++) {
        // aceita "FILIPETA 3" e listas como "FILIPETAS 5, 6 e 7" / "FILIPETAS 2 a 4"
        var re = /FILIPETAS?\s+(\d+(?:\s*(?:,|e|a|ou)\s*\d+)*)/gi, mm;
        while ((mm = re.exec(ts[t])) !== null) {
          var nums = mm[1].match(/\d+/g) || [];
          if (/\d+\s*a\s*\d+/i.test(mm[1]) && nums.length === 2) {
            var ini = parseInt(nums[0], 10), fim = parseInt(nums[1], 10);
            nums = [];
            for (var w = ini; w <= fim && w - ini < 50; w++) nums.push(String(w));
          }
          for (var u = 0; u < nums.length; u++) {
            var k = parseInt(nums[u], 10);
            if (fontes[s][0] === "orientacoes_examinador") citadasExaminador[k] = true;
            if (!existentes[k] && !jaAvisou[k]) {
              jaAvisou[k] = true;
              add("erro", fontes[s][1], "\"FILIPETA " + k + "\" é citada, mas não existe (filipetas existentes: " + (ordem.length ? ordem.join(", ") : "nenhuma") + ").", "CO-04");
            }
          }
        }
      }
    }
    // Toda filipeta a partir da 2 deveria ter regra de entrega nas orientações ao examinador
    if (preenchida(e, "orientacoes_examinador") && ["sirio-libanes", "einstein", "usp-ribeirao"].indexOf(ctx.banca) !== -1) {
      for (var q = 0; q < ordem.length; q++) {
        if (ordem[q] >= 2 && !citadasExaminador[ordem[q]]) {
          add("aviso", "Orientações ao examinador", "FILIPETA " + ordem[q] + " não tem regra de entrega nas orientações ao examinador.", "CO-05");
        }
      }
    }

    // TAREFA N: filipetas x checklist
    var tarefasFil = {}, unicaFil = false;
    var tf = textos(fil);
    for (var a = 0; a < tf.length; a++) {
      var re2 = /TAREFA\s+(\d+)/g, m2;
      while ((m2 = re2.exec(tf[a])) !== null) tarefasFil[parseInt(m2[1], 10)] = true;
      if (/TAREFA\s+[ÚU]NICA/.test(tf[a])) unicaFil = true;
    }
    var tarefasCk = {}, unicaCk = false, usaColuna = false, numerosSoltos = false;
    for (var g = 0; g < ctx.grupos.length; g++) {
      var tg = str(obj(ctx.grupos[g]).tarefa);
      if (/TAREFA/i.test(tg)) {
        usaColuna = true;
        var m3 = /TAREFA\s+(\d+)/i.exec(tg);
        if (m3) tarefasCk[parseInt(m3[1], 10)] = true;
        if (/[ÚU]NICA/i.test(tg)) unicaCk = true;
      } else if (/^\s*\d+\s*$/.test(tg)) numerosSoltos = true;
    }
    // TAREFA ÚNICA equivale a TAREFA 1 (convenção do esquema, 16/11/2026)
    var haviaNumeradaFil = Object.keys(tarefasFil).length > 0;
    if (unicaFil && !haviaNumeradaFil) tarefasFil[1] = true;
    if (unicaCk && !Object.keys(tarefasCk).length) tarefasCk[1] = true;
    if (numerosSoltos && !usaColuna) {
      add("info", "Checklist", "A coluna TAREFA usa números de item (padrão USP-RP Preventiva/Pediatria); a correspondência com as tarefas das filipetas não foi conferida.", "CO-06");
    }
    if (usaColuna) {
      var kf = Object.keys(tarefasFil), kc = Object.keys(tarefasCk);
      for (var x = 0; x < kf.length; x++) {
        if (!tarefasCk[kf[x]]) add("erro", "Checklist", "TAREFA " + kf[x] + " aparece nas filipetas, mas não tem itens no checklist.", "CO-07");
      }
      for (var y = 0; y < kc.length; y++) {
        if (!tarefasFil[kc[y]]) add("erro", "Checklist", "O checklist pontua a TAREFA " + kc[y] + ", que não existe nas filipetas.", "CO-07");
      }
    }
    if (unicaFil && haviaNumeradaFil) {
      add("aviso", "Filipetas", "As filipetas misturam TAREFA ÚNICA com tarefas numeradas.", "CO-08");
    }
    if (fil.length && !unicaFil && !Object.keys(tarefasFil).length) {
      add("aviso", "Filipetas", "Nenhuma \"TAREFA\" encontrada nas filipetas (esperado TAREFA ÚNICA ou TAREFA 1, 2...).", "CO-08");
    }

    // Blocos: tipo, imagem, tabela
    var todos = blocos(e, []);
    var contTipo = 0;
    for (var b = 0; b < todos.length; b++) {
      var bl = todos[b].bloco, cam = todos[b].caminho, top = cam[0];
      var sec = NOME_SECAO[top] || "Estrutura";
      if (top === "revisao") continue;
      if (TIPOS_BLOCO.indexOf(bl.tipo) === -1) {
        if (contTipo++ < 10) add("aviso", sec, "Bloco de tipo desconhecido \"" + bl.tipo + "\" em " + caminhoTexto(cam) + " (tipos válidos: " + TIPOS_BLOCO.join(", ") + ").", "CO-09");
        continue;
      }
      if (bl.tipo === "imagem") {
        if (vazio(bl.arquivo)) add("aviso", sec, "Imagem sem arquivo em " + caminhoTexto(cam) + (bl.titulo ? " (\"" + str(bl.titulo) + "\")" : "") + "; o renderer mostrará \"imagem pendente\".", "CO-10");
        if (vazio(bl.fonte)) add("aviso", sec, "Imagem sem \"fonte\" em " + caminhoTexto(cam) + "; toda imagem precisa de \"Fonte:\".", "CO-11");
      }
      if (bl.tipo === "tabela") {
        var cab = arr(bl.cabecalho), lin = arr(bl.linhas);
        if (!lin.length) add("aviso", sec, "Tabela sem linhas em " + caminhoTexto(cam) + ".", "CO-12");
        for (var l = 0; l < lin.length; l++) {
          if (cab.length && arr(lin[l]).length !== cab.length) {
            add("aviso", sec, "Tabela em " + caminhoTexto(cam) + ": a linha " + (l + 1) + " tem " + arr(lin[l]).length + " colunas e o cabeçalho tem " + cab.length + ".", "CO-12");
          }
        }
      }
      if (bl.tipo === "lista" && !arr(bl.itens).length) add("aviso", sec, "Lista vazia em " + caminhoTexto(cam) + ".", "CO-12");
    }

    // HSL: imagens exigem REFERÊNCIAS (imagens utilizadas na estação)
    if (ctx.banca === "sirio-libanes") {
      var temImg = false;
      for (var z = 0; z < todos.length; z++) if (todos[z].bloco.tipo === "imagem") temImg = true;
      if (temImg && !preenchida(e, "referencias_imagens")) {
        add("aviso", "Referências das imagens", "A estação tem imagens, mas \"REFERÊNCIAS (imagens utilizadas na estação)\" está vazio.", "CO-13");
      }
    }
  }

  /* ---------- 4.6 Referências e rastreabilidade (regra 5 do README) ---------- */
  function regrasReferencias(e, ctx, add) {
    var S = "Referências";
    var refsPrinc = ctx.referencias;
    var ss = obj(ctx.soft);
    var refsSoft = arr(ss.referencias).length ? arr(ss.referencias) : refsPrinc;

    if (!refsPrinc.length) {
      if (ctx.ehExemplo) add("info", S, "Lista de referências vazia (arquivo de exemplo).", "RF-01");
      else add("erro", S, "Lista de referências vazia: toda estação nova precisa das referências fornecidas que sustentam a parte técnica.", "RF-01");
    }
    for (var k = 0; k < refsPrinc.length; k++) {
      if (vazio(refsPrinc[k])) add("aviso", S, "Referência " + (k + 1) + " vazia.", "RF-02");
    }

    // Validade de todos os "refs"
    var citadas = {};
    var contInval = 0;
    percorre(e, [], function (v, caminho, chave) {
      if (chave !== "refs" || caminho[0] === "revisao") return;
      var naSoft = caminho[0] === "soft_skills";
      var lista = naSoft ? refsSoft : refsPrinc;
      var sec = NOME_SECAO[caminho[0]] || S;
      if (!Array.isArray(v)) {
        if (v !== null && v !== undefined && contInval++ < 15) add("erro", sec, "\"refs\" em " + caminhoTexto(caminho) + " deveria ser uma lista de números.", "RF-03");
        return;
      }
      for (var i = 0; i < v.length; i++) {
        var n = v[i];
        if (!num(n) || Math.floor(n) !== n || n < 1 || n > lista.length) {
          if (contInval++ < 15) add("erro", sec, "Ref " + String(n) + " em " + caminhoTexto(caminho) + " aponta para referência inexistente (" + (naSoft && arr(ss.referencias).length ? "soft_skills.referencias" : "referencias") + " tem " + lista.length + " itens).", "RF-03");
        } else if (!naSoft || !arr(ss.referencias).length) {
          citadas[n] = true;
        }
      }
    });
    if (contInval > 15) add("erro", S, "Há mais " + (contInval - 15) + " refs inválidas não listadas.", "RF-03");

    if (ctx.ehExemplo) return;

    // Itens de checklist sem refs
    var semRefs = [];
    for (var i = 0; i < ctx.itens.length; i++) {
      if (!arr(ctx.itens[i].item.refs).length) semRefs.push(ctx.itens[i]);
    }
    for (var s = 0; s < semRefs.length && s < 12; s++) {
      add("aviso", "Checklist", nomeItem(semRefs[s]) + " sem refs: indique a referência que sustenta o item.", "RF-04");
    }
    if (semRefs.length > 12) add("aviso", "Checklist", "Há mais " + (semRefs.length - 12) + " itens sem refs não listados.", "RF-04");

    // Parágrafos e tabelas da discussão técnica sem refs (agregado)
    var dbl = arr(obj(pega(e, "discussao_tecnica")).blocos), tot = 0, sem = 0;
    for (var d = 0; d < dbl.length; d++) {
      var b = obj(dbl[d]);
      if (b.tipo === "paragrafo" || b.tipo === "tabela") {
        tot++;
        if (!arr(b.refs).length) sem++;
      }
    }
    if (sem) add("aviso", "Discussão técnica", sem + " de " + tot + " parágrafos/tabelas da discussão técnica sem refs. Indique a fonte de cada ponto relevante (regra 5 do README).", "RF-05");

    // Referências nunca citadas
    var nunca = [];
    for (var r = 1; r <= refsPrinc.length; r++) if (!citadas[r]) nunca.push(r);
    if (nunca.length && refsPrinc.length) add("info", S, "Referência(s) " + nunca.join(", ") + " não citada(s) em nenhum refs.", "RF-06");

    // Quantidade de referências por banca
    var rg = ctx.regra;
    if (rg && rg.faixa_referencias && refsPrinc.length) {
      var f = rg.faixa_referencias;
      if (refsPrinc.length < f[0] || refsPrinc.length > f[1]) add("info", S, refsPrinc.length + " referências; o perfil " + rg.nome + " mostra " + f[0] + " a " + f[1] + ".", "RF-07");
    }
  }

  /* ---------- 4.7 Tempo ---------- */
  function regrasTempo(e, ctx, add) {
    var r = ctx.regra;
    if (!r || !num(r.tempo_min)) return;
    if (!ehObj(ctx.roteiro)) return;
    var tempo = str(ctx.roteiro.tempo);
    if (!tempo.trim()) return; // subcampo exigido só no HSL (ES-04)
    var m = /(\d+(?:[.,]\d+)?)\s*min/i.exec(tempo);
    if (!m) { add("aviso", "Roteiro da estação", "Não foi possível ler os minutos em roteiro.tempo (\"" + tempo + "\").", "TP-01"); return; }
    var min = parseFloat(m[1].replace(",", "."));
    if (!iguais(min, r.tempo_min)) {
      add("aviso", "Roteiro da estação", "Tempo de " + fmt(min) + " minutos; em " + r.nome + " a estação dura " + r.tempo_min + " minutos.", "TP-01");
    }
    if (ctx.banca === "sirio-libanes" && !/aviso\s+sonoro/i.test(tempo)) {
      add("info", "Roteiro da estação", "No HSL o tempo é \"8 minutos (aviso sonoro quando restar 1 minuto para o fim).\"", "TP-02");
    }
  }

  /* ---------- 4.8 Revisão interna (lacunas, ineditismo) ---------- */
  function regrasRevisao(e, ctx, add) {
    var S = "Revisão interna";
    var rv = pega(e, "revisao");
    if (!ehObj(rv)) {
      if (!ctx.ehExemplo) add("aviso", S, "Bloco \"revisao\" ausente (lacunas, pontos de atenção e ineditismo).", "RV-01");
      return;
    }
    var lac = arr(rv.lacunas);
    for (var i = 0; i < lac.length; i++) {
      if (!vazio(lac[i])) add("info", S, "Lacuna sinalizada: " + str(lac[i]), "RV-02");
    }
    var pa = arr(rv.pontos_atencao);
    for (var j = 0; j < pa.length; j++) {
      if (!vazio(pa[j])) add("info", S, "Ponto de atenção: " + str(pa[j]), "RV-03");
    }
    if (!ctx.ehExemplo && vazio(rv.ineditismo)) {
      add("aviso", S, "revisao.ineditismo vazio: registre a checagem de ineditismo contra o inventário da banca (regra 7 do README).", "RV-04");
    }
    // Marcadores [LACUNA...] no texto que não estão em revisao.lacunas
    var marcados = 0;
    percorre(e, [], function (v, caminho) {
      if (typeof v === "string" && caminho[0] !== "revisao" && /\[LACUNA/i.test(v)) marcados++;
    });
    if (marcados && !lac.length) {
      add("aviso", S, marcados + " marcador(es) [LACUNA] no texto, mas revisao.lacunas está vazio; liste as lacunas para o Alexandre.", "RV-05");
    }
  }

  /* ---------- 4.9 Português ---------- */
  function regrasPortugues(e, ctx, add) {
    var lim = { vazio: 0, duplo: 0, negrito: 0, pont: 0, marcador: 0 };
    var MAX = 8;
    var ignorar = { id: 1, banca: 1, status: 1, edicao: 1, versao_esquema: 1, escala: 1, tipo: 1, arquivo: 1 };
    percorre(e, [], function (v, caminho, chave) {
      if (typeof v !== "string") return;
      var top = caminho[0];
      if (ignorar[chave] || ignorar[top]) return;
      var sec = NOME_SECAO[top] || "Português";
      var onde = caminhoTexto(caminho);
      if (v.trim() === "") {
        if (chave === "dominio") return; /* critério em parágrafo corrido (USP-RP) não tem rótulo */
        if (lim.vazio++ < MAX) add("aviso", sec, "Texto vazio em " + onde + ".", "PT-01");
        return;
      }
      if (/\S {2,}\S/.test(v)) {
        if (lim.duplo++ < MAX) add("aviso", sec, "Espaços duplos em " + onde + ".", "PT-02");
      }
      var neg = v.split("**").length - 1;
      if (neg % 2 !== 0) {
        if (lim.negrito++ < MAX) add("aviso", sec, "Marcação ** desbalanceada (negrito aberto e não fechado) em " + onde + ".", "PT-03");
      }
      if (/\S [,.;:!?](\s|$)/.test(v) && !/\.\.\./.test(v)) {
        if (lim.pont++ < MAX) add("aviso", sec, "Espaço antes de pontuação em " + onde + ".", "PT-04");
      }
      // TODO/XXX só em maiúsculas: "todo" é palavra comum em português ("todo dia", "todo o traçado").
      if (/<!--|_{3,}|\[T[IÍ]TULO|lorem ipsum/i.test(v) || /\bTODO\b|\bXXX\b/.test(v)) {
        if (lim.marcador++ < MAX) add("aviso", sec, "Marcador de esqueleto/rascunho não preenchido em " + onde + ".", "PT-05");
      }
    });
    var nomes = { vazio: "textos vazios", duplo: "espaços duplos", negrito: "negritos desbalanceados", pont: "espaços antes de pontuação", marcador: "marcadores de rascunho" };
    var ks = Object.keys(lim);
    for (var i = 0; i < ks.length; i++) {
      if (lim[ks[i]] > MAX) add("aviso", "Português", "Há mais " + (lim[ks[i]] - MAX) + " ocorrências de " + nomes[ks[i]] + " não listadas.", "PT-06");
    }
  }

  /* -------------------------------------------------------------------
   * 5. FUNÇÃO PRINCIPAL
   * ------------------------------------------------------------------- */
  var GRUPOS = [
    ["Metadados", regrasMetadados],
    ["Estrutura", regrasEstrutura],
    ["Checklist", regrasChecklist],
    ["Soft skills", regrasSoftSkills],
    ["Coerência interna", regrasCoerencia],
    ["Referências", regrasReferencias],
    ["Tempo", regrasTempo],
    ["Revisão interna", regrasRevisao],
    ["Português", regrasPortugues]
  ];
  var PESO = { erro: 0, aviso: 1, info: 2 };

  function revisarEstacao(estacao) {
    var saida = [];
    function add(nivel, secao, mensagem, regra) {
      saida.push({ nivel: nivel, secao: secao, mensagem: mensagem, regra: regra || "" });
    }
    try {
      if (!ehObj(estacao)) {
        add("erro", "Geral", "A estação não é um objeto (recebido: " + (estacao === null ? "null" : Array.isArray(estacao) ? "lista" : typeof estacao) + "). Verifique a chamada registrarEstacao({...}).", "GE-01");
        return saida;
      }
      var ctx;
      try { ctx = montaContexto(estacao); }
      catch (e0) { ctx = { banca: "", regra: null, ehExemplo: false, area: "", itens: [], grupos: [], checklist: {}, referencias: [] }; }
      for (var i = 0; i < GRUPOS.length; i++) {
        try { GRUPOS[i][1](estacao, ctx, add); }
        catch (err) {
          add("aviso", "Revisão automática", "Falha interna ao aplicar as regras de \"" + GRUPOS[i][0] + "\" (" + (err && err.message ? err.message : String(err)) + "). As demais regras foram aplicadas; confira esta parte manualmente.", "GE-02");
        }
      }
      try {
        var erros = 0;
        for (var j = 0; j < saida.length; j++) if (saida[j].nivel === "erro") erros++;
        if (estacao.status === "aprovada" && erros) {
          add("erro", "Metadados", "Estação marcada como \"aprovada\", mas há " + erros + " erro(s) de revisão.", "ME-11");
        }
      } catch (e2) { /* nada */ }
      // ordena: erro → aviso → info, mantendo a ordem original dentro do nível
      for (var k = 0; k < saida.length; k++) saida[k]._ord = k;
      saida.sort(function (a, b) { return (PESO[a.nivel] - PESO[b.nivel]) || (a._ord - b._ord); });
      for (var z = 0; z < saida.length; z++) delete saida[z]._ord;
    } catch (fatal) {
      saida.push({ nivel: "aviso", secao: "Revisão automática", mensagem: "Falha inesperada na revisão: " + (fatal && fatal.message ? fatal.message : String(fatal)), regra: "GE-02" });
    }
    return saida;
  }

  revisarEstacao.REGRAS_BANCAS = REGRAS_BANCAS;
  raiz.revisarEstacao = revisarEstacao;
  raiz.REGRAS_BANCAS = REGRAS_BANCAS;
  return revisarEstacao;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));

if (typeof module !== "undefined") module.exports = { revisarEstacao };
