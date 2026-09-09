// Diretor Criativo LB — gera o funil de fotos comerciais (até 8 imagens) + título + descrição.
// Usa a API do Google Gemini (Nano Banana Pro, pra imagem, e Gemini Flash, pra texto).
// Manda a FOTO REAL junto com a instrução de cada cena, pra manter fidelidade de verdade ao produto.
// Gera as fotos em grupos de 3 em paralelo.
// Variável de ambiente necessária na Vercel: GEMINI_API_KEY

const NOMES_MK = { shopee: 'Shopee', ml: 'Mercado Livre', tiktok: 'TikTok Shop' };
const ASPECT_RATIO = '4:5';
const TAMANHO_IMAGEM_GEMINI = '2K';
const MODELO_TEXTO = 'gemini-3.6-flash';
const MODELO_IMAGEM_PRO = 'gemini-3-pro-image'; // Nano Banana Pro — mais caro, mais fiel, só pra Capa
const MODELO_IMAGEM_BARATO = 'gemini-3.1-flash-image'; // Nano Banana 2 — ~metade do preço, pro resto do funil

// Mesma regra exata usada no "Gerar Anúncio com IA" — mantém os 2 lugares sempre consistentes
const REGRAS_TITULO = {
  shopee: `REGRAS DO TÍTULO (Shopee) - siga TODAS com rigor:
1. CAPITALIZAÇÃO: use Iniciais Maiúsculas em Cada Palavra Importante (substantivos, adjetivos). Ex: "Vestido Feminino Longo Estampado Manga Bufante". Nunca escreva o título todo em minúsculas.
2. ESTRATÉGIA DE SEO (o mais importante): NÃO copie a descrição do vendedor. Você é um especialista - PENSE em como o cliente busca na Shopee e ENRIQUEÇA o título com palavras-chave de busca reais que o vendedor não escreveu. Adicione sinônimos e termos que ampliam o alcance (ex: "Roupa Feminina", "Moda", "Elegante", "Casual", conforme o produto).
3. Aproveite ao máximo os 100 caracteres - busque usar entre 70 e 100 caracteres.
4. Comece pelo tipo de produto + característica principal, depois vá agregando palavras-chave estratégicas.
5. PROIBIDO: cores (amarelo, rosa, lilás, azul...) e tamanhos (P, M, G, GG). NUNCA inclua cor nem tamanho.
6. Sem emojis, sem CAIXA ALTA total, sem símbolos.`,
  ml: `REGRAS DO TÍTULO (Mercado Livre) - siga TODAS com rigor:
1. CAPITALIZAÇÃO: use Iniciais Maiúsculas nas Palavras Importantes. Nunca tudo minúsculo.
2. ESTRATÉGIA: não copie a descrição do vendedor. Use as palavras-chave mais fortes e diretas que o cliente busca.
3. Máximo 60 caracteres.
4. Comece pelo termo principal que o cliente busca, seguido das características mais relevantes.
5. Sem emojis, sem CAIXA ALTA total, sem símbolos.`,
  tiktok: `REGRAS DO TÍTULO (TikTok Shop) - siga TODAS com rigor:
1. TAMANHO OBRIGATÓRIO: entre 120 e 140 caracteres.
2. CAPITALIZAÇÃO: use Iniciais Maiúsculas em Cada Palavra Importante.
3. ESTRATÉGIA DE SEO: rico em informação — tipo de produto, material, uso, público-alvo, características técnicas, numa frase corrida.
4. Pode incluir cor e tamanho quando fizer sentido (diferente da Shopee).
5. Sem emojis, sem CAIXA ALTA total, sem símbolos.`
};

