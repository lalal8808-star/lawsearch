import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(
        JSON.stringify({ error: 'Supabase URL 또는 Anon Key가 서버 환경 변수에 설정되어 있지 않습니다.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    // 1. Supabase OIDC (JWT) Token Verification
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.split(' ')[1];
    
    if (!token) {
      return new Response(
        JSON.stringify({ error: '인증 토큰이 제공되지 않았습니다. 로그인이 필요합니다.' }), 
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      console.error('OIDC Auth Error:', error);
      return new Response(
        JSON.stringify({ error: '유효하지 않은 인증 토큰입니다. 다시 로그인해 주세요.' }), 
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. 파라미터 파싱
    const { messages } = await req.json();
    const lastUserMessage = messages[messages.length - 1]?.content || '';

    // 3. 백엔드 FastAPI를 호출하여 RAG 컨텍스트 및 소스 추출
    let ragContext = '';
    let ragSources: any[] = [];
    let ragIntent = 'CHAT';

    try {
      const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const cleanBackendUrl = backendUrl.endsWith('/') ? backendUrl.slice(0, -1) : backendUrl;
      
      const ragRes = await fetch(`${cleanBackendUrl}/query-context?query=${encodeURIComponent(lastUserMessage)}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (ragRes.ok) {
        const ragData = await ragRes.json();
        ragContext = ragData.context || '';
        ragSources = ragData.sources || [];
        ragIntent = ragData.intent || 'CHAT';
      } else {
        console.error('Failed to fetch RAG context from backend:', await ragRes.text());
      }
    } catch (ragErr) {
      console.error('Error fetching RAG context:', ragErr);
    }

    // 4. OpenAI Provider 초기화 (Vercel AI Gateway 적용)
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY || 'mock-openai-key-not-set',
      baseURL: process.env.VERCEL_AI_GATEWAY_URL || undefined,
    });

    const persona = `당신의 이름은 'JongLaw AI'입니다. 
당신은 사용자의 법률 질의를 변호사 수준의 체계적인 법률 검토 프로세스로 처리하여, 구조화된 법률 검토 보고서를 생성 및 제공하는 전문 법률 어시스턴트입니다.`;

    let systemInstruction = '';
    if (ragIntent === 'CHAT') {
      systemInstruction = `${persona}\n\n참고 법령 및 판례:\n${ragContext}\n\n위 참고 자료를 바탕으로 질문에 대해 친절하고 전문적으로 답변하십시오.`;
    } else {
      systemInstruction = `${persona}\n\n참고 법령 및 자료(판례 포함):\n${ragContext}\n\n전문 변호사로서 [사건 개요, 법률 분석, 판례 분석, 결론, 향후 조치] 순서로 체계적인 자문 리포트를 작성하십시오. 특히 제공된 '판례'를 분석하여 유사 사례에서의 판단 기준을 명확히 제시하십시오.`;
    }

    const result = streamText({
      model: openai('gpt-5.5'),
      system: systemInstruction,
      messages,
    });

    return result.toTextStreamResponse({
      headers: {
        'X-RAG-Sources': JSON.stringify(ragSources),
        'X-RAG-Intent': ragIntent,
      }
    });

  } catch (err: any) {
    console.error('Chat API Route Error:', err);
    return new Response(
      JSON.stringify({ error: `서버 내부 오류가 발생했습니다: ${err.message}` }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
