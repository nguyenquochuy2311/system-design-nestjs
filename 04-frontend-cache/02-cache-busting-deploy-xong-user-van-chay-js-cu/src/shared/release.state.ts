import { Inject, Injectable } from '@nestjs/common';
import { RELEASES, type Contract, type ReleaseId } from '../../web/releases';
import { CONFIG, type Config } from './config';

/** Bản API đang chạy. "Deploy API" của lab = đổi bản này (POST /ops/release), không khởi động lại tiến trình. */
@Injectable()
export class ReleaseState {
  current: ReleaseId;
  constructor(@Inject(CONFIG) config: Config) {
    this.current = config.release;
  }
  get contract(): Contract {
    return RELEASES[this.current].contract;
  }
}
