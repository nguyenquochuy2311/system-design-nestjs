import { Body, Controller, Get, Headers, Inject, NotFoundException, Param, ParseIntPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ContactsStore, type ContactRecord, type NoteRecord } from '../shared/contacts.store';
import { contactV1, contactV2, noteV1, noteV2 } from '../shared/contracts';
import { ReleaseState } from '../shared/release.state';

// [PATTERN] Thời gian chuyển tiếp (expand): khi bản đang chạy dùng hợp đồng 2, API vẫn phục vụ JS của bản trước —
// response mang cả trường mới lẫn trường cũ, request nhận cả hai tên trường. Bỏ trường cũ (contract) chỉ sau khi
// nhật ký X-App-Version cho thấy không còn client bản 41.
const contactTransition = (c: ContactRecord) => ({ ...contactV2(c), name: c.displayName });
const noteTransition = (n: NoteRecord) => ({ ...noteV2(n), text: n.body });

@Controller('api/contacts')
export class SauContactsController {
  constructor(
    @Inject(ContactsStore) private readonly store: ContactsStore,
    @Inject(ReleaseState) private readonly state: ReleaseState,
  ) {}

  @Get()
  list() {
    const all = this.store.contacts;
    return this.state.contract === 1 ? all.map(contactV1) : all.map(contactTransition);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    const contact = this.store.find(id);
    if (!contact) throw new NotFoundException();
    const v1 = this.state.contract === 1;
    const notes = this.store.notesOf(id);
    return v1 ? { contact: contactV1(contact), notes: notes.map(noteV1) } : { contact: contactTransition(contact), notes: notes.map(noteTransition) };
  }

  @Post(':id/notes')
  add(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: Record<string, unknown>,
    @Headers('x-app-version') clientVersion: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.store.find(id)) throw new NotFoundException();
    const v1 = this.state.contract === 1;
    // [PATTERN] Hợp đồng 2 đọc `body`, thiếu thì nhận `text` của client bản trước.
    const value = v1 ? payload.text : typeof payload.body === 'string' ? payload.body : payload.text;
    const note = this.store.add(id, typeof value === 'string' ? value : '', payload, clientVersion ?? null);
    res.locals.log = { note: { id: note.id, contactId: id, lost: note.lost, fields: note.receivedFields } };
    return v1 ? noteV1(note) : noteTransition(note);
  }
}
