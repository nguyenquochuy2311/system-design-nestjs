import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { KYSELY, type Database } from '../shared/db';
import { md5Hex } from '../shared/md5';
import { FailedLoginCounter } from './failed-login-counter';
import { LegacyHashAdapter } from './legacy-hash-adapter';
import { PasswordHasher } from './password-hasher';

export type LoginOutcome =
  | { kind: 'ok'; userId: string; hashVersion: number; upgraded: boolean }
  | { kind: 'invalid' }
  | { kind: 'blocked' };

interface UserRow {
  id: string;
  password_md5: string | null;
  password_hash: string | null;
  hash_version: number;
}

@Injectable()
export class LoginService {
  private readonly log = new Logger(LoginService.name);
  private dummyHash: string | null = null;

  // @Inject tường minh cho mọi tham số: tsx (esbuild) không phát metadata design:paramtypes (nhật ký 08/01 điểm 1).
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(LegacyHashAdapter) private readonly legacy: LegacyHashAdapter,
    @Inject(FailedLoginCounter) private readonly counter: FailedLoginCounter,
  ) {}

  async login(email: string, password: string, ip: string): Promise<LoginOutcome> {
    const subjects = [`email:${email}`, `ip:${ip}`];
    // 1. Chặn online trước khi tốn CPU băm: một trong hai bộ đếm vượt ngưỡng → 429.
    if (await this.anyBlocked(subjects)) return { kind: 'blocked' };

    const user = await this.db
      .selectFrom('users')
      .select(['id', 'password_md5', 'password_hash', 'hash_version'])
      .where('email', '=', email)
      .executeTakeFirst();

    // 2. Email không tồn tại: vẫn verify một hash giả để thời gian phản hồi tương đương (chống dò tài khoản).
    if (!user) {
      await this.hasher.verify(await this.dummy(), password);
      await this.recordFailure(subjects);
      return { kind: 'invalid' };
    }

    if (!(await this.verifyByVersion(user, password))) {
      await this.recordFailure(subjects);
      return { kind: 'invalid' };
    }

    // 3. Đúng mật khẩu: reset bộ đếm, nâng cấp hash nếu cần, trả về.
    await this.resetFailures(subjects);
    const upgraded = await this.upgradeIfNeeded(user, password);
    return { kind: 'ok', userId: user.id, hashVersion: upgraded ? 2 : user.hash_version, upgraded };
  }

  private verifyByVersion(user: UserRow, password: string): Promise<boolean> {
    switch (user.hash_version) {
      case 2:
        return user.password_hash ? this.hasher.verify(user.password_hash, password) : Promise.resolve(false);
      case 1:
        return user.password_hash ? this.legacy.verifyWrapped(user.password_hash, password) : Promise.resolve(false);
      default:
        // version 0: chưa di trú, chỉ còn MD5 (dùng cho trường hợp đăng nhập trước khi migration chạy tới).
        return Promise.resolve(md5Hex(password) === user.password_md5);
    }
  }

  private async upgradeIfNeeded(user: UserRow, password: string): Promise<boolean> {
    // [PATTERN] version 0 (MD5) hoặc version 1 (bọc md5): giờ đã có mật khẩu thật → băm trực tiếp, lên version 2.
    if (user.hash_version < 2) {
      await this.rehash(user.id, password);
      return true;
    }
    // version 2: băm lại tại chỗ nếu tham số đã tăng theo thời gian (needsRehash).
    if (user.password_hash && this.hasher.needsRehash(user.password_hash)) {
      await this.rehash(user.id, password);
      return true;
    }
    return false;
  }

  private async rehash(userId: string, password: string): Promise<void> {
    const phc = await this.hasher.hash(password);
    // Nâng cấp "cơ hội": ghi hash mới + hash_version = 2 VÀ xóa MD5 (password_md5 = NULL) ngay trong lần đăng
    // nhập, không cần mật khẩu cũ. Xóa MD5 cùng lúc để dump không còn giữ hash cũ bên cạnh hash mới.
    await this.db.updateTable('users').set({ password_hash: phc, hash_version: 2, password_md5: null }).where('id', '=', userId).execute();
  }

  private async dummy(): Promise<string> {
    if (!this.dummyHash) this.dummyHash = await this.hasher.hash('tai-khoan-khong-ton-tai');
    return this.dummyHash;
  }

  // Bộ đếm sai fail-open: Redis lỗi thì không chặn, chỉ ghi log (đăng nhập vẫn cần đúng mật khẩu).
  private async anyBlocked(subjects: string[]): Promise<boolean> {
    try {
      for (const s of subjects) if (await this.counter.isBlocked(s)) return true;
      return false;
    } catch (e) {
      this.log.warn(`bộ đếm sai không đọc được, bỏ qua chặn: ${String(e)}`);
      return false;
    }
  }

  private async recordFailure(subjects: string[]): Promise<void> {
    try {
      for (const s of subjects) await this.counter.recordFailure(s);
    } catch (e) {
      this.log.warn(`không ghi được lần sai: ${String(e)}`);
    }
  }

  private async resetFailures(subjects: string[]): Promise<void> {
    try {
      for (const s of subjects) await this.counter.reset(s);
    } catch {
      /* bỏ qua: reset thất bại chỉ làm bộ đếm hết hạn theo TTL */
    }
  }
}
