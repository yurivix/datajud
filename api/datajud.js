module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });

  const ALL_TRIBUNAIS = {
    // Superiores
    "stf":"api_publica_stf","stj":"api_publica_stj","tst":"api_publica_tst",
    // TRFs
    "trf1":"api_publica_trf1","trf2":"api_publica_trf2","trf3":"api_publica_trf3",
    "trf4":"api_publica_trf4","trf5":"api_publica_trf5","trf6":"api_publica_trf6",
    // TJs
    "tjes":"api_publica_tjes","tjrj":"api_publica_tjrj","tjsp":"api_publica_tjsp",
    "tjmg":"api_publica_tjmg","tjba":"api_publica_tjba","tjpr":"api_publica_tjpr",
    "tjrs":"api_publica_tjrs","tjsc":"api_publica_tjsc","tjdf":"api_publica_tjdf",
    "tjgo":"api_publica_tjgo","tjmt":"api_publica_tjmt","tjms":"api_publica_tjms",
    "tjma":"api_publica_tjma","tjce":"api_publica_tjce","tjpe":"api_publica_tjpe",
    "tjpa":"api_publica_tjpa","tjam":"api_publica_tjam","tjal":"api_publica_tjal",
    "tjac":"api_publica_tjac","tjap":"api_publica_tjap","tjpi":"api_publica_tjpi",
    "tjpb":"api_publica_tjpb","tjrn":"api_publica_tjrn","tjro":"api_publica_tjro",
    "tjrr":"api_publica_tjrr","tjse":"api_publica_tjse","tjto":"api_publica_tjto",
    // TRTs
    "trt1":"api_publica_trt1","trt2":"api_publica_trt2","trt3":"api_publica_trt3",
    "trt4":"api_publica_trt4","trt5":"api_publica_trt5","trt6":"api_publica_trt6",
    "trt7":"api_publica_trt7","trt8":"api_publica_trt8","trt9":"api_publica_trt9",
    "trt10":"api_publica_trt10","trt11":"api_publica_trt11","trt12":"api_publica_trt12",
    "trt13":"api_publica_trt13","trt14":"api_publica_trt14","trt15":"api_publica_trt15",
    "trt16":"api_publica_trt16","trt17":"api_publica_trt17","trt18":"api_publica_trt18",
    "trt19":"api_publica_trt19","trt20":"api_publica_trt20","trt21":"api_publica_trt21",
    "trt22":"api_publica_trt22","trt23":"api_publica_trt23","trt24":"api_publica_trt24",
  };

  const API_KEY = "APIKey cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";
  const BASE_URL = "https://api-publica.datajud.cnj.jus.br";

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ erro: "JSON invalido" });
  }
  if (!body) return res.status(400).json({ erro: "Body vazio" });

  const {
    tribunal = "tjes",
    tribunais,          // array - busca multi-tribunal
    assunto,
    classeProcessual,
    orgaoJulgador,
    nomeParte,          // NEW: busca por nome da parte
    numeroProcesso,     // NEW: busca por número via DataJud
    grau,               // NEW: G1, G2, JE, etc
    valorMin,           // NEW: valor mínimo da causa
    valorMax,           // NEW: valor máximo da causa
    dataInicio,
    dataFim,
    movimentosDesde,    // NEW: delta - só movimentos após esta data
    tamanho = 20,
    pagina = 0,
    termo,
  } = body;

  // ── Build Elasticsearch query ──
  function buildQuery() {
    const must = [];

    if (numeroProcesso) {
      must.push({ match: { "numeroProcesso": numeroProcesso.replace(/[.\-]/g, "") } });
    }

    if (assunto) {
      must.push({ match: { "assuntos.nome": assunto } });
    }

    if (classeProcessual) {
      if (/^\d+$/.test(classeProcessual.trim())) {
        must.push({ match: { "classe.codigo": classeProcessual.trim() } });
      } else {
        must.push({ match: { "classe.nome": classeProcessual } });
      }
    }

    if (orgaoJulgador) {
      if (/^\d+$/.test(orgaoJulgador.trim())) {
        must.push({ match: { "orgaoJulgador.codigo": orgaoJulgador.trim() } });
      } else {
        must.push({ match: { "orgaoJulgador.nome": orgaoJulgador } });
      }
    }

    if (nomeParte) {
      must.push({ match: { "partes.nome": nomeParte } });
    }

    if (grau) {
      must.push({ match: { "grau": grau } });
    }

    if (termo) {
      must.push({
        multi_match: {
          query: termo,
          fields: ["assuntos.nome", "classe.nome", "orgaoJulgador.nome", "numeroProcesso", "partes.nome"],
        },
      });
    }

    if (dataInicio || dataFim) {
      const range = {};
      if (dataInicio) range.gte = dataInicio;
      if (dataFim) range.lte = dataFim;
      must.push({ range: { "dataAjuizamento": range } });
    }

    if (valorMin || valorMax) {
      const range = {};
      if (valorMin) range.gte = Number(valorMin);
      if (valorMax) range.lte = Number(valorMax);
      must.push({ range: { "valor": range } });
    }

    if (movimentosDesde) {
      must.push({
        nested: {
          path: "movimentos",
          query: {
            range: {
              "movimentos.dataHora": { gte: movimentosDesde }
            }
          }
        }
      });
    }

    return must;
  }

  // ── Format response ──
  function formatHits(hits) {
    return (hits || []).map((hit) => {
      const s = hit._source || {};
      return {
        numero: s.numeroProcesso || "",
        classe: s.classe?.nome || "",
        classCodigo: s.classe?.codigo || "",
        assuntos: (s.assuntos || []).map((a) => ({ nome: a.nome || "", codigo: a.codigo || "" })),
        orgaoJulgador: s.orgaoJulgador?.nome || "",
        codigoOrgao: s.orgaoJulgador?.codigo || "",
        municipioIBGE: s.orgaoJulgador?.codigoMunicipioIBGE || "",
        dataAjuizamento: s.dataAjuizamento || "",
        dataUltimaAtualizacao: s.dataHoraUltimaAtualizacao || "",
        grau: s.grau || "",
        nivelSigilo: s.nivelSigilo || "",
        formato: s.formato?.nome || "",
        sistema: s.sistema?.nome || "",
        tribunal: s.tribunal || "",
        valor: s.valor || null,
        partes: (s.partes || []).map((p) => ({ nome: p.nome || "", tipo: p.tipo || "", polo: p.polo || "" })),
        movimentos: (s.movimentos || []).slice(0, 15).map((m) => ({
          nome: m.nome || "",
          codigo: m.codigo || "",
          dataHora: m.dataHora || "",
          complementos: (m.complementosTabelados || []).map((c) => c.descricao || c.nome || "").filter(Boolean),
        })),
      };
    });
  }

  // ── Send request to DataJud ──
  async function queryTribunal(alias, must, size, from) {
    const url = `${BASE_URL}/${alias}/_search`;
    const esQuery = {
      size,
      from,
      query: { bool: { must } },
      sort: [{ "dataAjuizamento": { "order": "desc" } }],
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": API_KEY },
        body: JSON.stringify(esQuery),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return await resp.json();
    } catch (err) {
      clearTimeout(timeout);
      return { error: { reason: err.message } };
    }
  }

  const must = buildQuery();

  if (must.length === 0) {
    return res.status(400).json({ erro: "Informe pelo menos um filtro de pesquisa." });
  }

  const size = Math.min(tamanho, 50);
  const from = pagina * size;

  // ── MULTI-TRIBUNAL ──
  if (Array.isArray(tribunais) && tribunais.length > 0) {
    const lista = tribunais.slice(0, 10); // max 10 tribunais por vez
    const resultados = [];

    const promises = lista.map(async (t) => {
      const alias = ALL_TRIBUNAIS[t.toLowerCase()];
      if (!alias) return { tribunal: t.toUpperCase(), erro: "Tribunal desconhecido", total: 0, processos: [] };

      const data = await queryTribunal(alias, must, Math.min(size, 10), 0);
      if (data.error) {
        return { tribunal: t.toUpperCase(), erro: data.error.reason || "Erro", total: 0, processos: [] };
      }
      return {
        tribunal: t.toUpperCase(),
        total: data.hits?.total?.value || 0,
        processos: formatHits(data.hits?.hits),
      };
    });

    const results = await Promise.all(promises);
    const totalGeral = results.reduce((sum, r) => sum + r.total, 0);

    return res.status(200).json({
      operacao: "multiTribunal",
      totalGeral,
      resultados: results.filter(r => r.total > 0 || r.erro),
    });
  }

  // ── SINGLE TRIBUNAL ──
  const alias = ALL_TRIBUNAIS[tribunal.toLowerCase()] || ALL_TRIBUNAIS["tjes"];

  const data = await queryTribunal(alias, must, size, from);

  if (data.error) {
    return res.status(400).json({
      erro: "Erro na consulta DataJud",
      detalhes: data.error.reason || data.error.root_cause?.[0]?.reason || JSON.stringify(data.error).substring(0, 500),
    });
  }

  const total = data.hits?.total?.value || 0;
  const processos = formatHits(data.hits?.hits);

  return res.status(200).json({ total, quantidade: processos.length, tribunal: tribunal.toUpperCase(), pagina, processos });
};
