module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });

  const ENDPOINTS = {
    "1grau": "https://pje.tjes.jus.br/pje/intercomunicacao",
    "2grau": "https://sistemas.tjes.jus.br/pje/intercomunicacao",
  };

  const NS_SER = "http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/";
  const NS_TIP = "http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2";

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ erro: "JSON invalido" });
  }
  if (!body) return res.status(400).json({ erro: "Body vazio" });

  const {
    operacao, cpf, senha, instancia = "1grau",
    numeroProcesso, numerosProcessos,
    incluirDocumentos = false, incluirCabecalho = true,
    movimentos = true, idAviso,
  } = body;

  if (!cpf || !senha) return res.status(400).json({ erro: "CPF e senha obrigatorios" });

  const endpoint = ENDPOINTS[instancia] || ENDPOINTS["1grau"];

  // ── Build SOAP XML ──
  function buildXml(op, numero) {
    if (op === "consultarProcesso") {
      return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ser="${NS_SER}"
                  xmlns:tip="${NS_TIP}">
<soapenv:Header/>
<soapenv:Body>
<ser:consultarProcesso>
<tip:idConsultante>${cpf}</tip:idConsultante>
<tip:senhaConsultante>${senha}</tip:senhaConsultante>
<tip:numeroProcesso>${numero}</tip:numeroProcesso>
<tip:incluirDocumentos>${incluirDocumentos}</tip:incluirDocumentos>
<tip:incluirCabecalho>${incluirCabecalho}</tip:incluirCabecalho>
<tip:movimentos>${movimentos}</tip:movimentos>
</ser:consultarProcesso>
</soapenv:Body>
</soapenv:Envelope>`;
    }
    if (op === "consultarAvisosPendentes") {
      return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ser="${NS_SER}"
                  xmlns:tip="${NS_TIP}">
<soapenv:Header/>
<soapenv:Body>
<ser:consultarAvisosPendentes>
<tip:idConsultante>${cpf}</tip:idConsultante>
<tip:senhaConsultante>${senha}</tip:senhaConsultante>
</ser:consultarAvisosPendentes>
</soapenv:Body>
</soapenv:Envelope>`;
    }
    if (op === "consultarTeorComunicacao") {
      return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ser="${NS_SER}"
                  xmlns:tip="${NS_TIP}">
<soapenv:Header/>
<soapenv:Body>
<ser:consultarTeorComunicacao>
<tip:idConsultante>${cpf}</tip:idConsultante>
<tip:senhaConsultante>${senha}</tip:senhaConsultante>
<tip:idAviso>${idAviso}</tip:idAviso>
</ser:consultarTeorComunicacao>
</soapenv:Body>
</soapenv:Envelope>`;
    }
    return null;
  }

  // ── Strip MTOM multipart envelope ──
  function stripMTOM(raw) {
    if (raw.trim().startsWith("<")) return raw.trim();
    const soapStart = raw.indexOf("<soap:Envelope");
    if (soapStart === -1) {
      const alt = raw.indexOf("<soapenv:Envelope");
      if (alt > -1) {
        const end = raw.indexOf("Envelope>", alt);
        if (end > -1) return raw.substring(alt, end + "Envelope>".length);
      }
      return raw;
    }
    const soapEnd = raw.indexOf("</soap:Envelope>");
    if (soapEnd === -1) return raw.substring(soapStart);
    return raw.substring(soapStart, soapEnd + "</soap:Envelope>".length);
  }

  // ── XML helpers ──
  function tag(xml, name) {
    if (!xml) return "";
    const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}>`, "i");
    const m = xml.match(re);
    return m ? m[1].trim() : "";
  }

  function tagAll(xml, name) {
    if (!xml) return [];
    const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}>`, "gi");
    const results = [];
    let m;
    while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
    return results;
  }

  function tagFull(xml, name) {
    if (!xml) return "";
    const re = new RegExp(`(<(?:[\\w.-]+:)?${name}[^>]*>)([\\s\\S]*?)(<\\/(?:[\\w.-]+:)?${name}>)`, "i");
    const m = xml.match(re);
    return m ? m[0] : "";
  }

  function tagAllFull(xml, name) {
    if (!xml) return [];
    const re = new RegExp(`(<(?:[\\w.-]+:)?${name}[^>]*>)([\\s\\S]*?)(<\\/(?:[\\w.-]+:)?${name}>)`, "gi");
    const results = [];
    let m;
    while ((m = re.exec(xml)) !== null) {
      results.push({ openTag: m[1], content: m[2].trim(), full: m[0] });
    }
    return results;
  }

  function attr(xmlTag, attrName) {
    if (!xmlTag) return "";
    const re = new RegExp(`${attrName}\\s*=\\s*"([^"]*)"`, "i");
    const m = xmlTag.match(re);
    return m ? m[1] : "";
  }

  // ── Parse consultarProcesso response ──
  function parseProcesso(rawXml) {
    const xml = stripMTOM(rawXml);

    const result = {
      sucesso: false,
      mensagem: "",
      numero: "",
      classe: "",
      orgaoJulgador: "",
      dataAjuizamento: "",
      valorCausa: "",
      sigilo: "",
      competencia: "",
      polos: [],
      movimentos: [],
      assuntos: [],
    };

    const faultString = tag(xml, "faultstring") || tag(xml, "faultString");
    if (faultString) {
      result.mensagem = "SOAP Fault: " + faultString;
      return result;
    }

    const sucesso = tag(xml, "sucesso");
    const mensagem = tag(xml, "mensagem");
    result.mensagem = mensagem;
    result.sucesso = sucesso === "true" || (!sucesso && !faultString && !mensagem);

    const dadosBasicosFull = tagFull(xml, "dadosBasicos");
    const dadosBasicosContent = tag(xml, "dadosBasicos");

    if (dadosBasicosFull) {
      result.numero = attr(dadosBasicosFull, "numero") || "";
      result.classe = attr(dadosBasicosFull, "classeProcessual") || "";
      result.dataAjuizamento = attr(dadosBasicosFull, "dataAjuizamento") || "";
      result.valorCausa = attr(dadosBasicosFull, "valorCausa") || "";
      result.sigilo = attr(dadosBasicosFull, "nivelSigilo") || "";
      result.competencia = attr(dadosBasicosFull, "competencia") || "";
    }

    if (!result.numero) result.numero = tag(xml, "numero") || tag(xml, "numeroProcesso") || "";
    if (!result.classe) result.classe = tag(xml, "classeProcessual") || "";
    if (!result.dataAjuizamento) result.dataAjuizamento = tag(xml, "dataAjuizamento") || "";
    if (!result.valorCausa) result.valorCausa = tag(xml, "valorCausa") || "";
    if (!result.sigilo) result.sigilo = tag(xml, "nivelSigilo") || "";

    const orgaoFull = tagFull(dadosBasicosContent || xml, "orgaoJulgador");
    if (orgaoFull) {
      result.orgaoJulgador = attr(orgaoFull, "nomeOrgao") || tag(orgaoFull, "nomeOrgao") || "";
      if (!result.orgaoJulgador) {
        result.orgaoJulgador = orgaoFull.replace(/<[^>]+>/g, "").trim();
      }
    }

    const source = dadosBasicosContent || xml;
    const poloItems = tagAllFull(source, "polo");
    for (const poloItem of poloItems) {
      const tipo = attr(poloItem.openTag, "polo") || "";
      const parteItems = tagAllFull(poloItem.content, "parte");
      const partes = [];

      for (const parteItem of parteItems) {
        const pessoaFull = tagFull(parteItem.content, "pessoa") || parteItem.full;
        partes.push({
          nome: attr(pessoaFull, "nome") || tag(parteItem.content, "nome") || "",
          documento: attr(pessoaFull, "numeroDocumentoPrincipal") || tag(parteItem.content, "numeroDocumentoPrincipal") || "",
          tipoPessoa: attr(pessoaFull, "tipoPessoa") || tag(parteItem.content, "tipoPessoa") || "",
        });
      }

      if (partes.length > 0) {
        result.polos.push({ tipo, partes: partes.filter(p => p.nome) });
      }
    }

    const movItems = tagAllFull(xml, "movimento");
    for (const movItem of movItems) {
      const dataHora = attr(movItem.openTag, "dataHora") || tag(movItem.content, "dataHora") || "";
      const movNacContent = tag(movItem.content, "movimentoNacional") || tag(movItem.content, "movimentoLocal") || "";
      const movNacFull = tagFull(movItem.content, "movimentoNacional") || tagFull(movItem.content, "movimentoLocal") || "";

      let descricao = "";
      if (movNacFull) {
        descricao = attr(movNacFull, "descricao") || tag(movNacContent, "descricao") || "";
      }
      if (!descricao) {
        descricao = tag(movItem.content, "complemento") || tag(movItem.content, "descricao") || "";
      }
      descricao = descricao.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

      const codigo = movNacFull ? (attr(movNacFull, "codigoNacional") || tag(movNacContent, "codigoNacional") || "") : "";

      if (dataHora || descricao) {
        result.movimentos.push({ data: dataHora, descricao, codigo });
      }
    }

    const assuntoItems = tagAllFull(source, "assunto");
    for (const a of assuntoItems) {
      result.assuntos.push({
        codigo: attr(a.openTag, "codigoNacional") || tag(a.content, "codigoNacional") || "",
        descricao: attr(a.openTag, "descricao") || tag(a.content, "descricao") || "",
        principal: attr(a.openTag, "principal") || "",
      });
    }

    return result;
  }

  // ── Send SOAP ──
  async function enviarSOAP(xml) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "SOAPAction": "",
        },
        body: xml,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const text = await resp.text();
      return { httpStatus: resp.status, body: text };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  // ── LOTE ──
  if (operacao === "consultarLote" && Array.isArray(numerosProcessos)) {
    const resultados = [];
    const limite = Math.min(numerosProcessos.length, 50);

    for (let i = 0; i < limite; i++) {
      const num = numerosProcessos[i];
      const xml = buildXml("consultarProcesso", num);

      try {
        const resp = await enviarSOAP(xml);
        const dados = parseProcesso(resp.body);
        resultados.push({
          numero: num,
          status: "ok",
          dados,
          httpStatus: resp.httpStatus,
          xmlBruto: resp.body.substring(0, 4000),
        });
      } catch (err) {
        resultados.push({ numero: num, status: "erro", erro: err.message, dados: null });
      }

      if (i < limite - 1) await new Promise(r => setTimeout(r, 1200));
    }

    return res.status(200).json({ operacao: "consultarLote", resultados });
  }

  // ── INDIVIDUAL ──
  if (!operacao) return res.status(400).json({ erro: "Campo 'operacao' obrigatorio" });
  if (operacao === "consultarProcesso" && !numeroProcesso) return res.status(400).json({ erro: "Numero do processo obrigatorio" });
  if (operacao === "consultarTeorComunicacao" && !idAviso) return res.status(400).json({ erro: "ID do aviso obrigatorio" });

  const xmlReq = buildXml(operacao, numeroProcesso);
  if (!xmlReq) return res.status(400).json({ erro: "Operacao '" + operacao + "' invalida" });

  try {
    const resp = await enviarSOAP(xmlReq);

    if (operacao === "consultarProcesso") {
      const dados = parseProcesso(resp.body);
      return res.status(200).json({
        operacao,
        resultado: dados,
        httpStatus: resp.httpStatus,
        nsUsado: NS_SER,
        xmlBruto: resp.body.substring(0, 5000),
      });
    }

    return res.status(200).json({
      operacao,
      httpStatus: resp.httpStatus,
      nsUsado: NS_SER,
      xmlBruto: resp.body.substring(0, 5000),
    });
  } catch (err) {
    return res.status(502).json({ erro: "Falha ao conectar com PJe: " + err.message });
  }
};
