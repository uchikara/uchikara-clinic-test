document.addEventListener(
  'change',
  (event) => {
    const select = event.target.closest?.('.js-doctor-select');
    if (!select) return;

    event.stopImmediatePropagation();
    const keyword = select.value.trim();
    const cards = document.querySelectorAll('.p-archive__doctor-list .c-card04__item');

    cards.forEach((card) => {
      const department = card.querySelector('.c-card04__department')?.textContent ?? '';
      card.hidden = Boolean(keyword) && !department.includes(keyword);
    });

    const url = new URL(window.location.href);
    if (keyword) url.searchParams.set('doctor_keyword', keyword);
    else url.searchParams.delete('doctor_keyword');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  },
  true,
);

document.addEventListener('DOMContentLoaded', () => {
  const select = document.querySelector('.js-doctor-select');
  if (!select) return;
  const keyword = new URL(window.location.href).searchParams.get('doctor_keyword');
  if (!keyword) return;
  select.value = keyword;
  select.dispatchEvent(new Event('change', { bubbles: true }));
});

function renderFormMessages(form, messages, isSuccess = false) {
  let output = form.querySelector('.wpcf7-response-output');
  if (!output) {
    output = document.createElement('div');
    output.className = 'wpcf7-response-output';
    form.prepend(output);
  }
  output.replaceChildren();
  output.setAttribute('role', isSuccess ? 'status' : 'alert');
  output.setAttribute('aria-live', 'polite');
  if (messages.length === 1) {
    output.textContent = messages[0];
  } else {
    const list = document.createElement('ul');
    messages.forEach((message) => {
      const item = document.createElement('li');
      item.textContent = message;
      list.append(item);
    });
    output.append(list);
  }
  output.style.display = 'block';
  output.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

document.addEventListener('submit', async (event) => {
  const form = event.target.closest?.('.uchikara-static-form');
  if (!form) return;
  event.preventDefault();

  if (['127.0.0.1', 'localhost'].includes(window.location.hostname)) {
    renderFormMessages(form, ['ローカル確認環境では送信しません。']);
    return;
  }

  const submit = form.querySelector('[type="submit"]');
  if (submit?.disabled) return;
  if (submit) submit.disabled = true;

  try {
    const response = await fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { Accept: 'application/json' },
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      renderFormMessages(form, result.errors?.length ? result.errors : ['送信に失敗しました。時間をおいて再度お試しください。']);
      window.turnstile?.reset();
      return;
    }
    const message = result.dry_run
      ? 'テスト送信は正常です。現在はメール・Google Chatへ送信していません。'
      : form.dataset.formType === 'doctor_recruit'
        ? '採用のお問い合わせを受け付けました。担当者よりご連絡します。'
        : 'お問い合わせを受け付けました。担当者よりご連絡します。';
    form.reset();
    renderFormMessages(form, [message], true);
  } catch {
    renderFormMessages(form, ['通信に失敗しました。時間をおいて再度お試しください。']);
    window.turnstile?.reset();
  } finally {
    if (submit) submit.disabled = false;
  }
});
