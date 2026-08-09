import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { clientIp } from '../../src/utils/clientIp.js';

function reqWith(headers: Record<string, string | undefined>, ip = '127.0.0.1'): FastifyRequest {
  return { headers, ip } as unknown as FastifyRequest;
}

describe('clientIp', () => {
  it('prefers Cf-Connecting-Ip over X-Forwarded-For and req.ip', () => {
    expect(
      clientIp(
        reqWith({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }),
      ),
    ).toBe('203.0.113.7');
  });

  it('falls back to the first X-Forwarded-For entry when no CF header', () => {
    expect(clientIp(reqWith({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe('198.51.100.1');
  });

  it('falls back to req.ip when no proxy headers are present', () => {
    expect(clientIp(reqWith({}, '192.0.2.50'))).toBe('192.0.2.50');
  });

  it('trims whitespace in the CF header and the XFF entry', () => {
    expect(clientIp(reqWith({ 'cf-connecting-ip': '  203.0.113.7  ' }))).toBe('203.0.113.7');
    expect(clientIp(reqWith({ 'x-forwarded-for': ' 198.51.100.1 , 10.0.0.1' }))).toBe(
      '198.51.100.1',
    );
  });

  it('ignores empty CF and XFF headers, falling through to req.ip', () => {
    expect(clientIp(reqWith({ 'cf-connecting-ip': '', 'x-forwarded-for': '' }, '192.0.2.9'))).toBe(
      '192.0.2.9',
    );
  });

  it('handles array-valued (duplicated) headers instead of falling through', () => {
    // A duplicated header arrives as string[]; the helper must still resolve it.
    const arrReq = {
      headers: { 'cf-connecting-ip': ['203.0.113.7', '203.0.113.8'] },
      ip: '127.0.0.1',
    } as unknown as FastifyRequest;
    expect(clientIp(arrReq)).toBe('203.0.113.7');

    const arrXff = {
      headers: { 'x-forwarded-for': ['198.51.100.1, 10.0.0.1', '10.0.0.2'] },
      ip: '127.0.0.1',
    } as unknown as FastifyRequest;
    expect(clientIp(arrXff)).toBe('198.51.100.1');
  });
});
