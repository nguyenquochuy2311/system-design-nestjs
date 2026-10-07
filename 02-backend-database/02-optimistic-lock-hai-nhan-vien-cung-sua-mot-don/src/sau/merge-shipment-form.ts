import { FORM_FIELDS, type ShipmentForm } from '../shared/shipment';

type FormField = (typeof FORM_FIELDS)[number];

export interface FieldConflict {
  field: FormField;
  base: ShipmentForm[FormField];
  mine: ShipmentForm[FormField];
  theirs: ShipmentForm[FormField];
}

export interface MergeResult {
  merged: ShipmentForm;
  conflicts: FieldConflict[];
}

/**
 * Logic của "màn hình gộp" sau khi nhận 409: gộp ba phía theo từng trường.
 * - base: bản người dùng đã tải lúc mở form; mine: bản họ vừa sửa; theirs: bản hiện tại trong DB (từ body 409).
 * Trường chỉ một phía sửa được gộp sẵn; trường cả hai phía sửa khác nhau là xung đột thật, giữ `theirs`
 * cho tới khi người dùng tự chọn. Hàm không tự lưu: lưu lại là quyết định của người dùng, với version mới.
 */
export function mergeShipmentForm(base: ShipmentForm, mine: ShipmentForm, theirs: ShipmentForm): MergeResult {
  const merged = { ...theirs };
  const conflicts: FieldConflict[] = [];
  for (const field of FORM_FIELDS) {
    const mineChanged = mine[field] !== base[field];
    const theirsChanged = theirs[field] !== base[field];
    if (!mineChanged) continue; // giữ bản hiện tại
    if (!theirsChanged || mine[field] === theirs[field]) {
      Object.assign(merged, { [field]: mine[field] });
      continue;
    }
    conflicts.push({ field, base: base[field], mine: mine[field], theirs: theirs[field] });
  }
  return { merged, conflicts };
}
