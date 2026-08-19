// Diretor Criativo LB — gera o funil de fotos comerciais (até 8 imagens) + título + descrição,
// a partir de uma foto real do produto, preservando fidelidade ao produto (não inventa características).
// Variável de ambiente necessária na Vercel: OPENAI_API_KEY

const NOMES_MK = { shopee: 'Shopee', ml: 'Mercado Livre', tiktok: 'TikTok Shop' };
const TAMANHO_IMAGEM = '1024x1536'; // único tamanho retrato válido na API (mais próximo do 1200x1540 pedido)

const SEQUENCIA_PADRAO = [
  { tipo: 'Capa / Hero', foco: 'Produto centralizado, fundo limpo, iluminação de estúdio, a imagem principal que representa o anúncio.' },
  { tipo: 'Benefício principal', foco: 'Destaca o maior diferencial/benefício do produto de forma visual clara.' },
  { tipo: 'Detalhes técnicos ou funcionais', foco: 'Close-up mostrando características técnicas ou funcionais importantes.' },
  { tipo: 'Qualidade / acabamento', foco: 'Close-up de textura, costura, material, acabamento — mostrando qualidade.' },
  { tipo: 'Uso real / lifestyle', foco: 'Produto sendo usado em contexto real, mostrando aplicação prática.' },
  { tipo: 'Variações / versatilidade', foco: 'Se aplicável, mostra variações de cor/tamanho/uso. Se não houver variação, mostra outro ângulo útil.' },
  { tipo: 'Detalhes / textura', foco: 'Outro close-up de detalhe importante não coberto ainda (zíper, botão, textura, etc.).' },
  { tipo: 'Medidas / tamanhos / especificações', foco: 'Imagem informativa mostrando medidas, tamanho ou especificações técnicas relevantes.' }
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const chave = process.env.OPENAI_API_KEY;
  if (!chave) return res.status(500).json({ erro: 'Chave da OpenAI não configurada.' });

  try {
    const { produto, marketplace, imagens, quantidadeFotos } = req.body || {};
    const listaImagensEnviadas = Array.isArray(imagens) ? imagens.slice(0, 5) : [];
    if (!listaImagensEnviadas.length) return res.status(400).json({ erro: 'Envie pelo menos 1 foto real do produto — é obrigatória pra preservar fidelidade.' });
    if (!produto || !produto.trim()) return res.status(400).json({ erro: 'Descreva o produto.' });

    const mk = NOMES_MK[marketplace] ? marketplace : 'ml';
    const nomeMk = NOMES_MK[mk];
    const qtdFotos = Math.min(Math.max(Number(quantidadeFotos) || 8, 1), 8);

    // PASSO 1: Analisa a foto real + descrição, monta a estratégia (sequência de fotos) + título + descrição
    const analisePrompt = `Você é um Diretor Criativo de e-commerce especializado em ${nomeMk}. Sua prioridade MÁXIMA é: fidelidade ao produto real > estética. A foto enviada é a REFERÊNCIA ESTRUTURAL do produto real — preserve modelagem, cor, proporção, costuras, textura, acabamento, zíperes, botões, bolsos, gola, mangas, comprimento e estrutura geral. NUNCA invente características técnicas que não foram informadas ou não são visíveis na foto.

Analise a foto e a descrição do produto abaixo:
"${produto}"

Você recebeu ${listaImagensEnviadas.length} foto(s) real(is) do produto (podem incluir variações de cor diferentes) — use TODAS como referência de fidelidade.

Monte uma estratégia com até ${qtdFotos} imagens, seguindo esta sequência de referência (adapte conforme o produto — pule etapas que não fizerem sentido):
${SEQUENCIA_PADRAO.map((s,i) => `${i+1}. ${s.tipo}: ${s.foco}`).join('\n')}

Pra cada imagem, escreva um prompt DETALHADO em português (que será usado pra gerar a imagem), sempre reforçando as características reais e exatas do produto da foto (cor, formato, textura, materiais visíveis) — nunca genérico.

Também gere o título e a descrição do anúncio pra ${nomeMk}, seguindo boas práticas de SEO daquela plataforma, sem inventar informações não confirmadas (composição, medidas, compatibilidade).

Responda SOMENTE com um JSON válido no formato:
{"titulo":"...","descricao":"...","imagens":[{"tipo":"...","prompt":"..."}]}`;

    const rAnalise = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + chave },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Você é um Diretor Criativo de e-commerce. Responda somente com JSON válido.' },
          { role: 'user', content: [
            { type: 'text', text: analisePrompt },
            ...listaImagensEnviadas.map(img => ({ type: 'image_url', image_url: { url: img } }))
          ]}
        ],
        temperature: 0.6,
        response_format: { type: 'json_object' }
      })
    });

    if (!rAnalise.ok) {
      const err = await rAnalise.text();
      return res.status(500).json({ erro: 'Erro na análise da IA: ' + err.slice(0, 200) });
    }

    const dataAnalise = await rAnalise.json();
    const conteudo = dataAnalise.choices?.[0]?.message?.content || '{}';
    let estrategia;
    try { estrategia = JSON.parse(conteudo); } catch { return res.status(500).json({ erro: 'Resposta inválida da IA na análise.' }); }

    const listaImagens = (estrategia.imagens || []).slice(0, qtdFotos);
    if (!listaImagens.length) return res.status(500).json({ erro: 'A IA não conseguiu montar a estratégia de fotos.' });

    // PASSO 2: Gera todas as imagens em paralelo (mais rápido que uma de cada vez)
    const geracoes = await Promise.all(listaImagens.map(async (img) => {
      try {
        const rImg = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + chave },
          body: JSON.stringify({
            model: 'gpt-image-1',
            prompt: img.prompt,
            size: TAMANHO_IMAGEM,
            quality: 'medium',
            n: 1
          })
        });
        if (!rImg.ok) {
          const errTxt = await rImg.text();
          return { tipo: img.tipo, erro: errTxt.slice(0, 200) };
        }
        const dataImg = await rImg.json();
        const b64 = dataImg.data?.[0]?.b64_json;
        return { tipo: img.tipo, imagem: b64 ? `data:image/png;base64,${b64}` : null, erro: b64 ? null : 'Sem imagem retornada.' };
      } catch (e) {
        return { tipo: img.tipo, erro: e.message };
      }
    }));

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
