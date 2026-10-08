// Các "bản phát hành" của lab. Cùng một mã nguồn, build với hằng số khác nhau (thay cho nhiều commit thật), để
// biết chắc giữa hai bản chỉ đổi đúng những gì bảng này ghi.
export const RELEASES = {
  '41': { contract: 1, reportsLayout: 'a', change: 'bản đang chạy trước đợt phát hành' },
  '42': { contract: 2, reportsLayout: 'a', change: 'đổi API danh bạ: name → displayName, ghi chú text → body' },
  '43': { contract: 2, reportsLayout: 'b', change: 'chỉ sửa màn Báo cáo (thêm cột tỉ lệ)' },
  '44': { contract: 2, reportsLayout: 'c', change: 'sửa màn Báo cáo lần nữa (dùng cho test lưu giữ assets)' },
} as const;

export type ReleaseId = keyof typeof RELEASES;
export type Site = 'truoc' | 'sau';
export type Contract = (typeof RELEASES)[ReleaseId]['contract'];

export const isReleaseId = (v: string): v is ReleaseId => Object.hasOwn(RELEASES, v);
