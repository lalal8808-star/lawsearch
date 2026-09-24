import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimGenerationJob, JobGateError } from './server-jobs';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('claimGenerationJob', () => {
  it('claims the client job without creating a new one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { id: 'job-1', status: 'running' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(claimGenerationJob({ Authorization: 'Bearer t' }, { jobId: 'job-1', query: 'q', kind: 'consultation' })).resolves.toBe('job-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/jobs\/job-1\/start$/);
  });

  it('creates and starts a job when the caller skipped job creation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(200, { id: 'server-job' }))
      .mockResolvedValueOnce(json(200, { id: 'server-job', status: 'running' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(claimGenerationJob({ 'X-API-Key': 'k' }, { query: 'q', kind: 'api' })).resolves.toBe('server-job');
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/jobs$/);
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/jobs\/server-job\/start$/);
  });

  it('passes through limit and reuse rejections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(429, { detail: '이번 달 AI 사용 한도에 도달했습니다.' })));
    await expect(claimGenerationJob({}, { jobId: 'j', query: 'q', kind: 'k' })).rejects.toMatchObject({ status: 429, message: '이번 달 AI 사용 한도에 도달했습니다.' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(409, { detail: 'used' })));
    await expect(claimGenerationJob({}, { jobId: 'j', query: 'q', kind: 'k' })).rejects.toMatchObject({ status: 409 });
  });

  it('fails closed when usage cannot be checked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const failure = await claimGenerationJob({}, { jobId: 'j', query: 'q', kind: 'k' }).catch((e) => e);
    expect(failure).toBeInstanceOf(JobGateError);
    expect(failure.status).toBe(503);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 })));
    await expect(claimGenerationJob({}, { jobId: 'j', query: 'q', kind: 'k' })).rejects.toMatchObject({ status: 503 });
  });
});
