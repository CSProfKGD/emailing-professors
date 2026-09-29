# Faculty essay and Margin Notes

The full article is available at `/`; the author interface is at `/moderation.html`. HTML and CSS render independently of authentication or the database. JavaScript uses native browser APIs; the Supabase client is loaded separately. The site has no application server to operate: Supabase Postgres functions handle validated writes, and Row Level Security governs reads.

## Run locally

Requires Node.js 22+ and pnpm. From this directory:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Open `http://127.0.0.1:4173/`. After source edits run `pnpm build` and reload. HTML and CSS are authored directly under `dist/` and tracked; do not delete that directory as disposable build output.

```sh
pnpm test
pnpm lint
```

Tests execute the real SQL migration in PGlite (PostgreSQL) with authenticated, anonymous, and moderator roles. They verify row visibility and submission/moderation behavior, plus quote relocation and verbatim article preservation. PGlite supplies a minimal `auth.uid()` test shim; it does not test the hosted Supabase Auth service or OAuth provider configuration. Lint checks JavaScript syntax and document metadata; there was no pre-existing linter configuration.

## Activate Supabase

1. Create a Supabase project. The implementation requires no paid add-on.
2. Run these files **in order, once** in its SQL editor:
   - `supabase/migrations/001_margin_notes.sql`
   - `supabase/migrations/002_article.sql`
   - `supabase/migrations/003_update_introduction.sql`
   - `supabase/migrations/004_add_email_time.sql`
   - `supabase/migrations/005_add_advisor_fit.sql`
   - `supabase/migrations/006_add_where_to_start.sql`
   - `supabase/migrations/007_add_recent_research.sql`
   - `supabase/migrations/008_add_statement_of_purpose.sql`
   - `supabase/migrations/009_add_signal_of_success.sql`
   - `supabase/migrations/010_add_llm_flow_advice.sql`
   - `supabase/migrations/011_add_teaser_and_effort.sql`
   - `supabase/migrations/012_add_supervision_fit.sql`
   - `supabase/migrations/013_add_shared_research_direction.sql`
   - `supabase/migrations/014_refine_research_success_signals.sql`
   - `supabase/migrations/015_revise_follow_up_advice.sql`
   - `supabase/migrations/016_add_personal_webpages.sql`
   - `supabase/migrations/017_add_generic_email_question.sql`
   - `supabase/migrations/018_invite_differing_opinions.sql`
   - `supabase/migrations/019_emphasize_position_fit.sql`
   - `supabase/migrations/020_discourage_random_paper_references.sql`
   - `supabase/migrations/021_add_older_paper_example.sql`
   - `supabase/migrations/022_clarify_compelling_case.sql`
   - `supabase/migrations/023_add_survivorship_bias_section.sql`
   - `supabase/migrations/024_emphasize_decade.sql`
   - `supabase/migrations/025_add_personal_perspective.sql`
   - `supabase/migrations/026_revise_opening_attention.sql`
   - `supabase/migrations/027_add_mutual_loss.sql`
   - `supabase/migrations/028_expand_email_time.sql`
   - `supabase/migrations/029_due_diligence.sql`
   - `supabase/migrations/030_warn_department_cc.sql`
   - `supabase/migrations/031_emphasize_brevity.sql`
   - `supabase/migrations/032_add_cv_interest.sql`
   - `supabase/migrations/033_add_honest_experience.sql`
   - `supabase/migrations/034_smooth_follow_up_transition.sql`
   - `supabase/migrations/035_emphasize_trust.sql`
   - `supabase/migrations/036_add_mentor_reflection.sql`
   - `supabase/migrations/037_tighten_paper_advice.sql`
3. In Supabase Auth, enable Google and GitHub and configure each provider's OAuth client. Use the callback URL supplied by Supabase (`https://YOUR_PROJECT.supabase.co/auth/v1/callback`) in each provider's developer console. Keep provider client secrets only in Supabase.
4. Set the Supabase Auth Site URL to the final website origin. Add explicit redirect URLs for both the article and moderation page on that origin, and the local URLs if using local testing:
   - `http://127.0.0.1:4173/`
   - `http://127.0.0.1:4173/moderation.html`
   - `https://YOUR_SITE/`
   - `https://YOUR_SITE/moderation.html`
