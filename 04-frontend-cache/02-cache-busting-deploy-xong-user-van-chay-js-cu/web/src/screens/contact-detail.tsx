import { useCallback, useEffect, useState } from 'react';
import { addNote, getContact, type Contact, type Note } from '../api';
import { initials } from '../format';

export function ContactDetailScreen({ id }: { id: number }) {
  const [data, setData] = useState<{ contact: Contact; notes: Note[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const load = useCallback(() => getContact(id).then(setData, (e: unknown) => setError(String(e))), [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setStatus('saving');
    try {
      await addNote(id, draft);
      setDraft('');
      setStatus('saved');
      await load();
    } catch {
      setStatus('failed');
    }
  };

  if (error) return <p role="alert">Không tải được khách hàng: {error}</p>;
  if (!data) return <p>Đang tải khách hàng…</p>;
  const { contact, notes } = data;
  return (
    <section data-screen="contact-detail" data-contact-id={contact.id}>
      <h1>
        <span className="avatar">{initials(contact.label)}</span> {contact.label}
      </h1>
      <p>
        {contact.company} · {contact.phone}
      </p>
      <h2>Ghi chú ({notes.length})</h2>
      <ul>
        {notes.map((n) => (
          <li key={n.id}>
            <time>{n.at.slice(0, 16).replace('T', ' ')}</time> — {n.text}
          </li>
        ))}
      </ul>
      <textarea data-note-input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ghi chú cuộc gọi…" />
      <button data-note-save onClick={() => void save()} disabled={status === 'saving' || draft.trim() === ''}>
        Lưu ghi chú
      </button>
      <span data-note-status={status}>{status === 'saved' ? ' Đã lưu' : status === 'failed' ? ' Lưu không được' : ''}</span>
    </section>
  );
}
