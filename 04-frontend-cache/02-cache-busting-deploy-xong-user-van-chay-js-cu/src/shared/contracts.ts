import type { ContactRecord, NoteRecord } from './contacts.store';

// Hai hình dạng response. Hợp đồng 1 (bản 41): name, text. Hợp đồng 2 (từ bản 42): displayName, body.
export const contactV1 = (c: ContactRecord) => ({ id: c.id, name: c.displayName, company: c.company, phone: c.phone });
export const contactV2 = (c: ContactRecord) => ({ id: c.id, displayName: c.displayName, company: c.company, phone: c.phone });
export const noteV1 = (n: NoteRecord) => ({ id: n.id, text: n.body, at: n.at });
export const noteV2 = (n: NoteRecord) => ({ id: n.id, body: n.body, at: n.at });