5. Copy `.env.example` to `.env` and set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. These are public browser configuration values. A legacy `anon` key is also supported. **Never use a secret/service-role key.** The build rejects known secret-key formats.
6. Run `pnpm build` and deploy the updated static files. Configuration is embedded at build time; changing host runtime environment variables alone does not update a static deployment.
7. Sign into the website with the author's chosen account. Copy that account's UUID from Supabase Authentication → Users. In the SQL editor, grant moderation to that UUID:

```sql
insert into margin_private.moderators(user_id)
values ('REPLACE_WITH_AUTHOR_AUTH_UUID');
```

Open `/moderation.html` with that account. Other signed-in users cannot obtain moderation data or call moderator actions. The private schema must not be added to Supabase's exposed API schemas.

Supabase references: [OAuth sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithoauth), [Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [GitHub](https://supabase.com/docs/guides/auth/social-login/auth-github), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Permissions and moderation

- Private annotations and their anchors are readable only by their creator, including when a moderator is browsing.
- Pending or rejected public submissions are readable by their creator and moderators. Approved notes are publicly readable.
- Replies require an approved parent note and separate approval. Removing the parent from publication also hides its replies. Moderators can still review those replies in the moderation queue.
- Reader table writes are revoked. RPCs derive the author from the authenticated identity, validate plain text and anchors, and serialize rate-limit checks using a per-user transaction lock.
- Each user may save at most five notes/replies per minute and twenty per hour. Matching normalized content submitted to the same passage or parent within a day is rejected as a duplicate.
- Notes allow 2,000 characters; replies allow 1,000. Display names are explicitly supplied pseudonyms rather than OAuth email metadata. HTML is rejected by the database; browser rendering uses text nodes.
- Blocking stops new public notes and replies. It does not remove historical notes automatically or prevent private notes.
- Moderation records approval, rejection, deletion, and blocking actions. Deleting a note deletes its anchor and replies.
- Local/session browser storage is used only by the Supabase Auth SDK and for an unsent draft carried through OAuth. Saved notes live in Postgres.

## Text anchoring and article edits

`src/article.json` contains stable section IDs and verbatim paragraphs. The HTML uses matching passage IDs. Sections may specify `paragraphIds` to preserve anchors when paragraphs are inserted. Keep IDs stable when editing existing passages; do not renumber existing IDs when inserting paragraphs. Update the JSON, HTML, and the `articles.sections` database snapshot together in a new migration after publication. Do not rerun or overwrite applied migrations.

Anchors store the exact quote, up to 64 characters on each side, a passage identifier, and UTF-16 offsets. Selections crossing paragraph boundaries use an `article-body` canonical text joined by double newlines. The reader verifies the stored location and surrounding quote context, then searches for a unique context match if needed. Changed or ambiguous matches remain unattached. The moderator queue computes orphan status against the current article and persists it through a moderator-only RPC. Orphaned notes can be inspected, rejected, or deleted; there is no automatic fuzzy attachment.

## Hosting

`.openai/hosting.json` identifies the registered Sites project. Publish `dist/` as static output using the Sites workflow. The initial Sites audience is owner-private; it is separate from Supabase reader authentication. The site can also be integrated into a faculty website by serving these static files at its root and updating Supabase redirect URLs. If hosting under a subpath, adjust the root-relative asset/navigation URLs first.

Until Supabase is configured, the article, selection, composer, and show/hide controls work; the interface explicitly says that sign-in and saving are unavailable. No demo records or fake successful submissions are shown.

## Live acceptance checks after configuration

Use two reader accounts and the author account:

1. Save a private note, reload, and confirm it persists. Confirm neither the other reader nor moderator can see it.
2. Submit a public note and confirm anonymous visitors cannot see it. Approve it as the author and reload the reader view.
3. Reply to the approved note. Confirm the reply is hidden until independently approved.
4. Remove the parent from publication and confirm both parent and replies disappear publicly.
5. Block a reader and confirm further public notes/replies fail while private notes remain private.
6. Check Google and GitHub return to the initiating page and restore an unsent note draft.
7. Test selection using a physical touch device and keyboard-only navigation. Check sheet scrolling, focus return, and Escape dismissal.

Live OAuth and persistence through a hosted Supabase project cannot be verified until project configuration and the author account are supplied.
