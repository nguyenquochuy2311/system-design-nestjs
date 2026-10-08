import { Body, Controller, Get, Headers, Inject, NotFoundException, Param, ParseIntPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ContactsStore } from '../shared/contacts.store';
import { contactV1, contactV2, noteV1, noteV2 } from '../shared/contracts';
import { ReleaseState } from '../shared/release.state';

/**
 * Hiện trạng: API chỉ hiểu hợp đồng của bản đang chạy. Deploy bản 42 là đổi hợp đồng ngay lập tức:
 * - JS bản 41 đọc `name` → undefined → lỗi lúc render (màn hình trắng).
 * - JS bản 41 gửi ghi chú ở `text` → API bản 42 chỉ đọc `body` → lưu ghi chú rỗng, vẫn trả 201: mất dữ liệu im lặng.
 */
@Controller('api/contacts')
export class TruocContactsController {
  constructor(
    @Inject(ContactsStore) private readonly store: ContactsStore,
    @Inject(ReleaseState) private readonly state: ReleaseState,
  ) {}

  @Get()
  list() {
    const all = this.store.contacts;
    return this.state.contract === 1 ? all.map(contactV1) : all.map(contactV2);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    const contact = this.store.find(id);
    if (!contact) throw new NotFoundException();
    const v1 = this.state.contract === 1;
    const notes = this.store.notesOf(id);
    return v1 ? { contact: contactV1(contact), notes: notes.map(noteV1) } : { contact: contactV2(contact), notes: notes.map(noteV2) };
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
    const value = v1 ? payload.text : payload.body;
    const note = this.store.add(id, typeof value === 'string' ? value : '', payload, clientVersion ?? null);
    res.locals.log = { note: { id: note.id, contactId: id, lost: note.lost, fields: note.receivedFields } };
    return v1 ? noteV1(note) : noteV2(note);
  }
}
