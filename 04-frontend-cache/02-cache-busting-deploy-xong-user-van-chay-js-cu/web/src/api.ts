// Client API của SPA. Mọi request gửi kèm phiên bản bản build (X-App-Version) để API đếm được request từ bản cũ.
const tabId = () => window.__LAB__?.tab ?? 'khong-ro';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'X-App-Version': __RELEASE__,
      'X-Tab-Id': tabId(),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} trả ${res.status}`);
  return (await res.json()) as T;
}

export interface Contact {
  id: number;
  label: string;
  company: string;
  phone: string;
}
export interface Note {
  id: number;
  text: string;
  at: string;
}

// Hợp đồng 1 (bản 41): khách hàng có `name`, ghi chú có `text`.
// Hợp đồng 2 (từ bản 42): `displayName` và `body`. Code của mỗi bản chỉ biết hợp đồng của chính nó.
interface RawContact {
  id: number;
  company: string;
  phone: string;
  name?: string;
  displayName?: string;
}
interface RawNote {
  id: number;
  at: string;
  text?: string;
  body?: string;
}

const toContact = (raw: RawContact): Contact => ({
  id: raw.id,
  label: (__CONTRACT__ === 1 ? raw.name : raw.displayName) as string,
  company: raw.company,
  phone: raw.phone,
});
const toNote = (raw: RawNote): Note => ({ id: raw.id, at: raw.at, text: (__CONTRACT__ === 1 ? raw.text : raw.body) as string });

export const getContacts = async () => (await call<RawContact[]>('/api/contacts')).map(toContact);

export async function getContact(id: number): Promise<{ contact: Contact; notes: Note[] }> {
  const raw = await call<{ contact: RawContact; notes: RawNote[] }>(`/api/contacts/${id}`);
  return { contact: toContact(raw.contact), notes: raw.notes.map(toNote) };
}

export const addNote = (id: number, text: string) =>
  call<RawNote>(`/api/contacts/${id}/notes`, { method: 'POST', body: JSON.stringify(__CONTRACT__ === 1 ? { text } : { body: text }) });

export interface ReportRow {
  stage: string;
  deals: number;
  value: number;
}
export const getReport = () => call<{ rows: ReportRow[] }>('/api/reports/summary');
