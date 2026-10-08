import { Injectable } from '@nestjs/common';

export interface ContactRecord {
  id: number;
  displayName: string;
  company: string;
  phone: string;
}
export interface NoteRecord {
  id: number;
  contactId: number;
  body: string;
  at: string;
  /** Phiên bản client gửi (X-App-Version). */
  clientVersion: string | null;
  /** Tên các trường client gửi lên, để thấy ghi chú rỗng là do client gửi trường API không nhận ra. */
  receivedFields: string[];
  /** Ghi chú lưu rỗng trong khi client có gửi chữ (ở một trường khác): dữ liệu bị mất. */
  lost: boolean;
}

const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi'];
const DEM = ['Văn', 'Thị', 'Minh', 'Thu', 'Quốc'];
const TEN = ['An', 'Bình', 'Chi', 'Dũng', 'Giang', 'Hà', 'Khoa', 'Lan', 'Nam', 'Phúc', 'Quân', 'Trang'];
const CONG_TY = ['Thép Miền Nam', 'Logistics Sao Việt', 'Dược Hòa Bình', 'Nội thất Gỗ Xanh', 'Bao bì Tân Phát'];

/** 40 khách hàng tất định và ghi chú trong bộ nhớ: bài đo hành vi deploy, không đo truy vấn. */
@Injectable()
export class ContactsStore {
  readonly contacts: ContactRecord[] = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    displayName: `${HO[i % HO.length]} ${DEM[i % DEM.length]} ${TEN[i % TEN.length]}`,
    company: CONG_TY[i % CONG_TY.length]!,
    phone: `0909 ${String(100000 + i * 7919).slice(-6)}`,
  }));
  private readonly notes: NoteRecord[] = [];

  find(id: number): ContactRecord | undefined {
    return this.contacts.find((c) => c.id === id);
  }

  notesOf(contactId: number): NoteRecord[] {
    return this.notes.filter((n) => n.contactId === contactId);
  }

  allNotes(): NoteRecord[] {
    return [...this.notes];
  }

  add(contactId: number, body: string, payload: Record<string, unknown>, clientVersion: string | null): NoteRecord {
    const lost = body.trim() === '' && Object.values(payload).some((v) => typeof v === 'string' && v.trim() !== '');
    const note: NoteRecord = {
      id: this.notes.length + 1,
      contactId,
      body,
      at: new Date().toISOString(),
      clientVersion,
      receivedFields: Object.keys(payload),
      lost,
    };
    this.notes.push(note);
    return note;
  }
}