const SEQUENCIA_PADRAO = [
  { ordem: 1, tipo: 'Capa Ambientada', foco: 'A primeira impressão do anúncio: o produto real, ambientado num cenário comercial premium e condizente com o tipo de produto, iluminação profissional, composição forte de capa. Se for roupa/vestuário: mostre numa MODELO DE VERDADE, com o rosto dela visível, usando a peça de forma natural — nunca use manequim (principalmente manequim sem cabeça) e nunca deixe o produto "flutuando" sozinho sem contexto. Se não for roupa: apresente o produto de forma comercial premium, sozinho ou em contexto de uso, sem manequim.' },
  { ordem: 2, tipo: 'Ângulo Diferente', foco: 'O mesmo produto real, mas de um ângulo diferente do da capa (lateral, trás, outro plano), ainda em contexto ambientado ou fundo comercial limpo, mostrando melhor a forma/volume do produto.' },
  { ordem: 3, tipo: 'Nova Foto Ambientada', foco: 'Uma segunda composição ambientada, com cenário/contexto diferente da capa, mostrando outro momento de uso ou outro enquadramento comercial do mesmo produto real.' },
  { ordem: 4, tipo: 'Detalhes do Produto', foco: 'Close-up real em detalhes importantes do produto (textura, acabamento, costura, material, componente), preservando exatamente cor e forma originais.' },
  { ordem: 5, tipo: 'Tabela de Medidas', obrigatoria: true, foco: 'GUIA DE TAMANHOS genérico, no estilo padrão de tabela de medidas usada em anúncios de marketplace de moda (tipo P, M, G, GG com as medidas típicas de cada um, em cm). Monte essa tabela você mesmo, com valores realistas e coerentes com o tipo de produto — não precisa ser a medida exata do produto da foto, é um guia de referência padrão de tamanhos. Pode mostrar o produto ao lado da tabela como ilustração, fundo limpo, layout comercial organizado.' },
  { ordem: 6, tipo: 'Looks / Formas de Usar', foco: 'O mesmo produto real combinado ou em diferentes formas/contextos de uso, mostrando versatilidade, sem alterar o produto em si. Se for roupa/vestuário: mostre numa modelo de verdade, com rosto visível, usando a peça de forma natural. Nunca use manequim (principalmente manequim sem cabeça).' },
  { ordem: 7, tipo: 'Benefícios / Composição / Informações Comerciais', foco: 'Um infográfico comercial destacando os principais benefícios do produto e, se informado na descrição, a composição/material — baseado SOMENTE no que foi dito na descrição do produto, sem inventar nenhuma informação técnica, benefício ou composição que não tenha sido mencionada.' },
  { ordem: 8, tipo: 'Principais Atributos com Callouts', foco: 'O produto real com setas/linhas de chamada (callouts) apontando pra 3-4 características visuais reais dele, com textos curtos ao lado de cada seta — baseado SOMENTE em características visíveis na foto ou mencionadas na descrição, sem inventar nenhum atributo.' }
];

