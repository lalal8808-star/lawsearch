import { generateText } from 'ai';

// PDF/이미지 파싱 + GPT-5.6 Sol 분석까지 한 요청에서 처리하므로 기본 타임아웃보다 여유가 필요하다.
export const maxDuration = 300;
import { createClient } from '@supabase/supabase-js';
import { claimGenerationJob, GENERATION_MODEL, JobGateError, jsonError, updateGenerationJob } from '@/utils/server-jobs';
// @ts-expect-error pdf-parse v1 has no compatible ESM type declaration
import pdf from 'pdf-parse/lib/pdf-parse.js';

// 계약서 본문은 이 분량까지만 모델에 보낸다(요청당 비용 상한).
const MAX_DOCUMENT_CHARS = 60000;

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
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
    // 1. Supabase OIDC 인증 검증
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.split(' ')[1];
    
    if (!token || token === 'null' || token === 'undefined' || token.split('.').length !== 3) {
      return new Response(
        JSON.stringify({ error: '유효하지 않은 인증 토큰입니다. 다시 로그인해 주세요.' }), 
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      console.error('OIDC Auth Error:', authError);
      return new Response(
        JSON.stringify({ error: '유효하지 않은 토큰입니다. 다시 로그인해 주세요.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. FormData 파싱
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const description = formData.get('description') as string | null;

    if (!file) {
      return new Response(
        JSON.stringify({ error: '업로드된 파일이 없습니다.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 3. 파일 처리 및 컨텍스트 파싱
    let textContent = '';
    let imageBuffer: Buffer | null = null;
    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    const isImage = file.type.startsWith('image/');

    if (isPdf) {
      try {
        const buffer = await file.arrayBuffer();
        const parsedData = await pdf(Buffer.from(buffer));
        textContent = parsedData.text;
      } catch (pdfErr: any) {
        console.error('PDF parsing error:', pdfErr);
        return new Response(
          JSON.stringify({ error: 'PDF 문서에서 텍스트를 추출하는 데 실패했습니다.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (!textContent.trim()) {
        return new Response(
          JSON.stringify({ error: 'PDF 문서에 추출할 수 있는 텍스트가 없습니다. 스캔본인 경우 이미지로 변환하여 업로드해 주세요.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else if (isImage) {
      const buffer = await file.arrayBuffer();
      imageBuffer = Buffer.from(buffer);
    } else {
      return new Response(
        JSON.stringify({ error: '지원하지 않는 파일 형식입니다. PDF 또는 이미지 파일만 업로드해 주세요.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (textContent.length > MAX_DOCUMENT_CHARS) {
      textContent = `${textContent.slice(0, MAX_DOCUMENT_CHARS)}\n\n[문서가 길어 앞부분 ${MAX_DOCUMENT_CHARS.toLocaleString()}자까지만 분석했습니다]`;
    }

    // 모델 호출 전에 작업을 선점해 시간당 생성 수·월 한도를 백엔드가 강제하게 한다.
    const backendAuth = { Authorization: `Bearer ${token}` };
    let jobId: string;
    try {
      jobId = await claimGenerationJob(backendAuth, {
        query: (description || file.name || '문서 분석').slice(0, 2000),
        kind: 'analysis',
      });
    } catch (gateError) {
      const failure = gateError instanceof JobGateError ? gateError : new JobGateError(503, 'AI 사용량을 확인하지 못했습니다.');
      return jsonError(failure.status, failure.message);
    }

    // 4. 프롬프트 및 메세지 구성
    const systemPrompt = `당신은 대한민국 전문 변호사입니다. 제공된 계약서(또는 법률 문서)를 정밀 분석하여 다음 정보를 추출하고 분석하십시오.

분석 요구사항:
1. **문서 종류 식별**: 이 문서가 어떤 종류의 계약서인지 파악하십시오.
2. **독소 조항(Toxic Clauses) 추출**: 사용자에게 일방적으로 불리하거나, 법적으로 문제가 될 소지가 있는 조항을 모두 찾아내어 설명하십시오.
3. **누락된 필수 항목**: 해당 계약 종류에서 통상적으로 포함되어야 하나 누락된 중요한 항목이 있다면 지적하십시오.
4. **종합 의견 및 권고 사항**: 이 계약을 체결할 때 주의해야 할 점과 수정 제안을 제공하십시오.

출력 형식 (JSON):
{
    "document_type": "문서 종류",
    "toxic_clauses": [
        {"clause": "조항 내용 (또는 위치)", "reason": "불리하거나 위험한 이유", "suggestion": "수정 제안"}
    ],
    "missing_items": ["누락된 항목 1", "누락된 항목 2"],
    "overall_opinion": "종합적인 변호사 의견",
    "risk_level": "고/중/저"
}

반드시 다른 텍스트 설명 없이 유효한 JSON 형식으로만 답변하십시오. 한국어로 작성하십시오.`;

    const humanText = `사용자 추가 설명: ${description || '없음'}`;
    const messages: any[] = [
      { role: 'system', content: systemPrompt }
    ];

    if (isImage && imageBuffer) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: humanText },
          { type: 'image', image: imageBuffer, mediaType: file.type }
        ]
      });
    } else {
      messages.push({
        role: 'user',
        content: `${humanText}\n\n[계약서 텍스트 내용]\n${textContent}`
      });
    }

    // 5. Vercel AI Gateway 경유 분석 요청 (인증은 VERCEL_OIDC_TOKEN 자동 처리)
    let text: string;
    try {
      const generated = await generateText({
        model: GENERATION_MODEL,
        messages,
        temperature: 0,
        maxOutputTokens: 4000,
        providerOptions: {
          gateway: {
            user: user.id,
            tags: ['feature:document-analysis'],
          },
        },
      });
      text = generated.text;
      // 분석 결과는 보고서 히스토리 대상이 아니므로 result는 저장하지 않고 사용량만 기록한다.
      await updateGenerationJob(backendAuth, jobId, {
        status: 'complete', stage: '문서 분석 완료', progress: 100,
        token_usage: JSON.parse(JSON.stringify(generated.usage || {})),
      });
    } catch (generationError) {
      await updateGenerationJob(backendAuth, jobId, {
        status: 'error', stage: '문서 분석 실패',
        error: generationError instanceof Error ? generationError.message.slice(0, 1000) : String(generationError),
      });
      throw generationError;
    }

    // 7. JSON 응답 추출 및 반환
    let jsonString = text.trim();
    if (jsonString.includes('```json')) {
      jsonString = jsonString.split('```json')[1].split('```')[0].trim();
    } else if (jsonString.includes('```')) {
      jsonString = jsonString.split('```')[1].split('```')[0].trim();
    }

    try {
      const parsedJson = JSON.parse(jsonString);
      return new Response(JSON.stringify(parsedJson), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch {
      console.error('JSON Parsing failed on response:', text);
      return new Response(
        JSON.stringify({ 
          error: 'AI의 분석 결과를 올바른 데이터 구조로 변환하는 데 실패했습니다.', 
          detail: text 
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (err: any) {
    console.error(JSON.stringify({ event: 'analyze_route_error', requestId, error: err?.message || String(err) }));
    return jsonError(500, `서버 내부 분석 오류가 발생했습니다. (요청 ID: ${requestId})`);
  }
}
