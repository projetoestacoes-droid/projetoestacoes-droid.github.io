/* =====================================================================
 * estudio-dados.js — Núcleo do ESTÚDIO online (Projeto Estações)
 *
 * Sessão e login: os mesmos do site (supabase-js com versão fixa e SRI,
 * e-mail + senha, mesma chave de sessão de online/js/nucleo.js: quem já entrou
 * na área do site entra direto). Depois do login, rpc('eu'): só o perfil
 * "admin" passa do portão. Para os demais perfis, nada do estúdio é carregado.
 *
 * window.Estudio = {
 *   demo, cfg, sb, eu()
 *   rpc(nome, args)            -> Promise<dados>; Error com .code (token do servidor)
 *   api.*                      -> todas as RPCs do estúdio (nomes de 004_estudio.sql / API.md)
 *   arm.*                      -> Storage: assinar, enviar, baixar, copiar (buckets privados)
 *   gerar(acao, pedidoId)      -> Edge Function "gerar-estacao" ({semChave:true} se 503)
 *   ui.*                       -> el, botao, perguntar, dialogo, toast, msg, textoErro…
 *   aoPronto(fn)               -> roda fn(eu) quando o administrador for confirmado
 * }
 *
 * Segurança: quem decide é o SERVIDOR (RPCs SECURITY DEFINER com exigir_admin,
 * políticas do Storage). Esta página só organiza as chamadas. Sem innerHTML com
 * dados: todo texto entra por textContent. Nenhuma chave secreta no navegador.
 * ===================================================================== */
