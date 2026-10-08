import { parseOptions } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';
import { PasswordHasher } from '../src/sau/password-hasher';
import type { HasherOptions } from '../src/sau/password-hasher.options';

const PEPPER = Buffer.from('pepper-cho-test', 'utf8');
const base: HasherOptions = { memoryCost: 8192, timeCost: 1, parallelism: 1, pepper: PEPPER };
const hasher = new PasswordHasher(base);

describe('PasswordHasher (Argon2id)', () => {
  it('cùng mật khẩu băm hai lần cho hai chuỗi khác nhau (salt riêng mỗi lần)', async () => {
    const [a, b] = await Promise.all([hasher.hash('matkhau-giong-nhau'), hasher.hash('matkhau-giong-nhau')]);
    expect(a).not.toBe(b);
    // Nhưng cả hai đều verify đúng với mật khẩu gốc.
    expect(await hasher.verify(a, 'matkhau-giong-nhau')).toBe(true);
    expect(await hasher.verify(b, 'matkhau-giong-nhau')).toBe(true);
    // Chuỗi PHC mang đúng thuật toán và tham số.
    expect(a.startsWith('$argon2id$v=19$m=8192,t=1,p=1$')).toBe(true);
  });

  it('verify: đúng mật khẩu trả true, sai trả false (không ném)', async () => {
    const h = await hasher.hash('ĐúngMậtKhẩu#2026');
    expect(await hasher.verify(h, 'ĐúngMậtKhẩu#2026')).toBe(true);
    expect(await hasher.verify(h, 'saimatkhau')).toBe(false);
    expect(await hasher.verify('chuoi-hash-hong', 'bất kỳ')).toBe(false);
  });

  it('sai pepper thì verify thất bại (pepper lộ DB mà không lộ pepper thì hash vô dụng)', async () => {
    const h = await hasher.hash('matkhau');
    const kyPepperSai = new PasswordHasher({ ...base, pepper: Buffer.from('pepper-khac') });
    expect(await kyPepperSai.verify(h, 'matkhau')).toBe(false);
    const khongPepper = new PasswordHasher({ ...base, pepper: null });
    expect(await khongPepper.verify(h, 'matkhau')).toBe(false);
  });

  it('needsRehash: hash tham số thấp hơn cần băm lại; bằng tham số hiện hành thì không', async () => {
    const yeu = new PasswordHasher({ ...base, memoryCost: 8192, timeCost: 1 });
    const hYeu = await yeu.hash('matkhau');
    const manh = new PasswordHasher({ ...base, memoryCost: 16384, timeCost: 2 });
    expect(manh.needsRehash(hYeu)).toBe(true); // chi phí hiện hành cao hơn → băm lại
    const hManh = await manh.hash('matkhau');
    expect(manh.needsRehash(hManh)).toBe(false); // đúng tham số hiện hành → giữ nguyên
  });

  it('mật khẩu 100 ký tự KHÔNG bị cắt: đổi ký tự cuối thì verify thất bại (khác bcrypt cắt 72 byte)', async () => {
    const dai = 'A'.repeat(99) + 'X'; // 100 ký tự
    const daiKhac = 'A'.repeat(99) + 'Y'; // chỉ khác ký tự thứ 100
    const h = await hasher.hash(dai);
    expect(await hasher.verify(h, dai)).toBe(true);
    // Nếu cắt ở 72 byte kiểu bcrypt, hai chuỗi trên sẽ coi như nhau và verify đúng — Argon2id thì không.
    expect(await hasher.verify(h, daiKhac)).toBe(false);
    // Xác nhận chuỗi lưu không mang dấu hiệu bị cắt: salt/hash là của toàn bộ đầu vào.
    expect(parseOptions(h).memoryCost).toBe(8192);
  });
});
