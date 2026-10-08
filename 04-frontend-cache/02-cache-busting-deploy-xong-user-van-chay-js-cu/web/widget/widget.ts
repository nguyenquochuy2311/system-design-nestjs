// Widget đối tác nhúng vào trang của họ (nút liên hệ kèm phiên bản). Đối tác chỉ biết một URL cố định:
// bản trước là chính file này (widget.js, max-age 1 ngày); bản sau là loader /widget.js (no-cache) trỏ tới file có hash.
const host = document.getElementById('crm-widget') ?? document.body.appendChild(document.createElement('div'));
host.id = 'crm-widget';
host.dataset.version = __RELEASE__;
host.textContent = `Liên hệ qua CRM (bản ${__RELEASE__})`;
