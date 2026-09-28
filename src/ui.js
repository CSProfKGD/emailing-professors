export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'className') node.className = value;
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}
export function button(label, action, attrs = {}) { return el('button', { type: 'button', ...attrs, onclick: action }, label); }
export function message(text, kind = '') { return el('p', { className: kind, role: kind === 'error' ? 'alert' : 'status' }, text); }
export async function busy(btn, action, errorTarget) {
  btn.disabled = true;
  try { await action(); } catch (error) { errorTarget.replaceChildren(message(error.message, 'error')); }
  finally { btn.disabled = false; }
}
export function noteMeta(note) {
  const date = new Date(note.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return el('div', { className: 'note-meta' }, `${note.display_name} · ${date} `, note.state === 'approved' ? '' : el('span', { className: 'badge' }, note.state === 'pending' ? 'Awaiting author review' : note.state));
}
export function nameField() {
  return el('label', { className: 'field' }, el('span', {}, 'Display name'), el('input', { name: 'displayName', required: true, maxlength: 60, autocomplete: 'nickname', placeholder: 'A name to show with your note', pattern: '[^<>@]+' }), el('small', { className: 'hint' }, 'Use a name or pseudonym. Your email address is never shown.'));
}