(function () {
  "use strict";
  /* Proteção contra exibir a página dentro de outra (clickjacking), como no núcleo do site */
  if (window.top !== window.self) { document.documentElement.style.display = "none"; try { window.top.location = window.self.location; } catch (e) { /* nada */ } return; }

  var CFG = window.ONLINE_CONFIG || {};
  var params = new URLSearchParams(location.search);
  var MODO_DEMO = params.get("demo") === "1";
  var BUCKET_ESTUDIO = "estudio", BUCKET_REFS = "referencias", BUCKET_PUB = CFG.bucket || "estacoes";
  var VALIDADE = CFG.validadeUrlImagem || 900;
  var estado = { eu: null, prontos: [], pronto: false };

  /* ------------------------------------------------------------------
   * Utilidades de interface (sem innerHTML)
   * ------------------------------------------------------------------ */
  function anexar(n, filhos) {
    if (filhos == null || filhos === false) return n;
    if (!Array.isArray(filhos)) filhos = [filhos];
    filhos.forEach(function (f) {
      if (f == null || f === false) return;
      if (typeof f === "string" || typeof f === "number") n.appendChild(document.createTextNode(String(f)));
      else n.appendChild(f);
    });
    return n;
  }
  function el(tag, cls, filhos) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return anexar(n, filhos);
  }
  function limpar(n) { while (n && n.firstChild) n.removeChild(n.firstChild); return n; }
  function botao(texto, cls, aoClicar, titulo) {
    var b = el("button", "btn" + (cls ? " " + cls : ""), texto);
    b.type = "button";
    if (titulo) b.title = titulo;
    if (aoClicar) b.addEventListener("click", aoClicar);
    return b;
  }
  function toast(msg, tipo) {
    var area = document.getElementById("es-toasts");
    if (!area) { area = el("div", "es-toasts"); area.id = "es-toasts"; area.setAttribute("aria-live", "polite"); document.body.appendChild(area); }
    var t = el("div", "es-toast" + (tipo ? " es-toast-" + tipo : ""), msg);
    area.appendChild(t);
    var dur = tipo === "erro" ? 7000 : 4000;
    setTimeout(function () { t.classList.add("sai"); }, dur);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, dur + 600);
  }
  /* Diálogo modal no visual do editor (dialog.ed-dialogo).
     conteudo: texto ou nós; botoes: [{rotulo, valor, primario, perigo}] → Promise<valor|null> */
  function dialogo(titulo, conteudo, botoes, op) {
    op = op || {};
    return new Promise(function (ok) {
      var dlg = el("dialog", "ed-dialogo es-dialogo" + (op.largo ? " es-dialogo-largo" : ""));
      dlg.setAttribute("aria-label", titulo);
      dlg.appendChild(el("h3", null, titulo));
      if (typeof conteudo === "string") dlg.appendChild(el("p", null, conteudo));
      else anexar(dlg, conteudo);
      var acoes = el("div", "ed-dialogo-acoes");
      var resolvido = false;
      var fim = function (v) {
        if (resolvido) return;
        var val = typeof v === "function" ? v() : v;
        if (op.validar && val != null && val !== false) { var erro = op.validar(val); if (erro) { if (op.aoErro) op.aoErro(erro); return; } }
        resolvido = true;
        try { dlg.close(); } catch (e) { /* já fechado */ }
        if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
        ok(val);
      };
      var focar = null;
      (botoes || [{ rotulo: "Fechar", valor: null, primario: true }]).forEach(function (b) {
        var bt = botao(b.rotulo, b.primario ? "primario" : b.perigo ? "perigo" : null, function () { fim(b.valor); });
        if (b.primario && !focar) focar = bt;
        acoes.appendChild(bt);
      });
      dlg.appendChild(acoes);
      dlg.addEventListener("cancel", function (ev) { ev.preventDefault(); if (!op.semEsc) fim(null); });
      document.body.appendChild(dlg);
      if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
      var campo = dlg.querySelector("input:not([type=checkbox]), select, textarea");
      if (campo) campo.focus(); else if (focar) focar.focus();
      if (op.aoAbrir) op.aoAbrir(dlg, fim);
    });
  }
  function confirmar(titulo, texto, rotuloOk, perigo) {
    return dialogo(titulo, texto, [
      { rotulo: "Cancelar", valor: false },
      { rotulo: rotuloOk || "Confirmar", valor: true, primario: !perigo, perigo: !!perigo }
    ]).then(function (v) { return v === true; });
  }
  function fmtData(d) {
    if (!d) return "";
    var x = new Date(d);
    if (isNaN(x.getTime())) return String(d);
    var z = function (n) { return (n < 10 ? "0" : "") + n; };
    return z(x.getDate()) + "/" + z(x.getMonth() + 1) + "/" + x.getFullYear() + " " + z(x.getHours()) + ":" + z(x.getMinutes());
  }
  function fmtNum(n, casas) {
    if (n == null || n === "" || isNaN(Number(n))) return "–";
    var v = Number(n);
    var s = Number.isInteger(v) ? String(v) : v.toFixed(casas == null ? 2 : casas).replace(/0+$/, "").replace(/\.$/, "");
    return s.replace(".", ",");
  }
  function lista(v) { return Array.isArray(v) ? v : (v && Array.isArray(v.linhas) ? v.linhas : []); }
  /* nome de arquivo seguro para chave do Storage */
  function nomeSeguro(nome) {
    var s = String(nome || "arquivo").normalize("NFD").replace(/[̀-ͯ]/g, "");
    var i = s.lastIndexOf("."), ext = i > 0 ? s.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
    var base = (i > 0 ? s.slice(0, i) : s).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80) || "arquivo";
    return base + (ext ? "." + ext : "");
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 0x100).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  /* Mensagens dos erros do servidor (token no início da mensagem: "conflito_versao: …") */
  var ERROS = {
    sem_permissao: "Você não tem permissão para isso (só administradores).",
    nao_autenticado: "Sua sessão expirou. Entre de novo.",
    rede: "Sem conexão com o servidor. Tente de novo quando a internet voltar.",
    conflito_versao: "A estação foi alterada por outra pessoa (ou em outra aba) depois que você a abriu.",
    nao_encontrado: "Registro não encontrado (pode ter sido removido); recarregue a lista.",
    estacao_nao_aprovada: "Só estações com status “Aprovada” podem ser publicadas. Edite, mude o status para Aprovada e salve.",
    conteudo_invalido: "O conteúdo não é uma estação válida (objeto com banca e título).",
    banca_invalida: "Banca inválida.",
    titulo_obrigatorio: "A estação não tem título.",
    origem_invalida: "Origem inválida.",
    versao_inexistente: "Essa versão não existe no histórico.",
    estacao_grande_demais: "Estação grande demais.",
    caminho_de_imagem_invalido: "Caminho de imagem inválido no arquivo (use img/<arquivo>.png|jpg|webp|gif).",
    versao_esquema_nao_suportada: "versao_esquema não suportada (esperado 1).",
    checklist_sem_grupos: "O checklist não tem grupos.",
    escala_invalida: "Escala do checklist inválida.",
    pedido_invalido: "Pedido incompleto: confira banca, área e tema.",
    pedido_finalizado: "Este pedido já foi concluído ou cancelado.",
    pedido_ja_existe: "Este pedido já existe (envie de novo pelo formulário).",
    tema_invalido: "Tema inválido (de 2 a 500 caracteres).",
    texto_grande_demais: "Texto grande demais em algum campo do pedido.",
    referencias_invalidas: "Referências inválidas (até 20 por lista).",
    referencia_invalida: "Referência com nome ou caminho inválido.",
    id_invalido: "Identificador inválido (no JSON, “id” só com minúsculas, números e hífens, até 120).",
    status_invalido: "Status inválido (rascunho, em-revisao ou aprovada).",
    estacao_nao_e_objeto: "O conteúdo não é um objeto de estação.",
    estacao_arquivada: "A estação está arquivada: desarquive antes de publicar.",
    pedido_inexistente: "Pedido inexistente.",
    funcao_inexistente: "Função do servidor não encontrada: a migração 004_estudio.sql ainda não foi aplicada no Supabase."
  };
  function textoErro(e) {
    if (!e) return "Erro desconhecido.";
    var m = String(e.message || e), cod = e.code || "";
    if (cod === "PGRST202" || /Could not find the function|rpc_inexistente/i.test(m)) return ERROS.funcao_inexistente + " (" + (e.rpc || m) + ")";
    if (ERROS[cod]) return ERROS[cod];
    var chave = Object.keys(ERROS).filter(function (k) { return m.indexOf(k) >= 0; })[0];
    return chave ? ERROS[chave] : m;
  }

  /* ------------------------------------------------------------------
   * RPC (Supabase real ou backend falso do modo demonstração)
   * ------------------------------------------------------------------ */
  function erroDe(e, nomeRpc) {
    var msg = (e && (e.message || e.msg)) || String(e || "erro");
    var err = new Error(msg);
    err.pgcode = e && e.code;
    err.detalhes = e && (e.details || e.hint);
    var token = (msg.match(/^([a-z_]+)(?::|$)/) || [])[1];
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg) && !token) err.code = "rede";
    else if (token) err.code = token;
    else if (e && e.code === "PGRST301") err.code = "nao_autenticado";
    else err.code = (e && e.code) || "erro";
    if (navigator.onLine === false && err.code === "erro") err.code = "rede";
    err.rpc = nomeRpc;
    return err;
  }
  function rpc(nome, args) {
    if (!Estudio.sb) return Promise.reject(Object.assign(new Error("sem_cliente"), { code: "sem_cliente" }));
    return Promise.resolve().then(function () { return Estudio.sb.rpc(nome, args || {}); }).then(function (r) {
      if (r.error) throw erroDe(r.error, nome);
      return r.data;
    }, function (e) { throw erroDe(e, nome); }).catch(function (err) {
      if (err && err.code === "nao_autenticado") toast("Sua sessão expirou. Entre de novo.", "erro");
      throw err;
    });
  }
  function umObjeto(v) { return Array.isArray(v) ? (v[0] || null) : v; }

  /* Todas as RPCs do estúdio num lugar só (conciliar com online/supabase/API.md, seção do estúdio) */
  var api = {
    listar: function (incluirArquivadas) { return rpc("estudio_listar", { p_incluir_arquivadas: !!incluirArquivadas }).then(lista); },
    obter: function (id) { return rpc("estudio_obter", { p_id: id }).then(umObjeto); },
    criar: function (conteudo, origem, pedidoId) { return rpc("estudio_criar", { p_conteudo: conteudo, p_origem: origem, p_pedido_id: pedidoId || null }).then(umObjeto); },
    salvar: function (id, conteudo, versaoEsperada, forcar, motivo) {
      return rpc("estudio_salvar", { p_id: id, p_conteudo: conteudo, p_versao_esperada: versaoEsperada, p_forcar: !!forcar, p_motivo: motivo || null }).then(umObjeto);
    },
    versoes: function (id) { return rpc("estudio_versoes", { p_id: id }).then(lista); },
    obterVersao: function (id, versao) { return rpc("estudio_obter_versao", { p_id: id, p_versao: versao }).then(umObjeto); },
    arquivar: function (id, arquivada) { return rpc("estudio_arquivar", { p_id: id, p_arquivada: !!arquivada }); },
    duplicar: function (id) { return rpc("estudio_duplicar", { p_id: id }).then(umObjeto); },
    publicar: function (id) { return rpc("estudio_publicar", { p_id: id }).then(umObjeto); },
    confirmarPublicacao: function (pubId) { return rpc("confirmar_publicacao", { p_id: pubId }).then(umObjeto); },
    criarPedido: function (dados) { return rpc("gerar_criar_pedido", { p_dados: dados }).then(umObjeto); },
    listarPedidos: function () { return rpc("gerar_listar_pedidos", {}).then(lista); },
    obterPedido: function (id) { return rpc("gerar_obter_pedido", { p_id: id }).then(umObjeto); },
    cancelarPedido: function (id) { return rpc("gerar_cancelar_pedido", { p_id: id }); }
  };

  /* ------------------------------------------------------------------
   * Storage (buckets privados; as políticas só deixam o admin ler/gravar)
   * ------------------------------------------------------------------ */
  function bucket(nome) {
    if (!Estudio.sb || !Estudio.sb.storage) throw new Error("Armazenamento indisponível.");
    return Estudio.sb.storage.from(nome);
  }
  var arm = {
    ESTUDIO: BUCKET_ESTUDIO, REFERENCIAS: BUCKET_REFS, PUBLICADAS: BUCKET_PUB,
    /* caminhos → { caminho: urlAssinada } (os que não existem ficam de fora) */
    assinar: function (nomeBucket, caminhos) {
      if (!caminhos.length) return Promise.resolve({});
      return Promise.resolve().then(function () { return bucket(nomeBucket).createSignedUrls(caminhos, VALIDADE); }).then(function (r) {
        var mapa = {};
        if (r.error) { console.warn("URLs assinadas:", r.error.message); return mapa; }
        (r.data || []).forEach(function (x) { if (x && x.signedUrl && !x.error) mapa[x.path] = x.signedUrl; });
        return mapa;
      }).catch(function (e) { console.warn("URLs assinadas:", e && e.message); return {}; });
    },
    enviar: function (nomeBucket, caminho, arquivo, op) {
      op = op || {};
      return Promise.resolve().then(function () {
        return bucket(nomeBucket).upload(caminho, arquivo, { contentType: op.tipo || arquivo.type || "application/octet-stream", upsert: !!op.substituir, cacheControl: "3600" });
      }).then(function (r) {
        if (r && r.error) {
          var m = String(r.error.message || r.error);
          if (!op.substituir && (/exist|duplicate|409/i.test(m) || String(r.error.statusCode) === "409")) return { jaExistia: true };
          throw new Error(m);
        }
        return (r && r.data) || {};
      });
    },
    baixar: function (nomeBucket, caminho) {
      return Promise.resolve().then(function () { return bucket(nomeBucket).download(caminho); }).then(function (r) {
        if (r && r.error) throw new Error(String(r.error.message || r.error) || "falha ao baixar " + caminho);
        return r.data;
      });
    },
    /* cópia entre buckets: baixa e envia de novo (as duas pontas passam pelas políticas do admin) */
    copiar: function (deBucket, deCaminho, paraBucket, paraCaminho, op) {
      return arm.baixar(deBucket, deCaminho).then(function (blob) {
        var tipo = blob && blob.type ? blob.type : tipoImagem(deCaminho);
        return arm.enviar(paraBucket, paraCaminho, blob, { tipo: tipo, substituir: op && op.substituir });
      });
    }
  };
  var TIPOS = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", txt: "text/plain", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  function tipoImagem(nome) { var ext = String(nome).split(".").pop().toLowerCase(); return TIPOS[ext] || "application/octet-stream"; }

  /* ------------------------------------------------------------------
   * Edge Function "gerar-estacao" (só funciona depois da chave ANTHROPIC_API_KEY no Supabase)
   * → Promise<{ ok, dados, semChave, status, mensagem }>
   * ------------------------------------------------------------------ */
  function gerar(acao, pedidoId) {
    if (!Estudio.sb || !Estudio.sb.functions) return Promise.resolve({ ok: false, status: 0, mensagem: "Funções do servidor indisponíveis." });
    return Promise.resolve().then(function () {
      return Estudio.sb.functions.invoke("gerar-estacao", { body: { acao: acao, pedido_id: pedidoId } });
    }).then(function (r) {
      if (!r.error) return { ok: true, dados: r.data || {}, status: 200 };
      var ctx = r.error.context, status = ctx && typeof ctx.status === "number" ? ctx.status : 0;
      var lerCorpo = ctx && typeof ctx.json === "function" ? ctx.clone().json().catch(function () { return null; }) : Promise.resolve(null);
      return lerCorpo.then(function (corpo) {
        var m = (corpo && (corpo.erro || corpo.error || corpo.mensagem || corpo.message)) || r.error.message || "Falha na função gerar-estacao.";
        var semChave = status === 503 || /chave da api n[ãa]o configurada/i.test(String(m));
        if (status === 404 || /not found|failed to send/i.test(String(r.error.message || ""))) {
          if (!corpo) m = "A função gerar-estacao não respondeu (ainda não foi publicada no Supabase?). " + (r.error.message || "");
        }
        return { ok: false, status: status, semChave: semChave, mensagem: String(m), dados: corpo };
      });
    }, function (e) { return { ok: false, status: 0, mensagem: (e && e.message) || String(e) }; });
  }

  /* ------------------------------------------------------------------
   * Portão: login, perfil e início
   * ------------------------------------------------------------------ */
  function carregarScript(src, sri) {
    return new Promise(function (ok, falha) {
      var s = document.createElement("script");
      s.src = src; s.async = false;
      if (/^https:/.test(src)) { s.crossOrigin = "anonymous"; s.referrerPolicy = "no-referrer"; }
      if (sri) s.integrity = sri;
      s.onload = function () { ok(); };
      s.onerror = function () { falha(new Error("Não foi possível carregar " + src)); };
      document.head.appendChild(s);
    });
  }
  function cartaoPortao() { return limpar(document.getElementById("es-portao-cartao")); }
  function mostrarPortao(on) {
    document.getElementById("es-portao").hidden = !on;
    document.body.classList.toggle("es-bloqueado", !!on);
  }
  function linkSite() {
    var a = el("a", "btn", "Ir para a área do site");
    a.href = "index.html" + (MODO_DEMO ? "?demo=1" : "");
    return a;
  }
  function telaErro(texto) {
    mostrarPortao(true);
    var c = cartaoPortao();
    c.appendChild(el("h1", null, "Estúdio de estações"));
    c.appendChild(el("p", "es-aviso-erro", texto));
    c.appendChild(el("div", "es-linha-botoes", [botao("Recarregar", "primario", function () { location.reload(); }), linkSite()]));
  }
  function telaLogin(aviso) {
    mostrarPortao(true);
    var c = cartaoPortao();
    c.appendChild(el("h1", null, "Estúdio de estações"));
    c.appendChild(el("p", "es-sutil", "Área do administrador. Entre com o mesmo e-mail e a mesma senha do site."));
    if (aviso) c.appendChild(el("p", "es-aviso-erro", aviso));
    var form = el("form", "es-form-login");
    var email = el("input"); email.type = "email"; email.autocomplete = "username"; email.required = true; email.inputMode = "email";
    var senha = el("input"); senha.type = "password"; senha.autocomplete = "current-password"; senha.required = true;
    form.appendChild(el("label", null, ["E-mail", email]));
    form.appendChild(el("label", null, ["Senha", senha]));
    var entrar = el("button", "btn primario", "Entrar"); entrar.type = "submit";
    form.appendChild(entrar);
    var msg = el("p", "es-sutil"); msg.setAttribute("aria-live", "polite");
    c.appendChild(form); c.appendChild(msg);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var e = email.value.trim().toLowerCase();
      if (!e || !senha.value) return;
      entrar.disabled = true; msg.textContent = "Entrando…";
      Estudio.sb.auth.signInWithPassword({ email: e, password: senha.value }).then(function (r) {
        entrar.disabled = false;
        senha.value = "";
        if (r.error) {
          var m = r.error.message || "";
          msg.textContent = /invalid login|credentials|not found/i.test(m) ? "E-mail ou senha incorretos." :
            /rate|limit|seconds|too many/i.test(m) ? "Muitas tentativas seguidas. Aguarde alguns minutos." : "Não foi possível entrar: " + m;
          return;
        }
        conferirPerfil();
      });
    });
    email.focus();
  }
  function telaNegado(eu) {
    mostrarPortao(true);
    var c = cartaoPortao();
    c.appendChild(el("h1", null, "Acesso restrito"));
    c.appendChild(el("p", null, "O estúdio de estações é só para administradores." + (eu && eu.perfil ? "" : " Seu e-mail não tem cadastro ativo.")));
    c.appendChild(el("div", "es-linha-botoes", [linkSite(), botao("Sair", null, sair)]));
  }
  function conferirPerfil() {
    var c = cartaoPortao();
    c.appendChild(el("h1", null, "Estúdio de estações"));
    c.appendChild(el("p", "es-sutil", "Conferindo o acesso…"));
    return rpc("eu").then(function (eu) {
      eu = umObjeto(eu);
      if (!eu || eu.perfil !== "admin") { estado.eu = null; telaNegado(eu); return; }
      estado.eu = eu;
      mostrarPortao(false);
      desenharQuem();
      estado.pronto = true;
      estado.prontos.forEach(function (fn) { try { fn(eu); } catch (e) { console.error(e); } });
    }, function (e) {
      if (e && (e.code === "nao_autenticado" || /jwt|auth|token/i.test(e.message || ""))) telaLogin("Sua sessão expirou. Entre de novo.");
      else telaErro("Não foi possível conferir o acesso: " + textoErro(e));
    });
  }
  function desenharQuem() {
    var q = document.getElementById("es-quem");
    if (!q) return;
    limpar(q);
    var a = el("a", "btn-link", "Área admin");
    a.href = "index.html" + (MODO_DEMO ? "?demo=1" : "") + "#admin/estacoes";
    q.appendChild(a);
    q.appendChild(el("span", "es-nome", estado.eu ? String(estado.eu.nome || "") : ""));
    q.appendChild(botao("Sair", "mini", sair));
  }
  function sair() {
    var pend = window.EditorEstacao && window.EditorEstacao.pendente && window.EditorEstacao.pendente();
    var p = pend ? confirmar("Sair do estúdio?", "Há alterações não salvas na estação aberta. Elas serão perdidas.", "Sair", true) : Promise.resolve(true);
    p.then(function (ok) {
      if (!ok) return;
      if (MODO_DEMO) { location.href = "estudio.html?demo=1"; return; }
      Promise.resolve(Estudio.sb.auth.signOut({ scope: "local" })).catch(function () { /* nada */ }).then(function () {
        try { localStorage.removeItem(CFG.chaveSessao); localStorage.removeItem(CFG.chaveSessao + "-code-verifier"); } catch (x) { /* nada */ }
        location.reload();
      });
    });
  }

  function iniciarReal() {
    return carregarScript(CFG.supabaseJs, CFG.supabaseJsSri).then(function () {
      if (!window.supabase || !window.supabase.createClient) throw new Error("supabase-js indisponível");
      Estudio.sb = window.supabase.createClient(CFG.supabaseUrl, CFG.chavePublicavel, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: CFG.chaveSessao, flowType: "implicit" }
      });
      Estudio.sb.auth.onAuthStateChange(function (ev) {
        if (ev === "SIGNED_OUT" && estado.eu) { estado.eu = null; location.reload(); }
      });
      return Estudio.sb.auth.getSession();
    }).then(function (r) {
      if (r && r.data && r.data.session) return conferirPerfil();
      telaLogin();
    }).catch(function (e) {
      telaErro("Não foi possível iniciar: " + (e && e.message) + ". Verifique a conexão e recarregue a página.");
    });
  }
  function iniciarDemo() {
    var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if (!local) { telaErro("O modo demonstração só funciona no computador local."); return; }
    return carregarScript("js/estudio-demo.js").then(function () {
      if (!window.EstudioDemo) throw new Error("estudio-demo.js não carregou");
      return window.EstudioDemo.iniciar();
    }).then(function () {
      Estudio.sb = window.EstudioDemo.sb;
      window.EstudioDemo.montarFaixa(document.getElementById("es-faixa-demo"));
      return conferirPerfil();
    }).catch(function (e) {
      telaErro("Modo demonstração indisponível nesta publicação (" + (e && e.message) + ").");
    });
  }

  var Estudio = window.Estudio = {
    demo: MODO_DEMO,
    cfg: CFG,
    sb: null,
    eu: function () { return estado.eu; },
    rpc: rpc,
    api: api,
    arm: arm,
    gerar: gerar,
    aoPronto: function (fn) { if (estado.pronto) fn(estado.eu); else estado.prontos.push(fn); },
    ui: {
      el: el, anexar: anexar, limpar: limpar, botao: botao, toast: toast, dialogo: dialogo, confirmar: confirmar,
      fmtData: fmtData, fmtNum: fmtNum, textoErro: textoErro, nomeSeguro: nomeSeguro, uuid: uuid, tipoArquivo: tipoImagem
    }
  };

  function iniciar() {
    mostrarPortao(true);
    if (MODO_DEMO) iniciarDemo(); else iniciarReal();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else setTimeout(iniciar, 0);
})();
