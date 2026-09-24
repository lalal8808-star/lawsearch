import { streamText } from 'ai';
import { after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { limitChatMessages } from '@/utils/chat-limits';
import { claimGenerationJob, GENERATION_MODEL, JobGateError, jsonError, updateGenerationJob } from '@/utils/server-jobs';

// 이 라우트는 한 요청에서 인증 → 백엔드 query-context(법령 자동수집·임베딩·벡터검색, 20초+)
// → GPT-5.6 Sol 보고서 생성까지 수행한다. 기본 타임아웃으로는 스트림 시작 전에 끊겨
// 진행률이 98%에서 멈춘 것처럼 보이므로 상한을 늘린다.
export const maxDuration = 300;

const backendUrl = () => (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');

const updateJob = (token: string, jobId: string | undefined, payload: Record<string, unknown>) =>
  updateGenerationJob({ Authorization: `Bearer ${token}` }, jobId, payload);

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
  let activeJobId: string | undefined;
  let activeToken = '';
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
    activeToken = token || '';
    
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
    const body = await req.json();
    const followUp = body.mode === 'followup';
    // 후속 질의는 [원 질의, 원 보고서, ...상담] 순서라 앞의 두 개는 항상 남긴다.
    const messages = limitChatMessages(body.messages, { pinnedLeading: followUp ? 2 : 0 });
    const lastUserMessage = messages[messages.length - 1]?.content || '';
    if (!lastUserMessage.trim()) {
      return jsonError(400, '질문 내용이 없습니다.');
    }
    // 모델 호출 전에 작업을 선점한다: 작업 하나당 호출 한 번, 시간당 생성 수·월 한도는 백엔드가 강제한다.
    // (작업 생성은 백엔드 요청 제한을 받으므로 jobId 없이 이 라우트를 반복 호출해도 한도를 우회할 수 없다)
    try {
      activeJobId = await claimGenerationJob({ Authorization: `Bearer ${token}` }, {
        jobId: typeof body.jobId === 'string' ? body.jobId : undefined,
        query: lastUserMessage,
        kind: followUp ? 'followup' : 'consultation',
      });
    } catch (gateError) {
      const failure = gateError instanceof JobGateError ? gateError : new JobGateError(503, 'AI 사용량을 확인하지 못했습니다.');
      console.warn(JSON.stringify({ event: 'chat_job_rejected', requestId, userId: user.id, status: failure.status }));
      return jsonError(failure.status, failure.message);
    }
    console.info(JSON.stringify({ event: 'chat_started', requestId, jobId: activeJobId, userId: user.id, messageCount: messages.length }));

    // 3. 백엔드 FastAPI를 호출하여 RAG 컨텍스트 및 소스 추출
    let ragContext = '';
    let ragSources: any[] = [];
    let ragIntent = 'CHAT';

    try {
      const ragRes = await fetch(`${backendUrl()}/query-context?query=${encodeURIComponent(lastUserMessage)}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        cache: 'no-store',
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
    const effectiveIntent = followUp ? 'CHAT' : ragIntent;
    await updateJob(token, activeJobId, {
      status: 'running', stage: 'AI 보고서 생성', progress: 55,
      intent: effectiveIntent, sources: ragSources,
    });

    // 4. 시스템 프롬프트 구성
    const persona = `당신의 이름은 'JongLaw AI'입니다.
당신은 사용자의 법률 질의를 변호사 수준의 체계적인 법률 검토 프로세스로 처리하여, 구조화된 법률 검토 보고서를 생성 및 제공하는 전문 법률 어시스턴트입니다.`;

    // 참고 자료 사용 원칙: 질문과 무관한 자료는 스스로 판단해 배제하고, 사용한 법령은 명시
    const sourceRule = `\n\n[참고 자료 사용 원칙]\n- 위 참고 자료 중 질문과 직접 관련 없는 내용은 사용하지 말고 무시하십시오 (관련성은 스스로 판단).\n- 답변·분석에 실제로 근거로 삼은 법령·판례의 정확한 명칭(조문 포함)을 본문에 명시하십시오.\n- 참고 자료에 근거가 없으면 일반 법리로 답하되, 추측을 단정적으로 쓰지 마십시오.`;

    let systemInstruction = '';
    if (followUp) {
      systemInstruction = `${persona}\n\n이 대화는 이미 생성된 법률 보고서의 추가 질의입니다. 기존 보고서 맥락과 아래 검색 근거를 활용해 질문에 직접 답하고, 새 보고서 형식으로 재작성하지 마십시오. 불필요한 반복을 피하고 필요한 법령·조문만 명시하십시오.\n\n추가 검색 근거:\n${ragContext}${sourceRule}`;
    } else if (effectiveIntent === 'CHAT') {
      systemInstruction = `${persona}\n\n참고 법령 및 판례:\n${ragContext}${sourceRule}\n\n위 참고 자료를 바탕으로 질문에 대해 친절하고 전문적으로 답변하십시오.`;
    } else {
      systemInstruction = `${persona}\n\n참고 법령 및 자료(판례 포함):\n${ragContext}${sourceRule}\n\n전문 변호사로서 [사건 개요, 법률 분석, 판례 분석, 결론, 향후 조치] 순서로 체계적인 자문 리포트를 작성하십시오. 특히 제공된 '판례'를 분석하여 유사 사례에서의 판단 기준을 명확히 제시하십시오. '법률 분석'에는 근거 법령의 명칭과 조문을 구체적으로 적시하십시오.`;
    }

    // 5. Vercel AI Gateway 경유 호출 (model 문자열만으로 자동 라우팅, 인증은 VERCEL_OIDC_TOKEN)
    // 비용 통제: 사용자 단위 태깅으로 대시보드에서 사용량 추적·per-user 레이트리밋을 걸 수 있고,
    // maxOutputTokens로 요청당 최대 출력을 제한해 폭주 비용을 막는다.
    const result = streamText({
      model: GENERATION_MODEL,
      system: systemInstruction,
      messages,
      maxOutputTokens: effectiveIntent === 'REPORT' ? 8000 : followUp ? 2500 : 2000,
      providerOptions: {
        gateway: {
          user: user.id,
          tags: [followUp ? 'feature:follow-up' : 'feature:chat', `intent:${effectiveIntent.toLowerCase()}`],
        },
      },
      onError({ error }) {
        console.error(JSON.stringify({ event: 'gateway_stream_error', requestId, jobId: activeJobId, error: error instanceof Error ? error.message : String(error) }));
        void updateJob(token, activeJobId, { status: 'error', stage: 'AI 응답 오류', error: error instanceof Error ? error.message : String(error) });
      },
      async onFinish({ text, usage, finishReason }) {
        const isReport = effectiveIntent === 'REPORT';
        await updateJob(token, activeJobId, {
          status: isReport ? 'generated' : 'complete',
          stage: isReport ? '보고서 생성 완료·저장 대기' : '답변 완료',
          progress: isReport ? 90 : 100,
          result: text,
          sources: ragSources,
          intent: effectiveIntent,
          token_usage: usage ? JSON.parse(JSON.stringify(usage)) : {},
        });
        console.info(JSON.stringify({ event: 'chat_finished', requestId, jobId: activeJobId, intent: effectiveIntent, followUp, finishReason, usage }));
      }
    });

    // 클라이언트가 중간에 연결을 끊어도 생성은 끝까지 진행되고 onFinish에서 사용량이 기록되도록
    // 스트림을 별도로 소비한다. after()가 응답 종료 후에도 함수가 이 작업을 기다리게 한다.
    after(async () => {
      await result.consumeStream();
    });

    return result.toTextStreamResponse({
      headers: {
        // HTTP 헤더는 Latin-1만 허용 → 한글 소스명이 들어가므로 URL 인코딩 (프론트에서 decode)
        'X-RAG-Sources': encodeURIComponent(JSON.stringify(ragSources)),
        'X-RAG-Intent': effectiveIntent,
        'X-Generation-Job': activeJobId || '',
        'X-Request-Id': requestId,
      }
    });

  } catch (err: any) {
    console.error(JSON.stringify({ event: 'chat_route_error', requestId, jobId: activeJobId, error: err?.message || String(err) }));
    if (activeToken && activeJobId) {
      await updateJob(activeToken, activeJobId, { status: 'error', stage: '요청 처리 실패', error: err?.message || String(err) });
    }
    return jsonError(500, `서버 내부 오류가 발생했습니다. (요청 ID: ${requestId})`);
  }
}
