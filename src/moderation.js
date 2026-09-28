import { configured, session, signIn, signOut, rpc } from './api.js';
import { el, button, message, busy, noteMeta } from './ui.js';
import { resolveAnchor, fromStored } from './anchors.js';
import sections from './article.json';
const passages = new Map(sections.flatMap(s => s.paragraphs.map((p, i) => [`${s.id}:${i}`, p])));
passages.set('article-body', sections.flatMap(s => [...(s.heading ? [s.heading] : []), ...s.paragraphs]).join('\n\n'));
const access = document.querySelector('#moderator-access');
const queue = document.querySelector('#queue');
const status = document.querySelector('#queue-status');
let data = { annotations: [], replies: [], blocked: [] }, filter = 'pending';
function isOrphan(note) { return !note.anchor || !resolveAnchor(passages.get(note.anchor.section_id), fromStored(note.anchor)); }
async function reload() {
  status.textContent = 'Loading the moderation queue…';
  data = await rpc('moderation_queue');
  for (const note of data.annotations) {
    const orphaned = isOrphan(note);
    if (note.anchor && note.anchor.orphaned !== orphaned) { await rpc('mark_anchor', { p_id: note.id, p_orphaned: orphaned }); note.anchor.orphaned = orphaned; }
  }
  status.textContent = ''; render();
}
function render() {
  queue.replaceChildren();
  if (filter === 'blocked') {
    for (const person of data.blocked) {
      const err = el('div'); queue.append(el('div', { className: 'note' }, el('code', {}, person.user_id), button('Unblock user', event => busy(event.currentTarget, async () => { await rpc('block_reader', { p_user: person.user_id, p_block: false }); await reload(); }, err)), err));
    }
  } else {
    const entries = filter === 'replies' ? data.replies : data.annotations.filter(n => filter === 'orphaned' ? isOrphan(n) : n.state === filter);
    for (const note of entries) {
      const err = el('div');
      const card = el('section', { className: 'note' }, noteMeta(note), el('p', { className: 'hint' }, 'User ID: ', el('code', {}, note.user_id)), el('blockquote', { className: 'quote' }, note.anchor?.exact || 'Passage missing'));
      if (note.anchor) card.append(el('details', {}, el('summary', {}, 'Surrounding context'), el('p', {}, (note.anchor.prefix || '') + note.anchor.exact + (note.anchor.suffix || '')), el('p', { className: 'hint' }, `Passage: ${note.anchor.section_id}`)));
      if (isOrphan(note)) card.append(message('Orphaned: this quote cannot be confidently located in the current article. Review before approving.', 'error'));
      if (filter === 'replies') card.append(el('p', { className: 'hint' }, `Reply to ${note.parent_state} note: ${note.parent_body}`));
      card.append(el('p', {}, note.body));
      const actions = el('div', { className: 'actions' });
      for (const [action, label] of [['approve', 'Approve'], ['reject', note.state === 'approved' ? 'Remove from public view' : 'Reject'], ['delete', 'Delete']]) {
        if (action === 'approve' && note.state === 'approved') continue;
        actions.append(button(label, event => {
          if (action === 'delete' && !window.confirm('Permanently delete this submission? Deleting a note also deletes its replies.')) return;
          busy(event.currentTarget, async () => { await rpc('moderate', { p_kind: filter === 'replies' ? 'reply' : 'annotation', p_id: note.id, p_action: action }); await reload(); }, err);
        }, action === 'approve' ? { className: 'primary' } : {}));
      }
      if (!data.blocked.some(b => b.user_id === note.user_id)) actions.append(button('Block user', event => {
        if (!window.confirm('Block this user from submitting new public notes and replies? Existing notes remain available for separate review.')) return;
        busy(event.currentTarget, async () => { await rpc('block_reader', { p_user: note.user_id, p_block: true }); await reload(); }, err);
      }));
      card.append(actions, err); queue.append(card);
    }
  }
  if (!queue.childElementCount) queue.append(message('Nothing to review here.'));
}
document.querySelectorAll('[data-filter]').forEach(btn => btn.onclick = () => { filter = btn.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === btn))); render(); });
document.querySelector('#refresh').onclick = e => busy(e.currentTarget, reload, status);
async function init() {
  if (!configured) { access.replaceChildren(message('Author moderation will be available once Margin Notes is connected.')); return; }
  try {
    if (!await session()) {
      const err = el('div'); access.replaceChildren(message('Sign in with the account designated as the author.'), el('div', { className: 'actions' }, ...['google', 'github'].map(provider => button(`Continue with ${provider === 'google' ? 'Google' : 'GitHub'}`, e => busy(e.currentTarget, () => signIn(provider), err)))), err); return;
    }
    const account = document.querySelector('#account'); account.hidden = false;
    account.onclick = e => busy(e.currentTarget, async () => { await signOut(); location.reload(); }, access);
    if (!await rpc('is_moderator')) { access.replaceChildren(message('This account does not have author moderation access.')); return; }
    access.replaceChildren(); document.querySelector('#moderator-app').hidden = false; await reload();
  } catch (error) { access.replaceChildren(message(error.message, 'error'), button('Try again', init)); }
}
init();