// Extrai { mimeType, data(base64 puro) } de uma data URL "data:image/jpeg;base64,XXXX"
function parseDataUrl(dataUrl) {
  const match = /^data:(.+?);base64,(.+)$/.exec(dataUrl || '');
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const chave = process.env.GEMINI_API_KEY;
  if (!chave) return res.status(500).json({ erro: 'Chave do Gemini não configurada.' });

  try {
    const { acao } = req.body || {};

    // ===== AÇÃO: GERAR LOGOTIPO =====
    if (acao === 'logo') {
      const { nomeLoja, estilo } = req.body || {};
      if (!nomeLoja || !nomeLoja.trim()) return res.status(400).json({ erro: 'Digite o nome da loja/cliente.' });
      const promptLogo = `Crie um logotipo profissional e comercial para a marca "${nomeLoja.trim()}"${estilo ? `, no estilo: ${estilo.trim()}` : ', em estilo moderno e versátil'}. O logotipo deve ser limpo, memorável, adequado para uso em marketplace/e-commerce (Shopee, Mercado Livre, TikTok Shop), fundo branco ou transparente, sem texto além do nome da marca, sem elementos genéricos de IA (sem gradiente arco-íris, sem excesso de efeitos). Tipografia legível e composição equilibrada.`;
      for (let tentativa = 1; tentativa <= 3; tentativa++) {
        try {
          const rLogo = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_IMAGEM_BARATO}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: promptLogo }] }],
              generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } }
            })
          });
          if (!rLogo.ok) { const errTxt = await rLogo.text(); if (tentativa < 3) continue; return res.status(500).json({ erro: errTxt.slice(0, 200) }); }
          const dataLogo = await rLogo.json();
          const partes = dataLogo.candidates?.[0]?.content?.parts || [];
          const partImagem = partes.find(p => p.inlineData?.data || p.inline_data?.data);
          const b64 = partImagem?.inlineData?.data || partImagem?.inline_data?.data;
          if (b64) return res.status(200).json({ ok: true, imagem: `data:image/png;base64,${b64}` });
          if (tentativa < 3) continue;
          return res.status(500).json({ erro: 'Não foi possível gerar o logotipo. Tenta descrever o estilo de outro jeito.' });
        } catch (e) { if (tentativa < 3) continue; return res.status(500).json({ erro: e.message }); }
      }
    }

    // ===== AÇÃO: GERAR SÓ O GUIA DE TAMANHOS (sem rodar o funil completo) =====
    if (acao === 'guia_tamanhos') {
      const { produto, imagens } = req.body || {};
      const listaImgs = Array.isArray(imagens) ? imagens : (req.body?.imagem ? [req.body.imagem] : []);
      if (!listaImgs.length) return res.status(400).json({ erro: 'Envie a foto real do produto.' });
      const imgParsed = parseDataUrl(listaImgs[0]);
      if (!imgParsed) return res.status(400).json({ erro: 'Não consegui ler a foto enviada.' });
      const focoGuia = SEQUENCIA_PADRAO.find(s => s.obrigatoria)?.foco || '';
      const promptGuia = `Usando a foto real do produto anexada como referência de fidelidade total (não altere forma, cor, textura, material ou proporções), gere: ${focoGuia}${produto ? ` Contexto do produto: ${produto}` : ''}`;
      for (let tentativa = 1; tentativa <= 3; tentativa++) {
        try {
          const rGuia = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_IMAGEM_BARATO}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: promptGuia }, { inline_data: { mime_type: imgParsed.mimeType, data: imgParsed.data } }] }],
              generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: ASPECT_RATIO, imageSize: TAMANHO_IMAGEM_GEMINI } }
            })
          });
          if (!rGuia.ok) { const errTxt = await rGuia.text(); if (tentativa < 3) continue; return res.status(500).json({ erro: errTxt.slice(0, 200) }); }
          const dataGuia = await rGuia.json();
          const partes = dataGuia.candidates?.[0]?.content?.parts || [];
          const partImagem = partes.find(p => p.inlineData?.data || p.inline_data?.data);
          const b64 = partImagem?.inlineData?.data || partImagem?.inline_data?.data;
          if (b64) return res.status(200).json({ ok: true, imagem: `data:image/png;base64,${b64}` });
          if (tentativa < 3) continue;
          return res.status(500).json({ erro: 'Não foi possível gerar o guia de tamanhos.' });
        } catch (e) { if (tentativa < 3) continue; return res.status(500).json({ erro: e.message }); }
      }
    }

    // ===== FUNIL COMPLETO (comportamento padrão, já existente) =====
    const { produto, marketplace, imagens, quantidadeFotos } = req.body || {};
    const listaImagensEnviadas = Array.isArray(imagens) ? imagens.slice(0, 5) : [];
    if (!listaImagensEnviadas.length) return res.status(400).json({ erro: 'Envie pelo menos 1 foto real do produto.' });
    if (!produto || !produto.trim()) return res.status(400).json({ erro: 'Descreva o produto.' });

    const listaImagensParsed = listaImagensEnviadas.map(parseDataUrl).filter(Boolean);
    if (!listaImagensParsed.length) return res.status(400).json({ erro: 'Não consegui ler as fotos enviadas.' });

    const mk = NOMES_MK[marketplace] ? marketplace : 'ml';
    const nomeMk = NOMES_MK[mk];
    const qtdFotos = Math.min(Math.max(Number(quantidadeFotos) || 8, 1), 8);
    const regraTitulo = REGRAS_TITULO[mk];

    const analisePrompt = `Você é um Diretor Criativo de e-commerce especializado em ${nomeMk}. Sua prioridade MÁXIMA é: fidelidade ao produto real > estética. Isso vale pra QUALQUER tipo de produto (roupa, eletrônico, acessório, utensílio, brinquedo, o que for) — não é específico de roupa. As fotos enviadas são a REFERÊNCIA REAL do produto — cada cena gerada depois vai usar essas fotos como base, preservando forma, cor, proporção, material, textura, acabamento e todos os detalhes visuais exatos. NUNCA planeje uma cena que exija inventar característica não visível nas fotos.

${listaImagensParsed.length > 1 ? `Foram enviadas ${listaImagensParsed.length} fotos — a PRIMEIRA é a cor/versão principal do produto (será usada na maioria das cenas, pra manter consistência visual). As demais fotos são variações de cor/versão do MESMO produto, que só aparecem juntas na cena "Looks / Formas de Usar".` : 'Foi enviada 1 foto do produto — a referência principal de todas as cenas.'}

Descrição do produto: "${produto}"

Monte uma estratégia com até ${qtdFotos} cenas, baseada NESTA ORDEM EXATA (não reordene). A cena 1 (Capa Ambientada) e a cena 5 (Tabela de Medidas) são OBRIGATÓRIAS e sempre precisam estar presentes, não importa quantas cenas no total forem pedidas. Se for usar menos que ${SEQUENCIA_PADRAO.length}, corte as outras cenas primeiro, nunca a 1 nem a 5:
${SEQUENCIA_PADRAO.map(s => `${s.ordem}. ${s.tipo}: ${s.foco}`).join('\n')}

MUITO IMPORTANTE: o array "cenas" da sua resposta precisa vir NA MESMA ORDEM numérica acima (1, 2, 3...) — nunca reorganize por importância ou qualquer outro critério.

Pra cada cena, escreva uma instrução curta e clara (em português) descrevendo o cenário/composição/enquadramento — SEM repetir a descrição do produto (isso já vem da foto real), só o que muda ao redor ou o enquadramento.

${regraTitulo}

REGRAS DA DESCRIÇÃO:
- Texto persuasivo e organizado em pelo menos 3 a 4 parágrafos completos, cobrindo: benefício principal, características/materiais, usos/aplicações, e diferenciais.
- Mínimo de 400 caracteres — não entregue uma descrição curta ou resumida.
- NUNCA invente: composição/material específico, medidas reais, potência, capacidade, resistência, certificação, compatibilidade ou qualquer especificação técnica que não tenha sido informada na descrição do produto. Use apenas o que foi dito ou o que é visualmente óbvio na foto.

Responda SOMENTE com um JSON válido no formato:
{"titulo":"...","descricao":"...","cenas":[{"tipo":"...","instrucao":"..."}]}`;

    const rAnalise = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_TEXTO}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: analisePrompt },
            ...listaImagensParsed.map(img => ({ inline_data: { mime_type: img.mimeType, data: img.data } }))
          ]
        }],
        generationConfig: { temperature: 0.6, responseMimeType: 'application/json' }
      })
    });

    if (!rAnalise.ok) {
      const err = await rAnalise.text();
      return res.status(500).json({ erro: 'Erro na análise da IA: ' + err.slice(0, 200) });
    }

    const dataAnalise = await rAnalise.json();
    const conteudo = dataAnalise.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let estrategia;
    try { estrategia = JSON.parse(conteudo); } catch { return res.status(500).json({ erro: 'Resposta inválida da IA na análise.' }); }

    // A IA nem sempre acerta o tamanho do título só por instrução — confere de verdade em código,
    // e se estiver fora da faixa, pede pra ela corrigir (mesma lógica do "Gerar Anúncio com IA").
    const FAIXA_TITULO = { shopee: [70, 100], ml: [1, 60], tiktok: [120, 140] };
    const [minTitulo, maxTitulo] = FAIXA_TITULO[mk] || [1, 999];
    let titulo = estrategia.titulo || '';

    for (let tentativa = 0; tentativa < 3 && (titulo.length < minTitulo || titulo.length > maxTitulo); tentativa++) {
      const faltam = minTitulo - titulo.length;
      const pedidoCorrecao = titulo.length < minTitulo
        ? `O título abaixo tem exatamente ${titulo.length} caracteres, mas PRECISA ter no mínimo ${minTitulo} e no máximo ${maxTitulo} caracteres — faltam pelo menos ${faltam} caracteres. Reescreva-o mais longo, adicionando MAIS palavras-chave relevantes de busca, mantendo a mesma capitalização e estilo. Título atual: "${titulo}". Responda SOMENTE com um JSON no formato {"titulo":"..."}`
        : `O título abaixo tem ${titulo.length} caracteres, mas PRECISA ter no máximo ${maxTitulo} caracteres. Reescreva-o mais curto, removendo o que for menos relevante. Título atual: "${titulo}". Responda SOMENTE com um JSON no formato {"titulo":"..."}`;
      try {
        const r2 = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_TEXTO}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `Você é um especialista em títulos de anúncios para ${nomeMk}. Responda somente com JSON válido.\n\n${pedidoCorrecao}` }] }],
            generationConfig: { temperature: 0.6, responseMimeType: 'application/json' }
          })
        });
        if (r2.ok) {
          const data2 = await r2.json();
          const conteudo2 = data2.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
          const parsed2 = JSON.parse(conteudo2);
          if (parsed2.titulo) titulo = parsed2.titulo;
        } else { break; }
      } catch (e) { break; }
    }
    estrategia.titulo = titulo;

    let listaCenas = (estrategia.cenas || []).slice(0, qtdFotos);
    // Garantia extra: se a IA não incluiu o Guia de Tamanhos (obrigatório), força ele como última cena
    const cenaGuiaTamanhos = SEQUENCIA_PADRAO.find(s => s.obrigatoria);
    const jaTemGuia = listaCenas.some(c => /guia de tamanho|medidas/i.test(c.tipo || ''));
    if (cenaGuiaTamanhos && !jaTemGuia) {
      if (listaCenas.length >= qtdFotos && listaCenas.length > 1) listaCenas = listaCenas.slice(0, -1);
      listaCenas.push({ tipo: cenaGuiaTamanhos.tipo, instrucao: cenaGuiaTamanhos.foco });
    }
    if (!listaCenas.length) return res.status(500).json({ erro: 'A IA não conseguiu montar a estratégia de cenas.' });

    // Gera 1 imagem, com até 2 tentativas extras se a primeira falhar
    async function gerarUmaImagem(cena, imagensDessaGeracao, instrucaoExtra) {
      const ehCapa = /capa ambientada/i.test(cena.tipo || '');
      const modeloEscolhido = ehCapa ? MODELO_IMAGEM_PRO : MODELO_IMAGEM_BARATO;
      for (let tentativa = 1; tentativa <= 3; tentativa++) {
        try {
          const rImg = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modeloEscolhido}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
            body: JSON.stringify({
              contents: [{
                role: 'user',
                parts: [
                  { text: `Usando a(s) foto(s) real(is) do produto anexada(s) como referência de fidelidade total (não altere forma, cor, textura, material, proporções ou nenhum detalhe visual do produto — vale pra qualquer tipo de produto, não só roupa), gere uma nova composição comercial: ${cena.instrucao}${instrucaoExtra}` },
                  ...imagensDessaGeracao.map(img => ({ inline_data: { mime_type: img.mimeType, data: img.data } }))
                ]
              }],
              generationConfig: {
                responseModalities: ['TEXT', 'IMAGE'],
                imageConfig: { aspectRatio: ASPECT_RATIO, imageSize: TAMANHO_IMAGEM_GEMINI }
              }
            })
          });

          if (!rImg.ok) {
            const errTxt = await rImg.text();
            if (tentativa < 3) continue;
            return { tipo: cena.tipo, erro: errTxt.slice(0, 200) };
          }

          const dataImg = await rImg.json();
          const partes = dataImg.candidates?.[0]?.content?.parts || [];
          const partImagem = partes.find(p => p.inlineData?.data || p.inline_data?.data);
          const b64 = partImagem?.inlineData?.data || partImagem?.inline_data?.data;
          if (b64) {
            return { tipo: cena.tipo, imagem: `data:image/png;base64,${b64}`, erro: null };
          }
          if (tentativa < 3) continue;
          const textoResposta = partes.map(p => p.text).filter(Boolean).join(' ');
          return { tipo: cena.tipo, imagem: null, erro: `A geração de imagem falhou (após ${tentativa} tentativas). ${textoResposta ? 'Mensagem: ' + textoResposta : 'Nenhuma imagem retornada.'}` };
        } catch (e) {
          if (tentativa < 3) continue;
          return { tipo: cena.tipo, erro: e.message };
        }
      }
    }

    const fotoprincipal = listaImagensParsed[0];
    const TAMANHO_GRUPO = 3;
    const geracoes = [];
    for (let i = 0; i < listaCenas.length; i += TAMANHO_GRUPO) {
      const grupo = listaCenas.slice(i, i + TAMANHO_GRUPO);
      const resultadosGrupo = await Promise.all(grupo.map(async (cena) => {
        // Só a cena de "Looks/Formas de Usar" usa TODAS as fotos (pra mostrar as cores diferentes).
        const ehCenaDeVariacao = /looks|formas de usar/i.test(cena.tipo || '');
        const imagensDessaGeracao = (ehCenaDeVariacao && listaImagensParsed.length > 1) ? listaImagensParsed : [fotoprincipal];
        const instrucaoExtra = (ehCenaDeVariacao && listaImagensParsed.length > 1)
          ? ` Mostre as ${listaImagensParsed.length} cores/versões do produto, cada uma reproduzindo EXATAMENTE a cor da foto de referência correspondente — não misture as cores, não deixe todas iguais. IMPORTANTE: cada peça precisa aparecer GRANDE e bem visível na composição (não miniaturizada, não amontoada) — se forem muitas cores, distribua num grid espaçoso, mas cada uma tem que ficar nítida e reconhecível, do tamanho suficiente pra mostrar detalhe e cor com clareza.`
          : '';
        return gerarUmaImagem(cena, imagensDessaGeracao, instrucaoExtra);
      }));
      geracoes.push(...resultadosGrupo);
    }

    return res.status(200).json({
      ok: true,
      titulo: estrategia.titulo || '',
      descricao: estrategia.descricao || '',
      marketplace: mk,
      fotos: geracoes
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: 'Erro interno: ' + (e.message || 'desconhecido') });
  }
}
