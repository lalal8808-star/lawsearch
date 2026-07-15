import { generateText } from 'ai';

export async function POST(req: Request) {
  try {
    // 1. Check API Key
    const apiKey = req.headers.get('x-api-key') || req.headers.get('X-API-Key');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'X-API-Key 헤더가 누락되었습니다.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Parse payload (support both JSON and form-urlencoded)
    let query = '';
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await req.json();
      query = body.query || '';
    } else {
      const formData = await req.formData().catch(() => null);
      if (formData) {
        query = formData.get('query') as string || '';
      } else {
        const text = await req.text();
        const params = new URLSearchParams(text);
        query = params.get('query') || '';
      }
    }

    if (!query) {
      return new Response(
        JSON.stringify({ error: 'query 파라미터가 필요합니다.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. Call backend for RAG context using API Key
    let ragContext = '';
    let ragSources: any[] = [];
    let ragIntent = 'CHAT';

    try {
      const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const cleanBackendUrl = backendUrl.endsWith('/') ? backendUrl.slice(0, -1) : backendUrl;
      
      const ragRes = await fetch(`${cleanBackendUrl}/query-context?query=${encodeURIComponent(query)}`, {
        headers: {
          'X-API-Key': apiKey
        }
      });
      
      if (ragRes.ok) {
        const ragData = await ragRes.json();
        ragContext = ragData.context || '';
        ragSources = ragData.sources || [];
        ragIntent = ragData.intent || 'CHAT';
      } else {
        console.error('Failed to fetch RAG context from backend:', await ragRes.text());
        return new Response(
          JSON.stringify({ error: '백엔드 서버에서 컨텍스트를 가져오는 데 실패했습니다.' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } catch (ragErr) {
      console.error('Error fetching RAG context:', ragErr);
      return new Response(
        JSON.stringify({ error: '백엔드 서버에 연결할 수 없습니다.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. Build Prompt
    const persona = `당신의 이름은 'JongLaw AI'입니다.
당신은 사용자의 법률 질의를 변호사 수준의 체계적인 법률 검토 프로세스로 처리하여, 구조화된 법률 검토 보고서를 생성 및 제공하는 전문 법률 어시스턴트입니다.`;

    const sourceRule = `\n\n[참고 자료 사용 원칙]\n- 위 참고 자료 중 질문과 직접 관련 없는 내용은 사용하지 말고 무시하십시오 (관련성은 스스로 판단).\n- 답변·분석에 실제로 근거로 삼은 법령·판례의 정확한 명칭(조문 포함)을 본문에 명시하십시오.\n- 참고 자료에 근거가 없으면 일반 법리로 답하되, 추측을 단정적으로 쓰지 마십시오.`;

    let systemInstruction = '';
    if (ragIntent === 'CHAT') {
      systemInstruction = `${persona}\n\n참고 법령 및 판례:\n${ragContext}${sourceRule}\n\n위 참고 자료를 바탕으로 질문에 대해 친절하고 전문적으로 답변하십시오.`;
    } else {
      systemInstruction = `${persona}\n\n참고 법령 및 자료(판례 포함):\n${ragContext}${sourceRule}\n\n전문 변호사로서 [사건 개요, 법률 분석, 판례 분석, 결론, 향후 조치] 순서로 체계적인 자문 리포트를 작성하십시오. 특히 제공된 '판례'를 분석하여 유사 사례에서의 판단 기준을 명확히 제시하십시오. '법률 분석'에는 근거 법령의 명칭과 조문을 구체적으로 적시하십시오.`;
    }

    // 5. Generate Answer via AI SDK
    const { text } = await generateText({
      // We will use gpt-4o as previously rolled back.
      model: 'openai/gpt-4o',
      system: systemInstruction,
      messages: [{ role: 'user', content: query }],
      maxOutputTokens: ragIntent === 'REPORT' ? 8000 : 2000,
    });

    // 6. Return JSON response
    return new Response(
      JSON.stringify({
        answer: text,
        sources: ragSources,
        intent: ragIntent
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('Bot API Route Error:', err);
    return new Response(
      JSON.stringify({ error: `서버 내부 오류가 발생했습니다: ${err.message}` }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
