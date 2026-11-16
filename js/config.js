/* =====================================================================
 * config.js — Configuração pública do módulo online (Projeto Estações)
 *
 * Só vão aqui valores PÚBLICOS por definição: a URL do projeto Supabase e a
 * chave "publishable" (sb_publishable_…), feita para ficar no navegador.
 * NUNCA coloque aqui a chave secreta / service_role: ela não existe no
 * navegador nem nos arquivos do projeto. Quem protege os dados são as RPCs
 * (SECURITY DEFINER, filtro por perfil) e as políticas do banco e do Storage.
 * ===================================================================== */
window.ONLINE_CONFIG = {
  supabaseUrl: "https://uyjrqiurjywfeaifwpct.supabase.co",
  chavePublicavel: "sb_publishable_TpBPE6rdo9HFW_ZCLcm7gQ_aSgqxZ0n",
  /* supabase-js com versão FIXA (nunca "@2" solto) */
  supabaseJs: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js",
  /* SRI conferido em 16/11/2026 (111.088 bytes). Se trocar a versão, recalcule:
     curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A */
  supabaseJsSri: "sha384-GFr3yTh5lJznCbZfpTtXnwboFsxqtTQoeTZCRHhE0579KrRmlCzen5AA8ohaB5ug",
  bucket: "estacoes",
  validadeUrlImagem: 900,          /* segundos (15 min) */
  chaveSessao: "estacoes-online-auth",
  /* Tempo padrão do cronômetro quando roteiro.tempo não traz minutos
     (REGRAS_BANCAS.tempo_min; Tradicional segue o HSL — decisão D6, provisória) */
  tempoPadraoMin: {
    "einstein": 8, "sirio-libanes": 8, "tradicional": 8,
    "usp-ribeirao": 5, "unifesp-r1": 5, "unifesp-rmais": 5
  }
};
