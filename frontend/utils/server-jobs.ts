// Next API 라우트(서버)에서만 쓰는 AI 작업 계량 헬퍼.
// 모델 호출 전에 백엔드에서 작업 하나를 선점(queued→running)해 사용자별 호출 수·월 한도를
// 서버가 강제하고, 끝나면 실제 토큰 사용량을 기록한다.

export const GENERATION_MODEL = 'openai/gpt-5.6-sol';

export type BackendAuth = Record<string, string>;

export class JobGateError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const backendUrl = () => (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');

async function toGateError(response: Response): Promise<JobGateError> {
  let detail: unknown;
  try {
    detail = (await response.json())?.detail;
  } catch {
    detail = undefined;
  }
  // 한도 초과·중복 사용·인증 만료는 그대로 알리고, 그 밖의 실패는 사용량을 확인할 수 없는
  // 상태이므로 모델을 호출하지 않는다(fail-closed).
  const status = [401, 409, 429].includes(response.status) ? response.status : 503;
  const message = typeof detail === 'string' && detail
    ? detail
    : status === 503 ? 'AI 사용량을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' : '요청을 처리할 수 없습니다.';
  return new JobGateError(status, message);
}

/** 클라이언트가 만든 작업을 선점하거나, 없으면 새로 만들어 선점한다. 선점한 작업 ID를 돌려준다. */
export async function claimGenerationJob(
  auth: BackendAuth,
  { jobId, query, kind }: { jobId?: string; query: string; kind: string },
): Promise<string> {
  try {
    let claimId = jobId;
    if (!claimId) {
      const created = await fetch(`${backendUrl()}/jobs`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.slice(0, 20000) || kind, kind, model: GENERATION_MODEL }),
        cache: 'no-store',
      });
      if (!created.ok) throw await toGateError(created);
      claimId = String((await created.json()).id);
    }
    const started = await fetch(`${backendUrl()}/jobs/${encodeURIComponent(claimId)}/start`, {
      method: 'POST',
      headers: auth,
      cache: 'no-store',
    });
    if (!started.ok) throw await toGateError(started);
    return claimId;
  } catch (error) {
    if (error instanceof JobGateError) throw error;
    throw new JobGateError(503, 'AI 사용량을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

export async function updateGenerationJob(auth: BackendAuth, jobId: string | undefined, payload: Record<string, unknown>) {
  if (!jobId) return;
  try {
    const response = await fetch(`${backendUrl()}/jobs/${encodeURIComponent(jobId)}`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    if (!response.ok) console.error(JSON.stringify({ event: 'job_update_failed', jobId, status: response.status }));
  } catch (error) {
    console.error(JSON.stringify({ event: 'job_update_error', jobId, error: error instanceof Error ? error.message : String(error) }));
  }
}

export function jsonError(status: number, error: string) {
  return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });
}
