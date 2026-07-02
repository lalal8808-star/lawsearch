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
    
    if (!token || token === 'null' || token === 'undefined' || token.split('.').length !== 3) {
      return new Response(
        JSON.stringify({ error: '유효하지 않은 인증 토큰입니다. 다시 로그인해 주세요.' }), 
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

    // 4. 시스템 프롬프트 구성
    const persona = `당신의 이름은 'JongLaw AI'입니다.
당신은 사용자의 법률 질의를 변호사 수준의 체계적인 법률 검토 프로세스로 처리하여, 구조화된 법률 검토 보고서를 생성 및 제공하는 전문 법률 어시스턴트입니다.`;

    // 참고 자료 사용 원칙: 질문과 무관한 자료는 스스로 판단해 배제하고, 사용한 법령은 명시
    const sourceRule = `\n\n[참고 자료 사용 원칙]\n- 위 참고 자료 중 질문과 직접 관련 없는 내용은 사용하지 말고 무시하십시오 (관련성은 스스로 판단).\n- 답변·분석에 실제로 근거로 삼은 법령·판례의 정확한 명칭(조문 포함)을 본문에 명시하십시오.\n- 참고 자료에 근거가 없으면 일반 법리로 답하되, 추측을 단정적으로 쓰지 마십시오.`;

    let systemInstruction = '';
    if (ragIntent === 'CHAT') {
      systemInstruction = `${persona}\n\n참고 법령 및 판례:\n${ragContext}${sourceRule}\n\n위 참고 자료를 바탕으로 질문에 대해 친절하고 전문적으로 답변하십시오.`;
    } else {
      systemInstruction = `${persona}\n\n참고 법령 및 자료(판례 포함):\n${ragContext}${sourceRule}\n\n전문 변호사로서 [사건 개요, 법률 분석, 판례 분석, 결론, 향후 조치] 순서로 체계적인 자문 리포트를 작성하십시오. 특히 제공된 '판례'를 분석하여 유사 사례에서의 판단 기준을 명확히 제시하십시오. '법률 분석'에는 근거 법령의 명칭과 조문을 구체적으로 적시하십시오.`;
    }

    // 5. Vercel AI Gateway 경유 호출 (model 문자열만으로 자동 라우팅, 인증은 VERCEL_OIDC_TOKEN)
    // 비용 통제: 사용자 단위 태깅으로 대시보드에서 사용량 추적·per-user 레이트리밋을 걸 수 있고,
    // maxOutputTokens로 요청당 최대 출력을 제한해 폭주 비용을 막는다.
    const result = streamText({
      model: 'openai/gpt-5.5',
      system: systemInstruction,
      messages,
      maxOutputTokens: ragIntent === 'REPORT' ? 8000 : 2000,
      providerOptions: {
        gateway: {
          user: user.id,
          tags: ['feature:chat', `intent:${(ragIntent || 'chat').toLowerCase()}`],
        },
      },
      onError({ error }) {
        console.error('AI SDK Stream Error Details:', error);
      }
    });

    return result.toTextStreamResponse({
      headers: {
        // HTTP 헤더는 Latin-1만 허용 → 한글 소스명이 들어가므로 URL 인코딩 (프론트에서 decode)
        'X-RAG-Sources': encodeURIComponent(JSON.stringify(ragSources)),
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
