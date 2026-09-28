import { config } from './config.js';
let clientPromise;
export const configured = Boolean(config.url && config.key);
export async function client() {
  if (!configured) throw new Error('Margin Notes is not available yet. You can still read the full article.');
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(config.url, config.key, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } }));
  return clientPromise;
}
export async function rpc(name, args = {}) {
  const db = await client();
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message || 'Something went wrong. Please try again.');
  return data;
}
export async function getNotes() {
  const db = await client();
  const notes = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from('annotations').select('id,body,state,display_name,created_at,annotation_anchors(*)').eq('article_id', 'email-professor').order('created_at').order('id').range(offset, offset + 499);
    if (error) throw new Error('Could not load notes. Please try again.');
    notes.push(...data.map(n => ({ ...n, anchor: Array.isArray(n.annotation_anchors) ? n.annotation_anchors[0] : n.annotation_anchors })));
    if (data.length < 500) return notes;
  }
}
export async function getReplies(id) {
  const db = await client();
  const { data, error } = await db.from('replies').select('id,body,state,display_name,created_at').eq('annotation_id', id).order('created_at');
  if (error) throw new Error('Could not load replies. Please try again.');
  return data;
}
export async function session() {
  if (!configured) return null;
  const db = await client();
  const { data, error } = await db.auth.getSession();
  if (error) throw error;
  return data.session;
}
export async function signIn(provider) {
  const db = await client();
  const { error } = await db.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin + location.pathname } });
  if (error) throw error;
}
export async function signOut() {
  const db = await client();
  const { error } = await db.auth.signOut();
  if (error) throw error;
}
