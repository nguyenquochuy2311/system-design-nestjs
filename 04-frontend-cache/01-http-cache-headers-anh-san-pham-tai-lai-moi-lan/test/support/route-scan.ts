// Quét MỌI route của app NestJS từ metadata của decorator (không liệt kê tay), gọi từng route có guard khi đã đăng nhập
// và khi chưa, rồi kiểm Cache-Control. Thêm route mới có guard là route đó tự vào phép quét.
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, ModulesContainer } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ADMIN_TOKEN, sessionCookie } from './lab';

export interface RouteInfo {
  method: string;
  path: string;
  guards: string[];
}

export function listRoutes(app: NestExpressApplication): RouteInfo[] {
  const discovery = new DiscoveryService(app.get(ModulesContainer));
  const scanner = new MetadataScanner();
  const routes: RouteInfo[] = [];
  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const base = String(Reflect.getMetadata(PATH_METADATA, metatype) ?? '');
    const classGuards: { name: string }[] = Reflect.getMetadata(GUARDS_METADATA, metatype) ?? [];
    const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name] as object;
      const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      if (sub === undefined) continue;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? 'UNKNOWN';
      const handlerGuards: { name: string }[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
      const path = `/${[base, sub].map((p) => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')}`;
      routes.push({ method, path, guards: [...classGuards, ...handlerGuards].map((g) => g.name) });
    }
  }
  return routes.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

export interface ScanResult {
  route: string;
  guards: string[];
  authenticated: boolean;
  status: number;
  cacheControl: string;
  violation: boolean;
}

/** Route có guard vi phạm khi response cho phép cache dùng chung lưu: có public / s-maxage, hoặc không có private lẫn no-store. */
export const violatesPrivate = (cacheControl: string): boolean =>
  /\bpublic\b/i.test(cacheControl) || /\bs-maxage\b/i.test(cacheControl) || !/\b(private|no-store)\b/i.test(cacheControl);

const fill = (path: string) => path.replace(':id', '1').replace(':size', 'thumb');
const SAMPLE_BODY = { productId: 1, qty: 1, price: 1_234_000 };

export async function scanGuardedRoutes(app: NestExpressApplication, userId = 42): Promise<ScanResult[]> {
  const server = app.getHttpServer();
  const out: ScanResult[] = [];
  for (const r of listRoutes(app).filter((x) => x.guards.length > 0)) {
    for (const authenticated of [true, false]) {
      let req = request(server)[r.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](fill(r.path));
      if (authenticated) req = req.set('Cookie', sessionCookie(userId)).set('X-Admin-Token', ADMIN_TOKEN);
      if (r.method !== 'GET') req = req.send(SAMPLE_BODY);
      const res = await req;
      const cacheControl = String(res.headers['cache-control'] ?? '');
      out.push({ route: `${r.method} ${r.path}`, guards: r.guards, authenticated, status: res.status, cacheControl, violation: violatesPrivate(cacheControl) });
    }
  }
  return out;
}
