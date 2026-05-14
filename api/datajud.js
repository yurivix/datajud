module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });

  const TRIBUNAIS = {
    "tjes": "api_publica_tjes",
    "tjrj": "api_publica_tjrj",
    "tjsp": "api_publica_tjsp",
    "tjmg": "api_publica_tjmg",
    "trt17": "api_publica_trt17",
    "tjba": "api_publica_tjba",
    "tjpr": "api_publica_tjpr",
    "tjrs": "api_publica_tjrs",
    "tjsc": "api_publica_tjsc",
    "tjgo": "api_publica_tjgo",
    "tjdf": "api_publica_tjdf",
    "tjma": "api_publica_tjma",
    "tjce": "api_publica_tjce",
    "tjpe": "api_publica_tjpe",
    "tjmt": "api_publica_tjmt",
    "tjms": "api_publica_tjms",
    "tjpa": "api_publica_tjpa",
    "tjam": "api_publica_tjam",
    "trf2": "api_publica_trf2",
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
    assunto,
    classeProcessual,
    orgaoJulgador,
    dataInicio,
    dataFim,
    tamanho = 20,
    searchAfter,
    termo,
  } = body;

  const alias = TRIBUNAIS[tribunal.toLowerCase()] || TRIBUNAIS["tjes"];
  const url = `${BASE_URL}/${alias}/_search`;

  // Build Elasticsearch query
  const must = [];

  if (assunto) {
    must.push({
      nested: {
        path: "assuntos",
        query: {
          bool: {
            should: [
              { match: { "assuntos.nome": { query: assunto, operator: "and" } } },
              { match: { "assuntos.codigo": assunto } },
            ],
          },
        },
      },
    });
  }

  if (classeProcessual) {
    must.push({
      bool: {
        should: [
          { match: { "classe.nome": { query: classeProcessual, operator: "and" } } },
          { match: { "classe.codigo": classeProcessual } },
        ],
      },
    });
  }

  if (orgaoJulgador) {
    must.push({
      match: { "orgaoJulgador.nome": { query: orgaoJulgador, operator: "and" } },
    });
  }

  if (termo) {
    must.push({
      multi_match: {
        query: termo,
        fields: [
          "assuntos.nome",
          "classe.nome",
          "orgaoJulgador.nome",
          "numeroProcesso",
        ],
        type: "cross_fields",
        operator: "and",
      },
    });
  }

  if (dataInicio || dataFim) {
    const range = {};
    if (dataInicio) range.gte = dataInicio;
    if (dataFim) range.lte = dataFim;
    must.push({ range: { "dataAjuizamento": range } });
  }

  // If no filters at all, return error
  if (must.length === 0) {
    return res.status(400).json({ erro: "Informe pelo menos um filtro: assunto, classeProcessual, orgaoJulgador, termo, dataInicio ou dataFim" });
  }

  const esQuery = {
    size: Math.min(tamanho, 50),
    query: {
      bool: {
        must,
      },
    },
    sort: [{ "dataAjuizamento": { order: "desc" } }],
  };

  if (searchAfter) {
    esQuery.search_after = searchAfter;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": API_KEY,
      },
      body: JSON.stringify(esQuery),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await resp.json();

    if (data.error) {
      return res.status(400).json({
        erro: "Erro na consulta DataJud",
        detalhes: data.error.reason || JSON.stringify(data.error).substring(0, 500),
      });
    }

    const total = data.hits?.total?.value || 0;
    const processos = (data.hits?.hits || []).map((hit) => {
      const s = hit._source || {};
      return {
        numero: s.numeroProcesso || "",
        classe: s.classe?.nome || "",
        classCodigo: s.classe?.codigo || "",
        assuntos: (s.assuntos || []).map((a) => ({
          nome: a.nome || "",
          codigo: a.codigo || "",
        })),
        orgaoJulgador: s.orgaoJulgador?.nome || "",
        codigoOrgao: s.orgaoJulgador?.codigo || "",
        dataAjuizamento: s.dataAjuizamento || "",
        dataUltimaAtualizacao: s.dataUltimaAtualizacao || "",
        grau: s.grau || "",
        nivelSigilo: s.nivelSigilo || "",
        formato: s.formato?.nome || "",
        sistema: s.sistema?.nome || "",
        movimentos: (s.movimentos || []).slice(0, 10).map((m) => ({
          nome: m.nome || "",
          codigo: m.codigo || "",
          dataHora: m.dataHora || "",
          complementos: (m.complementosTabelados || []).map((c) => c.descricao || c.nome || "").filter(Boolean),
        })),
        sort: hit.sort || null,
      };
    });

    // Last sort value for pagination
    const lastSort = processos.length > 0 ? processos[processos.length - 1].sort : null;

    return res.status(200).json({
      total,
      quantidade: processos.length,
      tribunal: tribunal.toUpperCase(),
      processos,
      proximaPagina: lastSort,
    });
  } catch (err) {
    return res.status(502).json({ erro: "Falha ao conectar com DataJud: " + err.message });
  }
};
