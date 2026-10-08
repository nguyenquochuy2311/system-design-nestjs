/** Render màn hình thành HTML tĩnh và đọc giá trị từng trường theo `data-field`, như người dùng nhìn thấy. */
import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export function renderFields<P extends object>(component: FunctionComponent<P>, props: P): Record<string, string> {
  const html = renderToStaticMarkup(createElement(component, props));
  const fields: Record<string, string> = {};
  for (const m of html.matchAll(/<(\w+)[^>]*data-field="([^"]+)"[^>]*>(.*?)<\/\1>/g)) {
    fields[m[2]!] = m[3]!.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  }
  return fields;
}
